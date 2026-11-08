import { createHash, randomBytes } from "node:crypto";
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { consultaSql, executaSql, PORTA_DA_CONFIGURACAO } from "./helpers/db";
import { CODIGO_DE_TESTE, esperaInstalacao, preparaConfiguracaoDoZero } from "./helpers/setup";
import { type AutenticadorVirtual, ligaAutenticadorVirtual } from "./helpers/webauthn";

// Aparelhos e recuperação (TASK-0106), na instância de configuração do zero (8790). Titular e cônjuge são duas pessoas,
// cada uma num contexto do navegador com o próprio autenticador virtual (passkey de verdade). A base é localhost,
// porque o WebAuthn não aceita IP como rpID. As três larguras são os projetos do Playwright (390, 834 e 1440).
test.use({ baseURL: `http://localhost:${PORTA_DA_CONFIGURACAO}` });

const ORIGEM = `http://localhost:${PORTA_DA_CONFIGURACAO}`;
const TITULAR = "[TEST] Pessoa A";
const CONJUGE = "[TEST] Pessoa B";
const EMAIL_DO_CONJUGE = "pessoa.b@example.com";

test.beforeAll(async () => {
  await esperaInstalacao(PORTA_DA_CONFIGURACAO);
});

test.beforeEach(() => {
  preparaConfiguracaoDoZero();
});

const contagem = (sql: string): number => Number(consultaSql("configuracao", sql)[0]?.n ?? -1);

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

// Um link de recuperação do comando (npm run recuperar-acesso), gravado no D1 de teste com o mesmo formato do script.
function criaLinkDoComando(): { token: string } {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const agora = new Date();
  const expira = new Date(agora.getTime() + 60 * 60 * 1000).toISOString();
  const membro = consultaSql(
    "configuracao",
    "SELECT id, household_id FROM members WHERE role = 'conjuge' LIMIT 1",
  )[0] as { id: string; household_id: string } | undefined;
  if (!membro) throw new Error("O cônjuge do teste não existe para o link do comando.");
  executaSql(
    "configuracao",
    `INSERT INTO invites (id, household_id, kind, token_hash, member_id, created_by, created_at, expires_at) VALUES ('${crypto.randomUUID()}', '${membro.household_id}', 'recuperacao', '${hash}', '${membro.id}', NULL, '${agora.toISOString()}', '${expira}')`,
  );
  return { token };
}

