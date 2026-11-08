import { expect, type Page, test } from "@playwright/test";
import { consultaSql, executaSql, PORTA_DA_CONFIGURACAO } from "./helpers/db";
import { CODIGO_DE_TESTE, esperaInstalacao, preparaConfiguracaoDoZero } from "./helpers/setup";
import { ligaAutenticadorVirtual } from "./helpers/webauthn";

// Entrar com passkey (TASK-0104), na instância de configuração do zero (8790). O cadastro é de verdade, com o
// autenticador virtual; a base é localhost, porque o WebAuthn não aceita IP como rpID (como em cadastro.spec.ts).
// As três larguras são os projetos do Playwright.
test.use({ baseURL: `http://localhost:${PORTA_DA_CONFIGURACAO}` });

const NOME = "[TEST] Pessoa A";
const EMAIL = "pessoa.a@example.com";
const BOTAO_ENTRAR = { name: "Entrar com passkey", exact: true };

test.beforeAll(async () => {
  await esperaInstalacao(PORTA_DA_CONFIGURACAO);
});

test.beforeEach(() => {
  preparaConfiguracaoDoZero();
});

// Cadastro do lar pelo fluxo da tela, com o autenticador já ligado: chega ao início com a sessão aberta.
async function cadastra(page: Page): Promise<void> {
  await page.goto(`/configuracao-inicial#codigo=${CODIGO_DE_TESTE}`);
  await expect(page.getByRole("heading", { name: "Conecte a IA" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar sem IA", exact: true }).click();
  await page.getByRole("button", { name: "Continuar sem IA", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tudo pronto para começar" })).toBeVisible();
  await page.getByRole("link", { name: /Começar do zero/ }).click();
  await expect(page.getByRole("heading", { name: "Criar conta do casal" })).toBeVisible();
  await page.getByLabel("Seu nome").fill(NOME);
  await page.getByLabel("Seu e-mail (opcional)").fill(EMAIL);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Crie sua passkey" })).toBeVisible();
  await page.getByRole("button", { name: "Criar passkey", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Adicione seu cônjuge" })).toBeVisible();
  await page.getByRole("button", { name: "Adicionar depois", exact: true }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

// Sair: a API encerra a sessão deste aparelho (o "sair" da tela chega na TASK-0107).
async function sai(page: Page): Promise<void> {
  const resposta = await page.request.post("/api/auth/logout", { data: {} });
  expect(resposta.status()).toBe(200);
  expect((await page.context().cookies()).some((cookie) => cookie.name === "mm_sess")).toBe(false);
}

const contagem = (sql: string): number => Number(consultaSql("configuracao", sql)[0]?.n ?? -1);

test("cenário 1: cadastra, sai e entra de novo com a passkey; a sessão nova leva a passkey usada", async ({
  page,
}) => {
  await ligaAutenticadorVirtual(page);
  await cadastra(page);
  await sai(page);
  expect(contagem("SELECT COUNT(*) AS n FROM sessions")).toBe(0);

  await page.goto("/entrar");
  await expect(page.getByRole("heading", { name: "Entrar", exact: true })).toBeVisible();
  await page.getByRole("button", BOTAO_ENTRAR).click();

  await expect(page).toHaveURL(/\/inicio$/);
  expect(contagem("SELECT COUNT(*) AS n FROM sessions s JOIN passkeys p ON p.id = s.passkey_id")).toBe(1);
  expect(consultaSql("configuracao", "SELECT last_used_at FROM passkeys")[0]?.last_used_at).not.toBeNull();
});

test("cenário 2: um navegador sem passkey da instalação mostra a mensagem de entrada cancelada", async ({
  page,
  browser,
}) => {
  await ligaAutenticadorVirtual(page);
  await cadastra(page);

  // Outro navegador, com o autenticador vazio: nenhuma passkey da instalação.
  const outro = await browser.newContext({ baseURL: `http://localhost:${PORTA_DA_CONFIGURACAO}` });
  try {
    const paginaDoOutro = await outro.newPage();
    await ligaAutenticadorVirtual(paginaDoOutro);
    await paginaDoOutro.goto("/entrar");
    await paginaDoOutro.getByRole("button", BOTAO_ENTRAR).click();
    await expect(paginaDoOutro.getByRole("alert")).toContainText(
      "A entrada foi cancelada, ou este aparelho não tem uma passkey do",
    );
    await expect(paginaDoOutro).toHaveURL(/\/entrar$/);
  } finally {
    await outro.close();
  }
});

test("cenário 3: entrada cancelada mostra a mensagem e não grava nada; tentar de novo entra", async ({
  page,
}) => {
  const autenticador = await ligaAutenticadorVirtual(page);
  await cadastra(page);
  await sai(page);
  const sessoesAntes = contagem("SELECT COUNT(*) AS n FROM sessions");

  await page.goto("/entrar");
  await autenticador.recusa();
  await page.getByRole("button", BOTAO_ENTRAR).click();
  await expect(page.getByRole("alert")).toContainText("A entrada foi cancelada");
  expect(contagem("SELECT COUNT(*) AS n FROM sessions")).toBe(sessoesAntes);

  await autenticador.permite();
  await page.getByRole("button", BOTAO_ENTRAR).click();
  await expect(page).toHaveURL(/\/inicio$/);
});

test("cenário 4: passkey que o aparelho tem e o banco não tem mostra 'não vale mais'", async ({ page }) => {
  await ligaAutenticadorVirtual(page);
  await cadastra(page);
  await sai(page);

  // O aparelho ainda tem a passkey; o banco perdeu a linha (e a sessão que dependia dela).
  executaSql("configuracao", "DELETE FROM sessions; DELETE FROM passkeys");

  await page.goto("/entrar");
  await page.getByRole("button", BOTAO_ENTRAR).click();
  await expect(page.getByRole("alert")).toContainText("Essa passkey não vale mais");
  await expect(page).toHaveURL(/\/entrar$/);
});

test("cenário 11: com sessão aberta, /entrar vai para o início", async ({ page }) => {
  await ligaAutenticadorVirtual(page);
  await cadastra(page);

  await page.goto("/entrar");
  await expect(page).toHaveURL(/\/inicio$/);
});

test("cenário 12: com a configuração pendente, /entrar vai para a configuração inicial", async ({ page }) => {
  await page.goto("/entrar");
  await expect(page).toHaveURL(/\/configuracao-inicial$/);
  await expect(page.getByRole("heading", { name: "Configuração inicial" })).toBeVisible();
});
