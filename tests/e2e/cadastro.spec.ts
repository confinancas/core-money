import { expect, type Page, test } from "@playwright/test";
import { consultaSql, PORTA_DA_CONFIGURACAO } from "./helpers/db";
import { CODIGO_DE_TESTE, esperaInstalacao, preparaConfiguracaoDoZero } from "./helpers/setup";
import { ligaAutenticadorVirtual } from "./helpers/webauthn";

// Cadastro do lar com passkey (TASK-0103) na instância de configuração do zero (8790). Cada teste começa sem lar.
// As larguras (celular, tablet e desktop) são os projetos do Playwright.
// Decisão de nível 1: a base é localhost (e não 127.0.0.1), porque o WebAuthn não aceita IP como rpID; o rpID do
// Worker vira "localhost". Só esta spec usa localhost; as outras continuam em 127.0.0.1.
test.use({ baseURL: `http://localhost:${PORTA_DA_CONFIGURACAO}` });

const NOME = "[TEST] Pessoa A";
const EMAIL = "pessoa.a@example.com";
const CAMPO_DO_NOME = "Seu nome";
const CAMPO_DO_EMAIL = "Seu e-mail (opcional)";
const BOTAO_CONTINUAR = { name: "Continuar", exact: true };
const BOTAO_CRIAR_PASSKEY = { name: "Criar passkey", exact: true };

test.beforeAll(async () => {
  await esperaInstalacao(PORTA_DA_CONFIGURACAO);
});

test.beforeEach(() => {
  preparaConfiguracaoDoZero();
});

// Código digitado (pelo fragmento do QR code), sem chave da IA: "Continuar sem IA" leva ao passo "Como começar".
async function chegaAoCadastro(page: Page) {
  await page.goto(`/configuracao-inicial#codigo=${CODIGO_DE_TESTE}`);
  await expect(page.getByRole("heading", { name: "Conecte a IA" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar sem IA", exact: true }).click();
  await page.getByRole("button", { name: "Continuar sem IA", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tudo pronto para começar" })).toBeVisible();
  await page.getByRole("link", { name: /Começar do zero/ }).click();
  await expect(page.getByRole("heading", { name: "Criar conta do casal" })).toBeVisible();
}

async function preencheVoce(page: Page) {
  await page.getByLabel(CAMPO_DO_NOME).fill(NOME);
  await page.getByLabel(CAMPO_DO_EMAIL).fill(EMAIL);
  await page.getByRole("button", BOTAO_CONTINUAR).click();
  await expect(page.getByRole("heading", { name: "Crie sua passkey" })).toBeVisible();
}

// Nas três larguras, a tela cabe sem rolagem horizontal.
async function semRolagemHorizontal(page: Page) {
  const medidas = await page.evaluate(() => ({
    conteudo: document.documentElement.scrollWidth,
    janela: window.innerWidth,
  }));
  expect(medidas.conteudo).toBeLessThanOrEqual(medidas.janela);
}

const contagemDe = (tabela: string): number =>
  Number(consultaSql("configuracao", `SELECT COUNT(*) AS n FROM ${tabela}`)[0]?.n ?? -1);

test("cenário 1: nome, passkey no autenticador e 'Adicionar depois' levam ao início, com um lar, um titular, uma passkey de cadastro e uma sessão", async ({
  page,
}) => {
  await ligaAutenticadorVirtual(page);
  await chegaAoCadastro(page);
  await semRolagemHorizontal(page);

  await preencheVoce(page);
  await page.getByRole("button", BOTAO_CRIAR_PASSKEY).click();
  await expect(page.getByRole("heading", { name: "Adicione seu cônjuge" })).toBeVisible();
  await semRolagemHorizontal(page);
  await page.getByRole("button", { name: "Adicionar depois", exact: true }).click();

  await expect(page).toHaveURL(/\/inicio$/);
  expect(
    (await page.context().cookies()).some((cookie) => cookie.name === "mm_sess" && cookie.httpOnly),
  ).toBe(true);

  expect(contagemDe("households")).toBe(1);
  expect(consultaSql("configuracao", "SELECT name, email, role FROM members")).toEqual([
    { name: NOME, email: EMAIL, role: "titular" },
  ]);
  expect(consultaSql("configuracao", "SELECT added_via FROM passkeys")).toEqual([{ added_via: "cadastro" }]);
  expect(
    consultaSql(
      "configuracao",
      "SELECT COUNT(*) AS n FROM sessions s JOIN passkeys p ON p.id = s.passkey_id",
    )[0]?.n,
  ).toBe(1);
  expect(
    consultaSql("configuracao", "SELECT used_at FROM invites WHERE kind = 'primeiro_acesso'")[0]?.used_at,
  ).not.toBeNull();

  const status = await page.request.get("/api/setup/status");
  expect(await status.json()).toMatchObject({ mode: "pronto", hasMembers: true });
});

test("cenário 3: sem o código, /criar-conta leva à configuração inicial, e a API responde 403 codigo_necessario", async ({
  page,
}) => {
  await page.goto("/criar-conta");
  await expect(page).toHaveURL(/\/configuracao-inicial$/);
  await expect(page.getByRole("heading", { name: "Configuração inicial" })).toBeVisible();

  const resposta = await page.request.post("/api/setup/household/options", {
    data: { name: NOME, email: null },
  });
  expect(resposta.status()).toBe(403);
  expect(await resposta.json()).toMatchObject({ error: "codigo_necessario" });
  expect(contagemDe("households")).toBe(0);
});

test("cenário 4: passkey cancelada mostra a mensagem e nada é gravado; tentar de novo cria a conta", async ({
  page,
}) => {
  const autenticador = await ligaAutenticadorVirtual(page);
  await chegaAoCadastro(page);
  await preencheVoce(page);

  await autenticador.recusa();
  await page.getByRole("button", BOTAO_CRIAR_PASSKEY).click();
  await expect(page.getByRole("alert")).toHaveText(
    "A criação da passkey foi cancelada ou o tempo acabou. Toque em Criar passkey para tentar de novo.",
  );
  expect(contagemDe("households")).toBe(0);
  expect(contagemDe("passkeys")).toBe(0);

  await autenticador.permite();
  await page.getByRole("button", BOTAO_CRIAR_PASSKEY).click();
  await expect(page.getByRole("heading", { name: "Adicione seu cônjuge" })).toBeVisible();
  expect(contagemDe("households")).toBe(1);
});
