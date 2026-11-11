import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { consultaSql, executaSql, PORTA_DA_CONFIGURACAO } from "./helpers/db";
import { semeiaSessaoDaInstalacaoPronta, signUpAndSignIn } from "./helpers/sessao";
import {
  CODIGO_DE_TESTE,
  esperaInstalacao,
  preparaConfiguracaoDoZero,
  semearInstalacaoPronta,
} from "./helpers/setup";
import { ligaAutenticadorVirtual } from "./helpers/webauthn";
import { marca } from "./marca";

// Configurações (TASK-0107). Dois jeitos de chegar ao lar:
// - a instalação pronta (8788), com a sessão semeada: lar com uma pessoa (cenários 2, 4, 6, 7, 8 e 9);
// - a configuração do zero (8790), com cadastro de verdade e convite aceito: lar com duas pessoas (cenários 1, 3 e 5).
// As três larguras são os projetos do Playwright (390, 834 e 1440 px). Os textos vêm da marca (dev/marca.json).
const versao = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version as string;
const TITULAR = "[TEST] Pessoa A";
const CONJUGE = "[TEST] Pessoa B";
const EMAIL_DO_CONJUGE = "pessoa.b@example.com";
const ORIGEM = `http://localhost:${PORTA_DA_CONFIGURACAO}`;

const hashDe = (texto: string) => createHash("sha256").update(texto).digest("hex");

// Alvo de toque: pelo menos 44 px de altura e de largura, medido pelo navegador.
async function alvoDeToqueDeNoMinimo44(alvo: Locator): Promise<void> {
  await expect(alvo).toBeVisible();
  const caixa = await alvo.boundingBox();
  expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(caixa?.width ?? 0).toBeGreaterThanOrEqual(44);
}

// Posição e tamanho do elemento (o boundingBox do navegador).
async function caixaDe(alvo: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  await expect(alvo).toBeVisible();
  const caixa = await alvo.boundingBox();
  if (!caixa) throw new Error("O elemento não tem caixa na página.");
  return caixa;
}

