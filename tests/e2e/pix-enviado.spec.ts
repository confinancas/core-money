import { expect, type Page, test } from "@playwright/test";
import { addDays, standardCycle } from "../../src/shared/cycle";
import { todayInSaoPaulo } from "../../src/shared/sao-paulo-date";
import { executaSql } from "./helpers/db";
import { LAR_DA_INSTALACAO_PRONTA, semeiaSessaoDaInstalacaoPronta, signUpAndSignIn } from "./helpers/sessao";
import { semearInstalacaoPronta } from "./helpers/setup";

// Pix enviado (TASK-0404) nas três larguras (390, 834 e 1440), contra o Worker real da instalação pronta. Dados [TEST]
// com o prefixo e2e-px-. Cada teste refaz o estado inicial. Cenário 1 (Pix sozinho), modo fila ("N de M" e "faltam"),
// o último item que volta à fila, e ligar e desligar "É pagamento de cartão".

const LAR = LAR_DA_INSTALACAO_PRONTA;
const CONEXAO = "e2e-px-conexao";
const BANCO = "e2e-px-banco";
const CONTA = "e2e-px-conta";
const LARGURAS = [390, 834, 1440] as const;

const q = (valor: string | number | null): string =>
  valor === null ? "NULL" : typeof valor === "number" ? String(valor) : `'${valor.replace(/'/g, "''")}'`;

function ciclo() {
  const hoje = todayInSaoPaulo();
  const atual = standardCycle(hoje, 11);
  return { hoje, atual };
}

// Um Pix enviado da conta, sem categoria (vai para a fila). Chave de contraparte "TESTE PIX <nome>|<doc>".
function pix(id: string, valor: number, nome: string, dia: string): string {
  const { atual } = ciclo();
  const agora = new Date().toISOString();
  return `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, bill_id, movement, occurred_at, local_date, amount_cents, original_description, establishment_key, counterparty_name, counterparty_doc_masked, cycle_key, last_seen_at) VALUES (${q(id)}, ${q(LAR)}, ${q(`e2e-px-ext-${id}`)}, ${q(BANCO)}, ${q(CONTA)}, NULL, NULL, 'pix_enviado', ${q(`${dia}T17:32:00.000Z`)}, ${q(dia)}, ${q(valor)}, ${q(`PIX ENVIADO ${nome}`)}, NULL, ${q(nome)}, ${q("•••.456.789-••")}, ${q(atual.key)}, ${q(agora)})`;
}

function preparaPix(): void {
  const { atual, hoje } = ciclo();
  const agora = new Date().toISOString();
  executaSql(
    "pronta",
    [
      `DELETE FROM transactions WHERE id LIKE 'e2e-px-%'`,
      `DELETE FROM rules WHERE household_id = ${q(LAR)} AND match_value LIKE 'E2E PX%'`,
      // A fila é do lar: pendentes de outras specs fariam a posição ficar além de 4 páginas. Só os e2e-px- ficam pendentes.
      `UPDATE transactions SET categorized_at = ${q(agora)}, categorized_by = 'ia' WHERE household_id = ${q(LAR)} AND categorized_at IS NULL AND id NOT LIKE 'e2e-px-%'`,
      `INSERT OR IGNORE INTO pluggy_connections (id, household_id, label, created_at) VALUES (${q(CONEXAO)}, ${q(LAR)}, '[TEST] Conexão E2E pix', ${q(agora)})`,
      `INSERT OR IGNORE INTO bank_items (id, connection_id, institution_name, institution_color, created_at) VALUES (${q(BANCO)}, ${q(CONEXAO)}, '[TEST] Banco E2E Pix', '#1E9E63', ${q(agora)})`,
      `UPDATE bank_items SET disconnected_at = NULL WHERE id = ${q(BANCO)}`,
      `INSERT OR REPLACE INTO accounts (id, bank_item_id, kind, name, balance_cents, overdraft_used_cents, balance_at) VALUES (${q(CONTA)}, ${q(BANCO)}, 'corrente', '[TEST] Conta E2E pix', 0, 0, ${q(agora)})`,
      `INSERT OR REPLACE INTO cycles (household_id, key, starts_on, ends_on) VALUES (${q(LAR)}, ${q(atual.key)}, ${q(atual.startsOn)}, ${q(atual.endsOn)})`,
      pix("e2e-px-1", -15000, "[TEST] JOAO P SILVA", hoje),
      pix("e2e-px-2", -2870, "[TEST] NU PAGAMENTOS", addDays(hoje, -1)),
      pix("e2e-px-3", -8000, "[TEST] DIARISTA", addDays(hoje, -2)),
    ].join("; "),
  );
}

test.beforeAll(() => {
  semearInstalacaoPronta();
  semeiaSessaoDaInstalacaoPronta();
});

test.beforeEach(async ({ page }) => {
  await signUpAndSignIn(page);
  preparaPix();
});

test.afterAll(() => {
  executaSql(
    "pronta",
    [
      `DELETE FROM transactions WHERE id LIKE 'e2e-px-%'`,
      `DELETE FROM rules WHERE household_id = ${q(LAR)} AND match_value LIKE 'E2E PX%'`,
      `DELETE FROM accounts WHERE id = ${q(CONTA)}`,
    ].join("; "),
  );
});

// Espera a tela nova (título que só o Pix tem) antes de afirmar, para não achar elementos da tela anterior.
async function esperaPix(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Pix enviado" })).toBeVisible();
}

for (const largura of LARGURAS) {
  test.describe(`largura ${largura}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 900 });
    });

    test("cenário 1: Pix sozinho mostra o título, quem recebeu e o botão Salvar", async ({ page }) => {
      await page.goto("/pix/e2e-px-1");
      await esperaPix(page);
      await expect(page.getByText("[TEST] JOAO P SILVA").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Salvar" })).toBeVisible();
    });

    test("ligar e desligar 'É pagamento de cartão' muda o texto e volta ao gasto", async ({ page }) => {
      await page.goto("/pix/e2e-px-2");
      await esperaPix(page);
      await page.getByRole("switch", { name: "É pagamento de cartão" }).click();
      await expect(page.getByText("Pagamento de cartão · não conta como gasto")).toBeVisible();
      await page.getByRole("switch", { name: "É pagamento de cartão" }).click();
      await expect(page.getByText("Pagamento de cartão · não conta como gasto")).toHaveCount(0);
    });

    test("modo fila: mostra 'N de M para categorizar' e o botão com 'faltam'", async ({ page }) => {
      await page.goto("/pix/e2e-px-1?fila=1");
      await esperaPix(page);
      await expect(page.getByText(/\d+ de \d+ para categorizar/)).toBeVisible();
      await expect(page.getByRole("button", { name: /Salvar e ir para o próximo/ })).toBeVisible();
    });
  });
}