// Pega o link que a tela de Liberar acesso mostrou: o botão de copiar põe o link na área de transferência.
async function copiaLinkDeRecuperacao(page: Page, pessoa: string): Promise<string> {
  await page.getByRole("button", { name: `Liberar acesso de ${pessoa}` }).click();
  await page.getByRole("button", { name: "Gerar link", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copiar link", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Copiar link", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Link copiado.");
  // A frase do pé diz quem entra: a pessoa que perdeu o acesso, e não "cônjuge".
  await expect(page.getByText(`entra como ${pessoa}`)).toBeVisible();
  await expect(page.getByText("entra como cônjuge")).toHaveCount(0);
  return page.evaluate(() => navigator.clipboard.readText());
}

// Número de aparelhos de cada pessoa na lista da tela (a lista de cada cartão está dentro da moldura principal).
const listas = (page: Page) => page.getByRole("main").getByRole("list");

// Área de toque de pelo menos 44 px de altura e de largura (manual: áreas de toque), medida pelo navegador.
async function alvoDeToqueDeNoMinimo44(botao: Locator): Promise<void> {
  await expect(botao).toBeVisible();
  const caixa = await botao.boundingBox();
  expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(caixa?.width ?? 0).toBeGreaterThanOrEqual(44);
}

// Os cartões das pessoas: no tablet e no desktop, lado a lado (o mesmo y do nome); no celular, um embaixo do outro.
async function provaDasColunas(page: Page): Promise<void> {
  const titular = page.getByRole("heading", { level: 2, name: TITULAR, exact: true });
  const conjuge = page.getByRole("heading", { level: 2, name: CONJUGE, exact: true });
  await expect(titular).toBeVisible();
  await expect(conjuge).toBeVisible();
  const diferenca = ((await conjuge.boundingBox())?.y ?? 0) - ((await titular.boundingBox())?.y ?? 0);
  if (test.info().project.name === "celular") {
    expect(diferenca).toBeGreaterThan(50);
  } else {
    expect(Math.abs(diferenca)).toBeLessThanOrEqual(1);
  }
}

test("cenários 8 e 9: o titular libera o acesso; o cônjuge entra num aparelho novo; o aparelho antigo vê a faixa e 'Foi eu' a esconde; o titular não vê", async ({
  page,
  browser,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGEM });
  await ligaAutenticadorVirtual(page);
  await cadastraTitular(page);
  const link = await criaConvite(page);

  // O cônjuge entra no aparelho antigo, que fica aberto.
  const antigo = await conjugeAceita(browser, link);
  try {
    // O titular libera o acesso ao cônjuge e copia o link de 15 minutos.
    await page.goto("/configuracoes/casal");
    await expect(page.getByRole("heading", { name: "Casal e aparelhos" })).toBeVisible();
    await provaDasColunas(page);
    const linkDeRecuperacao = await copiaLinkDeRecuperacao(page, CONJUGE);
    expect(linkDeRecuperacao).toMatch(/\/recuperar\/[A-Za-z0-9_-]{43}$/);
    const token = linkDeRecuperacao.slice(linkDeRecuperacao.indexOf("/recuperar/") + "/recuperar/".length);

    // O cônjuge abre o link num aparelho novo, sem nenhuma passkey.
    const contexto = await browser.newContext({ baseURL: ORIGEM });
    const novo = await contexto.newPage();
    try {
      await ligaAutenticadorVirtual(novo);
      await novo.goto(linkDeRecuperacao);
      await expect(novo.getByText(`${TITULAR} liberou um aparelho novo para você`)).toBeVisible();
      await expect(novo.getByRole("heading", { name: "Cadastre uma passkey neste aparelho" })).toBeVisible();
      // A barra do navegador não mostra o token: a tela trocou a URL antes de mostrar o cadastro.
      expect(novo.url()).not.toContain(token);
      await novo.getByRole("button", { name: "Criar passkey", exact: true }).click();
      await expect(novo).toHaveURL(/\/inicio$/);

      // O banco: uma passkey 'recuperacao' do cônjuge, o link gasto e a sessão nova.
      expect(contagem("SELECT COUNT(*) AS n FROM passkeys WHERE added_via = 'recuperacao'")).toBe(1);
      expect(
        contagem("SELECT COUNT(*) AS n FROM invites WHERE kind = 'recuperacao' AND used_at IS NOT NULL"),
      ).toBe(1);

      // O aparelho antigo vê a faixa; o titular não.
      await antigo.pagina.goto("/inicio");
      await expect(antigo.pagina.getByText(/Um aparelho novo \(/)).toBeVisible();
      await expect(antigo.pagina.getByText(/por um link de recuperação/)).toBeVisible();
      await page.goto("/inicio");
      await expect(page).toHaveURL(/\/inicio$/);
      await expect(page.getByText(/Um aparelho novo/)).toHaveCount(0);

      // "Foi eu" esconde a faixa neste aparelho.
      await alvoDeToqueDeNoMinimo44(antigo.pagina.getByRole("button", { name: "Foi eu", exact: true }));
      await antigo.pagina.getByRole("button", { name: "Foi eu", exact: true }).click();
      await expect(antigo.pagina.getByText(/Um aparelho novo/)).toHaveCount(0);
      await antigo.pagina.reload();
      await expect(antigo.pagina.getByText(/Um aparelho novo/)).toHaveCount(0);

      // O aparelho novo remove o aparelho antigo do cônjuge. O antigo, na próxima navegação, vai para entrar.
      await novo.goto("/configuracoes/casal");
      await expect(novo.getByRole("heading", { name: "Casal e aparelhos" })).toBeVisible();
      await alvoDeToqueDeNoMinimo44(
        listas(novo).nth(1).getByRole("button", { name: "Remover", exact: true }).first(),
      );
      await listas(novo).nth(1).getByRole("button", { name: "Remover", exact: true }).first().click();
      await novo.getByRole("dialog").getByRole("button", { name: "Remover", exact: true }).click();
      await expect(novo.getByRole("status")).toContainText("Aparelho removido.");

      await antigo.pagina.goto("/inicio");
      await expect(antigo.pagina).toHaveURL(/\/entrar$/);
      expect(
        contagem(
          "SELECT COUNT(*) AS n FROM sessions WHERE member_id = (SELECT id FROM members WHERE role = 'conjuge') AND passkey_id = (SELECT id FROM passkeys WHERE added_via = 'convite')",
        ),
      ).toBe(0);

      // O aparelho novo remove o próprio aparelho em uso: sai na hora e vai para entrar.
      await novo.goto("/configuracoes/casal");
      await listas(novo).nth(1).getByRole("button", { name: "Remover", exact: true }).first().click();
      await novo.getByRole("dialog").getByRole("button", { name: "Remover", exact: true }).click();
      await expect(novo).toHaveURL(/\/entrar$/);
    } finally {
      await contexto.close();
    }
  } finally {
    await antigo.fecha();
  }
});

test("cenário 2: o titular adiciona este aparelho; o aparelho repetido é recusado; remover o celular depois não derruba este computador", async ({
  page,
}) => {
  const primeiro: AutenticadorVirtual = await ligaAutenticadorVirtual(page);
  await cadastraTitular(page);

  await page.goto("/configuracoes/casal");
  await expect(page.getByRole("heading", { name: "Casal e aparelhos" })).toBeVisible();
  // O aparelho já tem a passkey do cadastro: o navegador recusa criar outra.
  await page.getByRole("button", { name: "Adicionar este aparelho", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Este aparelho já tem uma passkey sua.");

  // Outro aparelho (um autenticador vazio): a passkey nova entra e a sessão passa a depender dela.
  await primeiro.cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: primeiro.id });
  await ligaAutenticadorVirtual(page);
  await page.getByRole("button", { name: "Adicionar este aparelho", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Este aparelho entrou na lista.");
  expect(contagem("SELECT COUNT(*) AS n FROM passkeys WHERE added_via = 'aparelho'")).toBe(1);

  // O primeiro aparelho (o celular do cadastro) sai da lista. Este computador continua logado.
  await listas(page).nth(0).getByRole("button", { name: "Remover", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Remover", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Aparelho removido.");
  await page.goto("/inicio");
  await expect(page).toHaveURL(/\/inicio$/);
});

test("cenário 10 e pelo comando (nível 3): o link de npm run recuperar-acesso abre com a frase do comando e cadastra a passkey", async ({
  page,
  browser,
}) => {
  await ligaAutenticadorVirtual(page);
  await cadastraTitular(page);
  const link = await criaConvite(page);
  const antigo = await conjugeAceita(browser, link);
  try {
    // Um link de uso único que o comando teria gerado, para o cônjuge (sem parceiro que o tenha criado).
    const { token } = criaLinkDoComando();
    const contexto = await browser.newContext({ baseURL: ORIGEM });
    const novo = await contexto.newPage();
    try {
      await ligaAutenticadorVirtual(novo);
      await novo.goto(`/recuperar/${token}`);
      await expect(novo.getByText("Link gerado pelo comando de recuperação da instalação")).toBeVisible();
      await expect(novo.getByRole("heading", { name: "Cadastre uma passkey neste aparelho" })).toBeVisible();
      expect(novo.url()).not.toContain(token);
      await novo.getByRole("button", { name: "Criar passkey", exact: true }).click();
      await expect(novo).toHaveURL(/\/inicio$/);
    } finally {
      await contexto.close();
    }
  } finally {
    await antigo.fecha();
  }
});

test("cenário 10: link vencido mostra a hora do vencimento, e link inválido diz para conferir a cópia", async ({
  page,
  browser,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGEM });
  await ligaAutenticadorVirtual(page);
  await cadastraTitular(page);
  const link = await criaConvite(page);
  const antigo = await conjugeAceita(browser, link);
  try {
    await page.goto("/configuracoes/casal");
    const linkDeRecuperacao = await copiaLinkDeRecuperacao(page, CONJUGE);
    executaSql(
      "configuracao",
      "UPDATE invites SET expires_at = '2026-11-01T12:00:00.000Z' WHERE kind = 'recuperacao'",
    );
    const contexto = await browser.newContext({ baseURL: ORIGEM });
    const novo = await contexto.newPage();
    try {
      await ligaAutenticadorVirtual(novo);
      await novo.goto(linkDeRecuperacao);
      await expect(novo.getByRole("heading", { name: "Link indisponível" })).toBeVisible();
      await expect(novo.getByRole("alert")).toContainText(/Este link venceu às \d{2}:\d{2}\. Peça um novo\./);

      await novo.goto("/recuperar/token-que-nao-existe-0000000000000000000000000");
      await expect(novo.getByRole("alert")).toContainText(
        "Link de recuperação inválido. Confira se copiou o link inteiro.",
      );
    } finally {
      await contexto.close();
    }
  } finally {
    await antigo.fecha();
  }
});

test("cenário 15: o login mostra 'Perdeu o acesso ao aparelho?' e o painel explica os dois níveis", async ({
  page,
  browser,
}) => {
  await ligaAutenticadorVirtual(page);
  await cadastraTitular(page);
  // Um aparelho sem sessão: o login só mostra a tela quando não há sessão aberta.
  const contexto = await browser.newContext({ baseURL: ORIGEM });
  const sem = await contexto.newPage();
  try {
    await sem.goto("/entrar");
    await alvoDeToqueDeNoMinimo44(sem.getByRole("button", { name: "Perdeu o acesso ao aparelho?" }));
    await sem.getByRole("button", { name: "Perdeu o acesso ao aparelho?" }).click();
    await expect(sem.getByText(/Peça a quem divide o/)).toBeVisible();
    await expect(sem.getByText(/npm run recuperar-acesso/)).toBeVisible();
  } finally {
    await contexto.close();
  }
});

test("cenário 9b: 'Ver aparelhos' marca o aviso como visto, abre Casal e aparelhos, e a faixa não volta no reload", async ({
  page,
  browser,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGEM });
  await ligaAutenticadorVirtual(page);
  await cadastraTitular(page);
  const link = await criaConvite(page);
  const antigo = await conjugeAceita(browser, link);
  try {
    await page.goto("/configuracoes/casal");
    const linkDeRecuperacao = await copiaLinkDeRecuperacao(page, CONJUGE);
    const contexto = await browser.newContext({ baseURL: ORIGEM });
    const novo = await contexto.newPage();
    try {
      await ligaAutenticadorVirtual(novo);
      await novo.goto(linkDeRecuperacao);
      await expect(novo.getByRole("heading", { name: "Cadastre uma passkey neste aparelho" })).toBeVisible();
      await novo.getByRole("button", { name: "Criar passkey", exact: true }).click();
      await expect(novo).toHaveURL(/\/inicio$/);

      // O aparelho antigo vê a faixa e aperta "Ver aparelhos": marca visto e abre a tela.
      await antigo.pagina.goto("/inicio");
      await expect(antigo.pagina.getByText(/Um aparelho novo \(/)).toBeVisible();
      const verAparelhos = antigo.pagina.getByRole("button", { name: "Ver aparelhos", exact: true });
      await alvoDeToqueDeNoMinimo44(verAparelhos);
      await verAparelhos.click();
      await expect(antigo.pagina).toHaveURL(/\/configuracoes\/casal$/);
      await expect(antigo.pagina.getByRole("heading", { name: "Casal e aparelhos" })).toBeVisible();

      // No reload, a faixa não volta: o aviso ficou marcado como visto nesta sessão.
      await antigo.pagina.reload();
      await expect(antigo.pagina.getByRole("heading", { name: "Casal e aparelhos" })).toBeVisible();
      await expect(antigo.pagina.getByText(/Um aparelho novo/)).toHaveCount(0);
      expect(
        contagem("SELECT COUNT(*) AS n FROM sessions WHERE notices_seen_at IS NOT NULL"),
      ).toBeGreaterThanOrEqual(1);
    } finally {
      await contexto.close();
    }
  } finally {
    await antigo.fecha();
  }
});