// As seções nas três larguras (cenário 2): uma coluna na ordem da tabela no celular; duas no tablet; três no desktop.
async function provaDasColunas(page: Page): Promise<void> {
  const titulo = (nome: string) => page.getByRole("heading", { level: 2, name: nome, exact: true });
  const casal = await caixaDe(titulo("Casal"));
  const ciclo = await caixaDe(titulo("Ciclo e orçamento"));
  // Notificações (TASK-0701) entra antes de Sincronização, na coluna 2 do tablet e na 3 do desktop.
  const notificacoes = await caixaDe(titulo("Notificações"));
  const sincronizacao = await caixaDe(titulo("Sincronização"));
  const dados = await caixaDe(titulo("Dados"));
  // A seção Renda fixa (TASK-0901) entra no registro com tabletColumn 2 e desktopColumn 2.
  const rendaFixa = await caixaDe(titulo("Renda fixa"));

  const projeto = test.info().project.name;
  if (projeto === "celular") {
    expect(casal.y).toBeLessThan(ciclo.y);
    expect(ciclo.y).toBeLessThan(notificacoes.y);
    expect(notificacoes.y).toBeLessThan(sincronizacao.y);
    expect(sincronizacao.y).toBeLessThan(dados.y);
    expect(Math.abs(casal.x - sincronizacao.x)).toBeLessThanOrEqual(1);
    return;
  }
  if (projeto === "tablet") {
    // Coluna 1: Casal e Ciclo. Coluna 2: Renda fixa, Notificações, Sincronização e Dados. Casal e Renda fixa começam no mesmo topo.
    expect(Math.abs(ciclo.x - casal.x)).toBeLessThanOrEqual(1);
    expect(ciclo.y).toBeGreaterThan(casal.y);
    expect(rendaFixa.x).toBeGreaterThan(casal.x + casal.width / 2);
    expect(Math.abs(rendaFixa.y - casal.y)).toBeLessThanOrEqual(2);
    expect(notificacoes.x).toBeGreaterThan(casal.x + casal.width / 2);
    expect(Math.abs(notificacoes.x - rendaFixa.x)).toBeLessThanOrEqual(1);
    expect(notificacoes.y).toBeGreaterThan(rendaFixa.y);
    expect(Math.abs(sincronizacao.x - notificacoes.x)).toBeLessThanOrEqual(1);
    expect(sincronizacao.y).toBeGreaterThan(notificacoes.y);
    expect(Math.abs(dados.x - sincronizacao.x)).toBeLessThanOrEqual(1);
    expect(dados.y).toBeGreaterThan(sincronizacao.y);
    return;
  }
  // Desktop: Casal à esquerda, Ciclo no meio, Notificações, Sincronização e Dados à direita, os três primeiros do mesmo topo.
  expect(casal.x).toBeLessThan(ciclo.x);
  expect(ciclo.x).toBeLessThan(notificacoes.x);
  expect(Math.abs(casal.y - ciclo.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(casal.y - notificacoes.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(notificacoes.x - sincronizacao.x)).toBeLessThanOrEqual(1);
  expect(sincronizacao.y).toBeGreaterThan(notificacoes.y);
  expect(Math.abs(dados.x - sincronizacao.x)).toBeLessThanOrEqual(1);
  expect(dados.y).toBeGreaterThan(sincronizacao.y);
}

// Nenhuma rolagem horizontal da página.
async function semRolagemHorizontal(page: Page): Promise<void> {
  const sobra = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sobra).toBeLessThanOrEqual(0);
}

// ---- A instalação pronta (8788): a sessão semeada, e o ciclo volta ao dia 11 antes de cada teste. ----
test.describe("lar com uma pessoa (instalação pronta)", () => {
  test.beforeEach(() => {
    semearInstalacaoPronta();
    semeiaSessaoDaInstalacaoPronta();
    executaSql("pronta", "UPDATE households SET cycle_start_day = 11");
  });

  test("cenário 2: as seções nas três larguras, sem rolagem lateral, com alvos de 44 px", async ({
    page,
  }) => {
    await signUpAndSignIn(page);
    await page.goto("/configuracoes");
    await expect(page.getByRole("heading", { name: "Configurações", exact: true })).toBeVisible();

    await provaDasColunas(page);
    await semRolagemHorizontal(page);
    await alvoDeToqueDeNoMinimo44(page.getByRole("button", { name: /Início do ciclo/ }));
    await alvoDeToqueDeNoMinimo44(page.getByRole("link", { name: /\[TEST\] Pessoa A/ }));
    await alvoDeToqueDeNoMinimo44(page.getByRole("button", { name: /^Sair/ }));

    // As opções do seletor também são alvos: o primeiro e o último dia, e os botões do rodapé do painel.
    await page.getByRole("button", { name: /Início do ciclo/ }).click();
    await alvoDeToqueDeNoMinimo44(page.getByRole("radio", { name: "1", exact: true }));
    await alvoDeToqueDeNoMinimo44(page.getByRole("radio", { name: "28", exact: true }));
    await alvoDeToqueDeNoMinimo44(page.getByRole("button", { name: "Salvar", exact: true }));
    await alvoDeToqueDeNoMinimo44(page.getByRole("button", { name: "Cancelar", exact: true }));
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(page.getByRole("button", { name: /Início do ciclo/ })).toContainText("Dia 11");
  });

  test("cenário 4: casal sozinho, '+ Adicionar cônjuge' abre a tela do convite", async ({ page }) => {
    await signUpAndSignIn(page);
    await page.goto("/configuracoes");

    await expect(page.getByText("Criou a conta · 1 aparelho")).toBeVisible();
    // A frase do topo do Casal: o nome da marca vem do build de teste (dev/marca.json), com o artigo.
    await expect(
      page.getByText(`O ${marca.name} é de vocês dois. Cada um entra com a própria passkey.`, {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("link", { name: "+ Adicionar cônjuge" }).click();

    await expect(page).toHaveURL(/\/configuracoes\/casal\/adicionar-conjuge$/);
    await expect(page.getByLabel("Nome do cônjuge")).toBeVisible();
  });

  test("cenário 6: 'Atualização diária' mostra 00:00, sem seta, e tocar nela não abre nada", async ({
    page,
  }) => {
    await signUpAndSignIn(page);
    await page.goto("/configuracoes");

    const linha = page.getByText("Atualização diária", { exact: true });
    await expect(linha).toBeVisible();
    await expect(page.getByText("Toda noite, automaticamente")).toBeVisible();
    await expect(page.getByText("00:00", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Atualização diária/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Atualização diária/ })).toHaveCount(0);

    await linha.click();
    await expect(page).toHaveURL(/\/configuracoes$/);
    await expect(page.getByRole("radiogroup")).toHaveCount(0);
  });

  test("cenário 7: a API recusa o dia (400 validacao): o texto do campo aparece no painel e a linha não muda", async ({
    page,
  }) => {
    await signUpAndSignIn(page);
    // A recusa simulada: o PATCH responde 400 com o texto do campo. O GET segue para o servidor de verdade.
    await page.route("**/api/household", async (rota) => {
      if (rota.request().method() !== "PATCH") return rota.continue();
      return rota.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "validacao",
          message: "Dados inválidos.",
          fields: { cycleStartDay: "O ciclo começa entre o dia 1 e o dia 28." },
        }),
      });
    });
    await page.goto("/configuracoes");

    await page.getByRole("button", { name: /Início do ciclo/ }).click();
    await page.getByRole("radio", { name: "5", exact: true }).click();
    await page.getByRole("button", { name: "Salvar", exact: true }).click();

    await expect(page.getByRole("alert")).toContainText("O ciclo começa entre o dia 1 e o dia 28.");
    await expect(page.getByRole("radiogroup")).toBeVisible();
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(page.getByRole("button", { name: /Início do ciclo/ })).toContainText("Dia 11");
  });

  test("cenário 8: sem rede ao salvar, a mensagem aparece e o valor antigo continua na linha", async ({
    page,
  }) => {
    await signUpAndSignIn(page);
    await page.route("**/api/household", async (rota) => {
      if (rota.request().method() !== "PATCH") return rota.continue();
      return rota.abort("internetdisconnected");
    });
    await page.goto("/configuracoes");

    await page.getByRole("button", { name: /Início do ciclo/ }).click();
    await page.getByRole("radio", { name: "7", exact: true }).click();
    await page.getByRole("button", { name: "Salvar", exact: true }).click();

    await expect(page.getByRole("alert")).toContainText("Não deu para salvar agora. Tente de novo.");
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(page.getByRole("button", { name: /Início do ciclo/ })).toContainText("Dia 11");
  });

  test("cenário 9: Sair vai para /entrar e a sessão some do banco; a versão aparece na linha", async ({
    page,
  }) => {
    // Uma sessão só deste teste: a da instalação pronta continua valendo para os outros testes.
    const token = "E2E-SESSAO-0107-sair-token-de-teste-00000001";
    const agora = new Date();
    const expira = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    executaSql(
      "pronta",
      `INSERT OR REPLACE INTO sessions (token_hash, member_id, passkey_id, created_at, last_seen_at, expires_at, notices_seen_at) VALUES ('${hashDe(token)}', 'e2e-pessoa-pronta', 'e2e-passkey-pronta', '${agora.toISOString()}', '${agora.toISOString()}', '${expira}', NULL)`,
    );
    await page
      .context()
      .addCookies([
        { name: "mm_sess", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
      ]);
    await page.goto("/configuracoes");

    await expect(page.getByText(`Versão ${versao}`)).toBeVisible();
    await page.getByRole("button", { name: /^Sair/ }).click();

    await expect(page).toHaveURL(/\/entrar$/);
    const restantes = consultaSql(
      "pronta",
      `SELECT COUNT(*) AS n FROM sessions WHERE token_hash = '${hashDe(token)}'`,
    )[0];
    expect(Number(restantes?.n ?? -1)).toBe(0);
  });

  test("cenário 9b: Sair sem rede fica em /configuracoes, com o aviso, e a sessão continua; com a rede de volta, sai", async ({
    page,
  }) => {
    // Uma sessão só deste teste, como no cenário 9: a da instalação pronta não é tocada.
    const token = "E2E-SESSAO-0107-sair-falha-token-00000002";
    const agora = new Date();
    const expira = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    executaSql(
      "pronta",
      `INSERT OR REPLACE INTO sessions (token_hash, member_id, passkey_id, created_at, last_seen_at, expires_at, notices_seen_at) VALUES ('${hashDe(token)}', 'e2e-pessoa-pronta', 'e2e-passkey-pronta', '${agora.toISOString()}', '${agora.toISOString()}', '${expira}', NULL)`,
    );
    const sessoesDoTeste = () =>
      Number(
        consultaSql("pronta", `SELECT COUNT(*) AS n FROM sessions WHERE token_hash = '${hashDe(token)}'`)[0]
          ?.n ?? -1,
      );
    await page
      .context()
      .addCookies([
        { name: "mm_sess", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
      ]);
    await page.goto("/configuracoes");
    await expect(page.getByText(`Versão ${versao}`)).toBeVisible();

    // A rede cai só na saída: o POST do logout não chega ao servidor.
    await page.route("**/api/auth/logout", (rota) => rota.abort("internetdisconnected"));
    await page.getByRole("button", { name: /^Sair/ }).click();

    await expect(page.getByRole("alert")).toContainText("Não deu para sair agora. Tente de novo.");
    await expect(page).toHaveURL(/\/configuracoes$/);
    expect(sessoesDoTeste()).toBe(1);

    // Com a rede de volta, a linha volta a aceitar o toque, e a saída termina em /entrar.
    await page.unroute("**/api/auth/logout");
    await page.getByRole("button", { name: /^Sair/ }).click();

    await expect(page).toHaveURL(/\/entrar$/);
    expect(sessoesDoTeste()).toBe(0);
  });
});

// ---- A configuração do zero (8790): o cadastro de verdade, o convite e o segundo aparelho. ----
test.describe("lar com duas pessoas (configuração do zero)", () => {
  test.use({ baseURL: ORIGEM });

  test.beforeAll(async () => {
    await esperaInstalacao(PORTA_DA_CONFIGURACAO);
  });

  test.beforeEach(() => {
    preparaConfiguracaoDoZero();
  });

  test("cenário 1: o lar com duas pessoas: cada uma na sua linha, com os aparelhos e os selos", async ({
    page,
    browser,
  }) => {
    await ligaAutenticadorVirtual(page);
    await cadastraTitular(page);
    const link = await criaConvite(page);
    const conjuge = await conjugeAceita(browser, link);
    try {
      await page.goto("/configuracoes");

      await expect(page.getByText("Criou a conta · 1 aparelho")).toBeVisible();
      await expect(page.getByRole("link", { name: /\[TEST\] Pessoa B/ })).toContainText(
        `${EMAIL_DO_CONJUGE} · 1 aparelho`,
      );
      await expect(page.getByText("Titular", { exact: true })).toBeVisible();
      await expect(page.getByText("Cônjuge", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "+ Adicionar cônjuge" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Início do ciclo/ })).toContainText("Dia 11");
    } finally {
      await conjuge.fecha();
    }
  });

  test("cenário 3: com convite aguardando, a linha abre a tela de Adicionar cônjuge", async ({ page }) => {
    await ligaAutenticadorVirtual(page);
    await cadastraTitular(page);
    await criaConvite(page);

    await page.goto("/configuracoes");
    const linha = page.getByRole("link", { name: /Aguardando entrar/ });
    await expect(linha).toContainText(EMAIL_DO_CONJUGE);
    await expect(linha).toContainText(/vence \d{2}\/\d{2}/);
    await linha.click();

    await expect(page).toHaveURL(/\/configuracoes\/casal\/adicionar-conjuge$/);
    await expect(page.getByRole("heading", { name: "Convite aguardando" })).toBeVisible();
  });

  test("cenário 5: o dia novo fica depois de recarregar, e o cônjuge vê o mesmo dia", async ({
    page,
    browser,
  }) => {
    await ligaAutenticadorVirtual(page);
    await cadastraTitular(page);
    const link = await criaConvite(page);
    const conjuge = await conjugeAceita(browser, link);
    try {
      await page.goto("/configuracoes");
      await page.getByRole("button", { name: /Início do ciclo/ }).click();
      await page.getByRole("radio", { name: "5", exact: true }).click();
      await page.getByRole("button", { name: "Salvar", exact: true }).click();

      const linhaDoCiclo = page.getByRole("button", { name: /Início do ciclo/ });
      await expect(linhaDoCiclo).toContainText("Dia 5");
      await expect(linhaDoCiclo).toContainText("Do dia 5 ao dia 4 do mês seguinte");

      await page.reload();
      await expect(page.getByRole("button", { name: /Início do ciclo/ })).toContainText("Dia 5");

      await conjuge.pagina.goto("/configuracoes");
      await expect(conjuge.pagina.getByRole("button", { name: /Início do ciclo/ })).toContainText("Dia 5");
    } finally {
      await conjuge.fecha();
    }
  });
});

