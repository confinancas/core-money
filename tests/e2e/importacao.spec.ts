import { expect, type Locator, type Page, test } from "@playwright/test";
import { executaSql } from "./helpers/db";
import { semeiaSessaoDaInstalacaoPronta, signUpAndSignIn } from "./helpers/sessao";
import { semearInstalacaoPronta } from "./helpers/setup";

// Importação do histórico (TASK-0204), na instalação pronta contra o Worker real e o Meu Pluggy falso (base + 3).
// Depois de conectar, o passo 4 mostra a barra; a faixa da moldura aparece e some com "OK". Três larguras.
// Os dados são [TEST]; o falso responde janelas vazias, com um atraso que deixa a barra à vista.
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const SEGREDO = "TEST-segredo-valido-0203";
const ITEM_ITAU = "00000000-0000-4000-8000-0000000000a1";
const ROTULO = "[TEST] Importação 0204";
const ROTA = "/configuracoes/bancos/conectar";

test.setTimeout(180_000);

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

// Só as linhas deste arquivo: a conexão [TEST] Importação 0204, o banco do id de teste e o que a importação gravou nele.
const BANCO = `(SELECT id FROM bank_items WHERE id = '${ITEM_ITAU}' OR connection_id IN (SELECT id FROM pluggy_connections WHERE label = '${ROTULO}'))`;
const LIMPEZA = [
  `DELETE FROM transactions WHERE bank_item_id IN ${BANCO}`,
  `DELETE FROM bills WHERE card_id IN (SELECT id FROM cards WHERE bank_item_id IN ${BANCO})`,
  `DELETE FROM cards WHERE bank_item_id IN ${BANCO}`,
  `DELETE FROM accounts WHERE bank_item_id IN ${BANCO}`,
  `DELETE FROM sync_runs WHERE bank_item_id IN ${BANCO}`,
  `DELETE FROM bank_items WHERE id IN ${BANCO}`,
  `DELETE FROM pluggy_connections WHERE label = '${ROTULO}'`,
].join("; ");

test.beforeEach(() => {
  semearInstalacaoPronta();
  semeiaSessaoDaInstalacaoPronta();
  executaSql("pronta", LIMPEZA);
});

test.afterAll(() => {
  executaSql("pronta", LIMPEZA);
});

// Os passos da conexão, da tela de nome até "Conectar 1 banco" (o Meu Pluggy falso responde pelas chaves [TEST]).
async function conectaUmBanco(page: Page): Promise<void> {
  // Passo 1 e 2 (com o teste das chaves), e o passo 3 com o id do banco.
  await page.getByLabel("Nome desta conexão").fill(ROTULO);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Client ID").fill(CLIENT_ID);
  await page.getByLabel("Client Secret").fill(SEGREDO);
  await page.getByRole("button", { name: "Testar chaves" }).click();
  await expect(page.getByRole("button", { name: "✓ Chaves funcionando" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Cole o id de cada banco" })).toBeVisible();
  await page.getByLabel("Id do banco no Meu Pluggy").fill(ITEM_ITAU);
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByRole("checkbox", { name: /Itaú/ })).toBeVisible();
  await page.getByRole("button", { name: "Conectar 1 banco" }).click();
}

test("cenário 1: a barra aparece no passo 4, chega a pronto, e a faixa some com OK", async ({
  page,
}, testInfo) => {
  const largura = testInfo.project.name;
  await signUpAndSignIn(page);
  await page.goto(ROTA);

  await conectaUmBanco(page);

  // Passo 4: a barra do histórico, com o percentual e a frase da spec.
  await expect(page.getByText(`${ROTULO} conectada`)).toBeVisible();
  const barra = page.getByRole("progressbar", { name: "Histórico" });
  await expect(barra).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText("Pode levar alguns minutos. Dá para usar o app enquanto isso; avisamos quando terminar."),
  ).toBeVisible();
  const caixa = await barra.boundingBox();
  expect(caixa?.height ?? 0).toBeGreaterThan(0);
  await semRolagemHorizontal(page);

  // Quando termina, a faixa da moldura diz que o histórico está pronto. "OK" a tira da tela.
  const faixa = page.getByRole("region", { name: "Importação do histórico" });
  await expect(faixa.getByText(/Histórico do .+ pronto\./)).toBeVisible({ timeout: 120_000 });
  await alvoDeNoMinimo44(faixa.getByRole("button", { name: "OK" }));
  if (largura === "celular") {
    await page.screenshot({ path: testInfo.outputPath("faixa-pronta.png"), fullPage: false });
  }
  await faixa.getByRole("button", { name: "OK" }).click();
  await expect(faixa).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("region", { name: "Importação do histórico" })).toHaveCount(0);
});

// Teto do dia atingido (60% de 100 mil escritas, orcamento.ts): a primeira fatia que lê o banco pausa a importação até a
// virada, e a faixa e o passo 4 dizem que ela continua amanhã, no lugar do percentual. A linha de uso do dia é do teste
// e sai no fim (a usage_daily é compartilhada entre as specs).
const LIMITE_DO_DIA = 60_000;

test("cenário 2: com o teto do dia atingido, a faixa e o passo 4 dizem que a importação continua amanhã", async ({
  page,
}) => {
  const dia = new Date().toISOString().slice(0, 10);
  try {
    executaSql(
      "pronta",
      `INSERT INTO usage_daily (day, requests, rows_read, rows_written, size_bytes) VALUES ('${dia}', 0, 0, ${LIMITE_DO_DIA}, 0) ON CONFLICT(day) DO UPDATE SET rows_written = excluded.rows_written`,
    );
    await signUpAndSignIn(page);
    await page.goto(ROTA);
    await conectaUmBanco(page);

    const passoQuatro = page.getByRole("region", { name: "Progresso do histórico" });
    await expect(passoQuatro.getByText("A importação continua amanhã", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await expect(passoQuatro.getByRole("progressbar", { name: "Histórico" })).toHaveCount(0);

    const faixa = page.getByRole("region", { name: "Importação do histórico" });
    await expect(faixa.getByText("A importação continua amanhã", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await semRolagemHorizontal(page);
  } finally {
    executaSql("pronta", `DELETE FROM usage_daily WHERE day = '${dia}'`);
  }
});
