import { expect, test } from "@playwright/test";
import { executaSql } from "./helpers/db";
import { LAR_DA_INSTALACAO_PRONTA, signUpAndSignIn } from "./helpers/sessao";
import { semearInstalacaoPronta } from "./helpers/setup";

// Para categorizar (TASK-0304) nas três larguras (celular, tablet, desktop), contra o Worker da instalação pronta.
// Dados [TEST] com o prefixo e2e-pc-. Prova: contagem inicial, aceitar em massa e a barra de progresso; alvo de 44 px
// no botão Aceitar; sem rolagem horizontal da página.

const LAR = LAR_DA_INSTALACAO_PRONTA;
const CONEXAO = "e2e-pc-conexao";
const BANCO = "e2e-pc-banco";
const CONTA = "e2e-pc-conta";
const CATEGORIA_IA = "e2e-pc-categoria";

const q = (valor: string | number | null): string =>
  valor === null ? "NULL" : typeof valor === "number" ? String(valor) : `'${valor.replace(/'/g, "''")}'`;

// Estado inicial: duas saídas por Pix com sugestão da IA, sem categoria. As linhas de teste são refeitas a cada teste.
function preparaFila(): void {
  const agora = new Date().toISOString();
  executaSql("pronta", `DELETE FROM transactions WHERE id LIKE 'e2e-pc-%'`);
  executaSql(
    "pronta",
    [
      `INSERT OR IGNORE INTO pluggy_connections (id, household_id, label, created_at) VALUES (${q(CONEXAO)}, ${q(LAR)}, '[TEST] Conexão E2E para categorizar', ${q(agora)})`,
      `INSERT OR IGNORE INTO bank_items (id, connection_id, institution_name, institution_color, created_at) VALUES (${q(BANCO)}, ${q(CONEXAO)}, '[TEST] Banco E2E', '#0E9A63', ${q(agora)})`,
      `INSERT OR IGNORE INTO categories (id, household_id, name, color, parent_id, default_spend_type, ai_hint, sort, archived_at) VALUES (${q(CATEGORIA_IA)}, ${q(LAR)}, '[TEST] Serviços E2E', '#1B84F2', NULL, 'fixos', NULL, 0, NULL)`,
      `INSERT OR IGNORE INTO accounts (id, bank_item_id, kind, name, balance_cents, overdraft_used_cents, balance_at) VALUES (${q(CONTA)}, ${q(BANCO)}, 'corrente', '[TEST] Conta E2E', 0, 0, ${q(agora)})`,
    ].join(";\n"),
  );
  for (const [id, nome, valor] of [
    ["e2e-pc-1", "[TEST] Pix E2E um", -15000],
    ["e2e-pc-2", "[TEST] Pix E2E dois", -8000],
  ] as const) {
    executaSql(
      "pronta",
      `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, movement, occurred_at, local_date,
         amount_cents, original_description, establishment_key, counterparty_name, ai_category_id, last_seen_at)
       VALUES (${q(id)}, ${q(LAR)}, ${q(`[TEST] ext-${id}`)}, ${q(BANCO)}, ${q(CONTA)}, 'pix_enviado', ${q(agora)}, '2026-11-05',
         ${valor}, ${q(nome)}, ${q(`TEST ${id}`)}, ${q("[TEST] PESSOA E2E")}, ${q(CATEGORIA_IA)}, ${q(agora)})`,
    );
  }
}

test.beforeEach(async ({ page }) => {
  semearInstalacaoPronta();
  await signUpAndSignIn(page);
  preparaFila();
});

test("mostra a fila, o progresso e aceita em massa", async ({ page }) => {
  await page.goto("/para-categorizar");
  await expect(page.getByRole("heading", { name: "Para categorizar" })).toBeVisible();
  await expect(page.getByText("0 de 2 categorizados")).toBeVisible();
  await expect(page.getByText("faltam 2")).toBeVisible();

  const aceitar = page.getByRole("button", { name: "Aceitar", exact: true });
  await expect(aceitar).toBeEnabled();
  const caixa = await aceitar.boundingBox();
  expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(44);

  await aceitar.click();
  await expect(page.getByText("2 de 2 categorizados")).toBeVisible();
  await expect(page.getByText("tudo certo")).toBeVisible();

  const semRolagemHorizontal = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(semRolagemHorizontal).toBe(true);
});