// ---- Auxiliares da configuração do zero (os mesmos passos da TASK-0105 e da TASK-0106). ----

// Cadastro do titular pelo fluxo da tela, com o autenticador ligado: chega ao início com a sessão aberta.
async function cadastraTitular(page: Page): Promise<void> {
  await page.goto(`/configuracao-inicial#codigo=${CODIGO_DE_TESTE}`);
  await expect(page.getByRole("heading", { name: "Conecte a IA" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar sem IA", exact: true }).click();
  await page.getByRole("button", { name: "Continuar sem IA", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tudo pronto para começar" })).toBeVisible();
  await page.getByRole("link", { name: /Começar do zero/ }).click();
  await expect(page.getByRole("heading", { name: "Criar conta do casal" })).toBeVisible();
  await page.getByLabel("Seu nome").fill(TITULAR);
  await page.getByLabel("Seu e-mail (opcional)").fill("pessoa.a@example.com");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Crie sua passkey" })).toBeVisible();
  await page.getByRole("button", { name: "Criar passkey", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Adicione seu cônjuge" })).toBeVisible();
  await page.getByRole("button", { name: "Adicionar depois", exact: true }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

// Pelas Configurações › Casal: preenche o cônjuge e cria o convite. Devolve o link que a API mostrou (uma vez).
async function criaConvite(page: Page): Promise<string> {
  await page.goto("/configuracoes/casal/adicionar-conjuge");
  await expect(page.getByLabel("Nome do cônjuge")).toBeVisible();
  await page.getByLabel("Nome do cônjuge").fill(CONJUGE);
  await page.getByLabel("E-mail do cônjuge (opcional)").fill(EMAIL_DO_CONJUGE);
  const resposta = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/api/invites/conjuge"),
  );
  await page.getByRole("button", { name: "Adicionar cônjuge", exact: true }).click();
  const { link } = (await (await resposta).json()) as { link: string };
  await expect(page.getByRole("heading", { name: "Convite criado" })).toBeVisible();
  return link;
}

// O cônjuge aceita o convite num aparelho próprio (outro contexto, com o próprio autenticador).
async function conjugeAceita(
  browser: Browser,
  link: string,
): Promise<{ pagina: Page; fecha: () => Promise<void> }> {
  const contexto = await browser.newContext({ baseURL: ORIGEM });
  const pagina = await contexto.newPage();
  await ligaAutenticadorVirtual(pagina);
  await pagina.goto(link);
  await expect(pagina.getByRole("heading", { name: "Crie seu acesso" })).toBeVisible();
  await pagina.getByLabel("Seu nome no app").fill(CONJUGE);
  await pagina.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(pagina.getByRole("heading", { name: "Crie sua passkey" })).toBeVisible();
  await pagina.getByRole("button", { name: "Criar passkey", exact: true }).click();
  await expect(pagina).toHaveURL(/\/inicio$/);
  return { pagina, fecha: () => contexto.close() };
}
