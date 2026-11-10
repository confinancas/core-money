import { expect, type Locator, type Page, test } from "@playwright/test";
import { consultaSql, executaSql } from "./helpers/db";
import { semeiaSessaoDaInstalacaoPronta, signUpAndSignIn } from "./helpers/sessao";
import { semearInstalacaoPronta } from "./helpers/setup";

// Conectar Meu Pluggy (TASK-0203), na instalação pronta (8788) contra o Worker real e o Meu Pluggy falso (8791).
// Três larguras (os projetos celular, tablet e desktop). Os dados são [TEST]; o falso aceita só o par de chaves dele.
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const SEGREDO = "TEST-segredo-valido-0203";
const SEGREDO_ERRADO = "TEST-segredo-errado-0203";
const CLIENT_ID_NOVO = "22222222-2222-4222-8222-222222222222";
const SEGREDO_NOVO = "TEST-segredo-novo-0203";
const ITEM_ITAU = "00000000-0000-4000-8000-0000000000a1";
const ITEM_NUBANK = "00000000-0000-4000-8000-0000000000b2";
const ROTULO = "[TEST] Conta A";

const ROTA = "/configuracoes/bancos/conectar";

// Alvo de toque: pelo menos 44 px de altura e de largura, medido pelo navegador.
async function alvoDeNoMinimo44(alvo: Locator): Promise<void> {
  await expect(alvo).toBeVisible();
  const caixa = await alvo.boundingBox();
  expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(caixa?.width ?? 0).toBeGreaterThanOrEqual(44);
}

// Nenhuma rolagem horizontal da página.
async function semRolagemHorizontal(page: Page): Promise<void> {
  const sobra = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sobra).toBeLessThanOrEqual(0);
}

// Todo botão e link visível da tela tem pelo menos 44 px de altura (o navegador mede; o texto não entra).
async function todosOsAlvosTem44(page: Page): Promise<void> {
  const alturas = await page
    .locator("main button:visible, main a:visible, main [role='checkbox']:visible")
    .evaluateAll((elementos) =>
      elementos.map((elemento) => ({
        texto: (elemento.textContent ?? "").trim().slice(0, 40),
        altura: elemento.getBoundingClientRect().height,
      })),
    );
  const curtos = alturas.filter((alvo) => alvo.altura < 44);
  expect(curtos, `alvos menores que 44 px: ${JSON.stringify(curtos)}`).toEqual([]);
}

// Só as linhas que este arquivo cria: a conexão [TEST] Conta A e os bancos dos ids de teste. As outras specs têm as
// suas (com transações ligadas aos bancos), e um DELETE geral quebra a chave estrangeira delas.
const LIMPEZA_DO_PLUGGY = [
  `DELETE FROM bank_items WHERE id IN ('${ITEM_ITAU}', '${ITEM_NUBANK}', '00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000ff') OR connection_id IN (SELECT id FROM pluggy_connections WHERE label = '${ROTULO}')`,
  `DELETE FROM pluggy_connections WHERE label = '${ROTULO}'`,
].join("; ");

// Cada teste começa com a instalação pronta, a sessão semeada e nenhuma conexão deste arquivo; no fim, a mesma limpeza.
test.beforeEach(() => {
  semearInstalacaoPronta();
  semeiaSessaoDaInstalacaoPronta();
  executaSql("pronta", LIMPEZA_DO_PLUGGY);
});

test.afterAll(() => {
  executaSql("pronta", LIMPEZA_DO_PLUGGY);
});

// O id da conta [TEST] Conta A no banco de teste. O link de cada cartão da seção leva o id, e as outras contas do
// banco (de outras specs) têm links com o mesmo texto: por isso a seção é consultada pelo id, nunca pelo nome do link.
function idDaConta(): string {
  const linhas = consultaSql("pronta", `SELECT id FROM pluggy_connections WHERE label = '${ROTULO}'`);
  const id = linhas[0]?.id;
  if (typeof id !== "string") throw new Error("A conta de teste não foi criada.");
  return id;
}

