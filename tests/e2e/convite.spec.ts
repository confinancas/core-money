import { expect, type Page, test } from "@playwright/test";
import { consultaSql, executaSql, PORTA_DA_CONFIGURACAO } from "./helpers/db";
import { CODIGO_DE_TESTE, esperaInstalacao, preparaConfiguracaoDoZero } from "./helpers/setup";
import { ligaAutenticadorVirtual } from "./helpers/webauthn";

// Adicionar cônjuge e aceitar convite (TASK-0105), na instância de configuração do zero (8790). Titular e cônjuge
// são duas pessoas: cada uma num contexto do navegador, com o próprio autenticador virtual (passkey de verdade).
// A base é localhost, porque o WebAuthn não aceita IP como rpID. As três larguras são os projetos do Playwright.
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

// A pessoa convidada: outro contexto (outro aparelho), com o próprio autenticador virtual.
async function abreNoOutroAparelho(
  browser: import("@playwright/test").Browser,
  link: string,
): Promise<{ pagina: Page; fecha: () => Promise<void> }> {
  const contexto = await browser.newContext({ baseURL: ORIGEM });
  const pagina = await contexto.newPage();
  await ligaAutenticadorVirtual(pagina);
  await pagina.goto(link);
  return { pagina, fecha: () => contexto.close() };
}

test("cenários 1 e 3: o titular cria o convite e copia o link; a pessoa abre, cria o acesso e chega ao início", async ({
  page,
  browser,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGEM });
  await ligaAutenticadorVirtual(page);
  await cadastraTitular(page);

  const link = await criaConvite(page);
  expect(link).toMatch(/\/convite\/[A-Za-z0-9_-]{43}$/);
  await expect(page.getByText("Aguardando entrar", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Copiar link", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Link copiado.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  const { pagina, fecha } = await abreNoOutroAparelho(browser, link);
  try {
    await expect(pagina.getByRole("heading", { name: "Crie seu acesso" })).toBeVisible();
    // A barra do navegador não mostra o token: a tela trocou a URL depois de ler o token (TASK-0106).
    expect(pagina.url()).not.toContain("/convite/");
    expect(pagina.url()).not.toContain(link.slice(link.indexOf("/convite/") + "/convite/".length));
    await expect(pagina.getByText(`${TITULAR} adicionou você como cônjuge`)).toBeVisible();
    await expect(pagina.getByLabel("E-mail")).toHaveValue(EMAIL_DO_CONJUGE);
    await pagina.getByLabel("Seu nome no app").fill(CONJUGE);
    await pagina.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(pagina.getByRole("heading", { name: "Crie sua passkey" })).toBeVisible();
    await pagina.getByRole("button", { name: "Criar passkey", exact: true }).click();
    await expect(pagina).toHaveURL(/\/inicio$/);
  } finally {
    await fecha();
  }

  // O banco: um cônjuge com o e-mail do convite, a passkey 'convite', a sessão e o convite gasto.
  expect(
    contagem("SELECT COUNT(*) AS n FROM members WHERE role = 'conjuge' AND email = 'pessoa.b@example.com'"),
  ).toBe(1);
  expect(contagem("SELECT COUNT(*) AS n FROM passkeys WHERE added_via = 'convite'")).toBe(1);
  expect(contagem("SELECT COUNT(*) AS n FROM invites WHERE kind = 'conjuge' AND used_at IS NOT NULL")).toBe(
    1,
  );
  expect(contagem("SELECT COUNT(*) AS n FROM sessions")).toBe(2);

  // O titular, ao reabrir a tela, vê que vocês já são dois.
  await page.goto("/configuracoes/casal/adicionar-conjuge");
  await expect(page.getByText(/Vocês já são dois no/)).toBeVisible();
});

test("cenário 4: convite vencido mostra a mensagem com quem convidou e o dia do vencimento", async ({
  page,
  browser,
}) => {
  await ligaAutenticadorVirtual(page);
  await cadastraTitular(page);
  const link = await criaConvite(page);

  executaSql(
    "configuracao",
    "UPDATE invites SET expires_at = '2026-11-01T12:00:00.000Z' WHERE kind = 'conjuge'",
  );

  const { pagina, fecha } = await abreNoOutroAparelho(browser, link);
  try {
    await expect(pagina.getByRole("alert")).toContainText(
      `Este convite venceu em 01/11. Peça a ${TITULAR} um link novo.`,
    );
    await expect(pagina.getByRole("heading", { name: "Convite indisponível" })).toBeVisible();
  } finally {
    await fecha();
  }
});

test("cenário 7: cancelar o convite confirma na tela; o link deixa de funcionar", async ({
  page,
  browser,
}) => {
  await ligaAutenticadorVirtual(page);
  await cadastraTitular(page);
  const link = await criaConvite(page);

  await page.goto("/configuracoes/casal/adicionar-conjuge");
  await expect(page.getByRole("heading", { name: "Convite aguardando" })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cancelar o convite?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar convite", exact: true }).click();
  await expect(page.getByRole("button", { name: "Adicionar cônjuge", exact: true })).toBeVisible();

  const { pagina, fecha } = await abreNoOutroAparelho(browser, link);
  try {
    await expect(pagina.getByRole("alert")).toContainText("Este convite foi cancelado.");
  } finally {
    await fecha();
  }
});

test("cenário 12: pelo cadastro, no passo 3, o convite nasce e o link aparece", async ({ page }) => {
  await ligaAutenticadorVirtual(page);
  await page.goto(`/configuracao-inicial#codigo=${CODIGO_DE_TESTE}`);
  await page.getByRole("button", { name: "Continuar sem IA", exact: true }).click();
  await page.getByRole("button", { name: "Continuar sem IA", exact: true }).click();
  await page.getByRole("link", { name: /Começar do zero/ }).click();
  await page.getByLabel("Seu nome").fill(TITULAR);
  await page.getByLabel("Seu e-mail (opcional)").fill("pessoa.a@example.com");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Criar passkey", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Adicione seu cônjuge" })).toBeVisible();

  await page.getByLabel("Nome do cônjuge").fill(CONJUGE);
  await page.getByRole("button", { name: "Adicionar cônjuge", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Convite criado" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copiar link", exact: true })).toBeVisible();
  await expect(page.getByText(`${CONJUGE} · cônjuge`)).toBeVisible();
  await page.getByRole("button", { name: /^Entrar no / }).click();
  await expect(page).toHaveURL(/\/inicio$/);

  expect(
    contagem(
      "SELECT COUNT(*) AS n FROM invites WHERE kind = 'conjuge' AND used_at IS NULL AND cancelled_at IS NULL",
    ),
  ).toBe(1);
});