// Link de uma conta na seção, pelo sufixo do caminho (o trocar de chaves, ou o outro banco sem sufixo).
const linkDaConta = (page: Page, id: string, sufixo: string) =>
  page.locator(`a[href="/configuracoes/bancos/conectar?conexao=${id}${sufixo}"]`);

// O cartão inteiro da conta: o ancestral do link que é o Card da seção.
const cartaoDaConta = (page: Page, id: string) =>
  linkDaConta(page, id, "&trocar=chaves").locator(
    "xpath=ancestor::div[contains(@class,'overflow-hidden')][1]",
  );

// Caminha pelo passo 1 e 2 (com o teste das chaves), deixando a tela no passo 3.
async function ateOPassoTres(page: Page, rotulo = ROTULO): Promise<void> {
  await page.getByLabel("Nome desta conexão").fill(rotulo);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Client ID").fill(CLIENT_ID);
  await page.getByLabel("Client Secret").fill(SEGREDO);
  await page.getByRole("button", { name: "Testar chaves" }).click();
  await expect(page.getByRole("button", { name: "✓ Chaves funcionando" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Cole o id de cada banco" })).toBeVisible();
}

test("cenário 1: caminho feliz até o passo 4, nas três larguras, com a conta na seção de Configurações", async ({
  page,
}, testInfo) => {
  const largura = testInfo.project.name;
  await signUpAndSignIn(page);
  await page.goto(ROTA);

  // Passo 1: o nome. Os textos da spec, e o alvo do topo que volta para Configurações.
  await expect(page.getByRole("heading", { name: "De quem é esta conta?" })).toBeVisible();
  await expect(
    page.getByText("Aparece assim para os dois, não importa quem estiver usando o app."),
  ).toBeVisible();
  await expect(page.getByText("Passo 1 de 4 · Nome da conexão")).toBeVisible();
  await alvoDeNoMinimo44(page.getByRole("link", { name: "Cancelar e voltar para Configurações" }));
  await semRolagemHorizontal(page);
  await todosOsAlvosTem44(page);
  await page.getByLabel("Nome desta conexão").fill(ROTULO);
  await page.screenshot({ path: testInfo.outputPath("passo-1.png"), fullPage: true });
  await page.getByRole("button", { name: "Continuar" }).click();

  // Passo 2: as chaves. Continuar só habilita depois do teste.
  await expect(page.getByRole("heading", { name: "Cole as chaves da API" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuar" })).toBeDisabled();
  await page.getByLabel("Client ID").fill(CLIENT_ID);
  await page.getByLabel("Client Secret").fill(SEGREDO);
  await page.getByRole("button", { name: "Testar chaves" }).click();
  await expect(page.getByRole("button", { name: "✓ Chaves funcionando" })).toBeVisible();
  await alvoDeNoMinimo44(page.getByRole("button", { name: "Continuar" }));
  await todosOsAlvosTem44(page);
  await page.screenshot({ path: testInfo.outputPath("passo-2.png"), fullPage: true });
  await page.getByRole("button", { name: "Continuar" }).click();

  // Passo 3: o id de cada banco. Itaú e Nubank.
  await expect(page.getByRole("heading", { name: "Cole o id de cada banco" })).toBeVisible();
  await page.getByLabel("Id do banco no Meu Pluggy").fill(ITEM_ITAU);
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByRole("checkbox", { name: /Itaú/ })).toBeVisible();
  await page.getByLabel("Id do banco no Meu Pluggy").fill(ITEM_NUBANK);
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByRole("checkbox", { name: /Nubank/ })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Nubank/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Conectar 2 bancos" })).toBeEnabled();
  await alvoDeNoMinimo44(page.getByRole("checkbox", { name: /Itaú/ }));
  await alvoDeNoMinimo44(page.getByRole("link", { name: "Autorizar outro banco no Meu Pluggy" }));
  await semRolagemHorizontal(page);
  await todosOsAlvosTem44(page);
  await page.screenshot({ path: testInfo.outputPath("passo-3.png"), fullPage: true });
  await page.getByRole("button", { name: "Conectar 2 bancos" }).click();

  // Passo 4: pronto. A frase da spec, e os dois caminhos.
  await expect(page.getByRole("heading", { name: `${ROTULO} conectada` })).toBeVisible();
  await expect(
    page.getByText(
      "2 bancos entraram no Matrimoney. A partir de agora, tudo se atualiza sozinho uma vez por dia.",
    ),
  ).toBeVisible();
  await alvoDeNoMinimo44(page.getByRole("button", { name: "Ir para o início" }));
  await alvoDeNoMinimo44(page.getByRole("button", { name: "Ver em Configurações" }));

  await page.screenshot({ path: testInfo.outputPath("passo-4.png"), fullPage: true });

  // Na seção Contas Meu Pluggy de Configurações: a conexão, os bancos e "Trocar chaves".
  await page.getByRole("button", { name: "Ver em Configurações" }).click();
  await expect(page).toHaveURL(/\/configuracoes$/);
  const titulo = page.getByRole("heading", { level: 2, name: "Contas Meu Pluggy", exact: true });
  await expect(titulo).toBeVisible();
  await expect(page.getByText(ROTULO, { exact: true })).toBeVisible();
  const id = idDaConta();
  await expect(cartaoDaConta(page, id).getByRole("link", { name: /Itaú/ })).toBeVisible();
  await expect(cartaoDaConta(page, id).getByRole("link", { name: /Nubank/ })).toBeVisible();
  await expect(linkDaConta(page, id, "&trocar=chaves")).toBeVisible();
  await semRolagemHorizontal(page);
  await todosOsAlvosTem44(page);
  await page.screenshot({ path: testInfo.outputPath("configuracoes.png"), fullPage: true });

  // Posições: a seção Contas Meu Pluggy fica na coluna da Casal (celular: uma coluna; tablet: a primeira; desktop: a primeira).
  const casal = await page.getByRole("heading", { level: 2, name: "Casal", exact: true }).boundingBox();
  const contas = await titulo.boundingBox();
  if (casal === null || contas === null) throw new Error("Sem caixa para as seções.");
  expect(Math.abs(contas.x - casal.x)).toBeLessThanOrEqual(1);
  expect(contas.y).toBeGreaterThan(casal.y);
  if (largura === "desktop") {
    const ciclo = await page
      .getByRole("heading", { level: 2, name: "Ciclo e orçamento", exact: true })
      .boundingBox();
    expect(ciclo?.x ?? 0).toBeGreaterThan(casal.x);
  }
});

test("cenário 2: chaves erradas mostram a mensagem da spec e não liberam Continuar", async ({ page }) => {
  await signUpAndSignIn(page);
  await page.goto(ROTA);
  await page.getByLabel("Nome desta conexão").fill(ROTULO);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Client ID").fill(CLIENT_ID);
  await page.getByLabel("Client Secret").fill(SEGREDO_ERRADO);
  await page.getByRole("button", { name: "Testar chaves" }).click();
  await expect(
    page.getByText("O Meu Pluggy recusou estas chaves. Confira o Client ID e o Client Secret."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuar" })).toBeDisabled();
  await semRolagemHorizontal(page);
});

test("cenário 5: banco sem nome pede o nome no cartão, e sem o nome o botão não conecta", async ({
  page,
}) => {
  await signUpAndSignIn(page);
  await page.goto(ROTA);
  await ateOPassoTres(page);
  // O item da conta sem banco: o falso não diz o banco, então a tela pede o nome.
  await page.getByLabel("Id do banco no Meu Pluggy").fill("00000000-0000-4000-8000-0000000000e5");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByLabel("Nome do banco")).toBeVisible();
  await page.getByLabel("Nome do banco").fill("[TEST] Banco Teste");
  await page.getByRole("button", { name: "Conectar 1 banco" }).click();
  await expect(page.getByRole("heading", { name: `${ROTULO} conectada` })).toBeVisible();
});

test("cenário 6: nome genérico e id que o Pluggy não acha, com as mensagens da spec", async ({ page }) => {
  await signUpAndSignIn(page);
  await page.goto(ROTA);
  await page.getByLabel("Nome desta conexão").fill("Sua conta");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(
    page.getByText("Use o nome de quem é a conta, para aparecer igual para os dois."),
  ).toBeVisible();
  await page.getByLabel("Nome desta conexão").fill(ROTULO);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Client ID").fill(CLIENT_ID);
  await page.getByLabel("Client Secret").fill(SEGREDO);
  await page.getByRole("button", { name: "Testar chaves" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Id do banco no Meu Pluggy").fill("00000000-0000-4000-8000-0000000000ff");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(
    page.getByText("Não achamos este id no Meu Pluggy. Confira se copiou o id inteiro."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Escolha um banco" })).toBeDisabled();
});

test("cenário 9: 'Trocar chaves' abre só o passo 2, e salvar volta a Configurações com o aviso", async ({
  page,
}) => {
  await signUpAndSignIn(page);
  await page.goto(ROTA);
  await ateOPassoTres(page);
  await page.getByLabel("Id do banco no Meu Pluggy").fill(ITEM_ITAU);
  await page.getByRole("button", { name: "Adicionar" }).click();
  await page.getByRole("button", { name: "Conectar 1 banco" }).click();
  await expect(page.getByRole("heading", { name: `${ROTULO} conectada` })).toBeVisible();

  await page.goto("/configuracoes");
  await linkDaConta(page, idDaConta(), "&trocar=chaves").click();
  await expect(page.getByRole("heading", { name: "Cole as chaves da API" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar chaves" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuar" })).toHaveCount(0);
  await page.getByLabel("Client ID").fill(CLIENT_ID_NOVO);
  await page.getByLabel("Client Secret").fill(SEGREDO_NOVO);
  await page.getByRole("button", { name: "Salvar chaves" }).click();
  await expect(page).toHaveURL(/\/configuracoes$/);
  await expect(page.getByText("Chaves trocadas.")).toBeVisible();
});

test("cenário 14: conta sem chaves (restaurada) mostra 'Sem chaves' e o texto para colar de novo", async ({
  page,
}) => {
  await signUpAndSignIn(page);
  await page.goto(ROTA);
  await ateOPassoTres(page);
  await page.getByLabel("Id do banco no Meu Pluggy").fill(ITEM_ITAU);
  await page.getByRole("button", { name: "Adicionar" }).click();
  await page.getByRole("button", { name: "Conectar 1 banco" }).click();
  await expect(page.getByRole("heading", { name: `${ROTULO} conectada` })).toBeVisible();

  executaSql(
    "pronta",
    `UPDATE pluggy_connections SET client_id_enc = NULL, iv = NULL, client_secret_enc = NULL, client_secret_iv = NULL WHERE label = '${ROTULO}'`,
  );
  await page.goto("/configuracoes");
  const id = idDaConta();
  await expect(cartaoDaConta(page, id).getByText("Sem chaves", { exact: true })).toBeVisible();
  await expect(
    cartaoDaConta(page, id).getByText(
      "As chaves não vêm no backup. Cole de novo para os bancos desta conta voltarem a atualizar.",
    ),
  ).toBeVisible();
  await semRolagemHorizontal(page);
});

test("outro banco da mesma conta abre no passo 3 com o título próprio", async ({ page }) => {
  await signUpAndSignIn(page);
  await page.goto(ROTA);
  await ateOPassoTres(page);
  await page.getByLabel("Id do banco no Meu Pluggy").fill(ITEM_ITAU);
  await page.getByRole("button", { name: "Adicionar" }).click();
  await page.getByRole("button", { name: "Conectar 1 banco" }).click();
  await expect(page.getByRole("heading", { name: `${ROTULO} conectada` })).toBeVisible();

  await page.goto("/configuracoes");
  await linkDaConta(page, idDaConta(), "").click();
  await expect(page.getByText("Autorizar outro banco desta conta", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cole o id de cada banco" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Escolha um banco" })).toBeDisabled();
});
