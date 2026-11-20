import { expect, type Page, test } from "@playwright/test";
import { consultaSql, executaSql } from "./helpers/db";
import { LAR_DA_INSTALACAO_PRONTA, semeiaSessaoDaInstalacaoPronta, signUpAndSignIn } from "./helpers/sessao";
import { semearInstalacaoPronta } from "./helpers/setup";

// Pix recebido (TASK-0903) nas três larguras (celular 390, tablet 834, desktop 1440), contra o Worker real da instalação
// pronta. Dados [TEST]: ids com `e2e-pix-`. Cada teste semeia o que usa e limpa o que deixou.

const LAR = LAR_DA_INSTALACAO_PRONTA;
const q = (valor: string | number | null): string =>
  valor === null ? "NULL" : typeof valor === "number" ? String(valor) : `'${valor.replace(/'/g, "''")}'`;

const LARGURAS: { nome: string; largura: number; altura: number }[] = [
  { nome: "celular", largura: 390, altura: 844 },
  { nome: "tablet", largura: 834, altura: 1112 },
  { nome: "desktop", largura: 1440, altura: 900 },
];

// Um Pix recebido de uma contraparte, no ciclo 2026-10, numa conta de teste. Não entra em outra tela além da do Pix.
function semeiaPix(id: string, valor: number, contraparte: string): void {
  const agora = "2026-10-20T15:00:00.000Z";
  executaSql(
    "pronta",
    [
      `DELETE FROM transactions WHERE id = ${q(id)}`,
      `INSERT OR IGNORE INTO pluggy_connections (id, household_id, label, created_at) VALUES ('e2e-pix-conexao', ${q(LAR)}, '[TEST] Conexão Pix', ${q(agora)})`,
      `INSERT OR IGNORE INTO bank_items (id, connection_id, institution_name, created_at) VALUES ('e2e-pix-banco', 'e2e-pix-conexao', '[TEST] Banco Pix', ${q(agora)})`,
      `INSERT OR IGNORE INTO accounts (id, bank_item_id, kind, name, balance_cents, overdraft_used_cents, balance_at) VALUES ('e2e-pix-conta', 'e2e-pix-banco', 'corrente', '[TEST] Conta Pix', 0, 0, ${q(agora)})`,
      `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, movement, occurred_at, local_date, amount_cents, original_description, counterparty_name, counterparty_doc_masked, cycle_key, last_seen_at) VALUES (${q(id)}, ${q(LAR)}, ${q(`[TEST] ext-${id}`)}, 'e2e-pix-banco', 'e2e-pix-conta', 'pix_recebido', ${q("2026-10-20T15:00:00.000Z")}, '2026-10-20', ${valor}, ${q(`[TEST] Pix de ${contraparte}`)}, ${q(contraparte)}, '***.123.456-**', '2026-10', ${q(agora)})`,
    ].join("; "),
  );
}

function limpaPix(id: string): void {
  executaSql("pronta", [`DELETE FROM fixed_income_receipts WHERE transaction_id = ${q(id)}`, `DELETE FROM transactions WHERE id = ${q(id)}`].join("; "));
}

function lerPix(id: string): Record<string, unknown> | undefined {
  return consultaSql("pronta", `SELECT income_kind, income_subtype, hidden, hidden_reason, categorized_by FROM transactions WHERE id = ${q(id)}`)[0];
}

async function abreA(page: Page, caminho: string): Promise<void> {
  await page.goto(caminho);
}

for (const { nome, largura, altura } of LARGURAS) {
  test.describe(`Pix recebido no ${nome} (${largura}px)`, () => {
    test.use({ viewport: { width: largura, height: altura } });

    test.beforeAll(() => {
      semearInstalacaoPronta();
    });

    test.beforeEach(async ({ page }) => {
      semeiaSessaoDaInstalacaoPronta();
      await signUpAndSignIn(page);
    });

    test("renda variável de venda: a prévia mostra o impacto, e salvar grava e volta", async ({ page }) => {
      const id = `e2e-pix-variavel-${nome}`;
      semeiaPix(id, 150_000, "[TEST] Fulana Pix");
      try {
        await abreA(page, `/pix-recebido/${id}?voltar=/para-categorizar&opcao=variavel`);
        await expect(page.getByRole("heading", { name: "Pix recebido" })).toBeVisible();
        await expect(page.getByText("Para classificar")).toBeVisible();

        await page.getByRole("button", { name: "Venda" }).click();
        await expect(page.getByText("→")).toBeVisible();

        await page.getByRole("button", { name: "Salvar classificação" }).click();
        await page.waitForURL(/\/para-categorizar$/);
        await expect(page.getByRole("heading", { name: /Para categorizar/ })).toBeVisible();

        const linha = lerPix(id);
        expect(linha?.income_kind).toBe("variavel");
        expect(linha?.income_subtype).toBe("venda");
      } finally {
        limpaPix(id);
      }
    });

    test("reembolso oculta o Pix e não há renda fixa cadastrada na opção de parte do salário", async ({ page }) => {
      const id = `e2e-pix-reembolso-${nome}`;
      semeiaPix(id, 90_000, "[TEST] Beltrana Pix");
      try {
        await abreA(page, `/pix-recebido/${id}?voltar=/renda`);
        await page.getByRole("radio", { name: /Reembolso de terceiros/ }).check();
        await expect(page.getByText("Fora dos cálculos")).toBeVisible();

        await page.getByRole("radio", { name: /Parte do salário/ }).check();
        await expect(page.getByText("Nenhuma renda fixa cadastrada.")).toBeVisible();
      } finally {
        limpaPix(id);
      }
    });

    test("o switch de lembrar aparece com o remetente e o botão do Pix inexistente diz que não foi encontrado", async ({ page }) => {
      const id = `e2e-pix-lembrar-${nome}`;
      semeiaPix(id, 60_000, "[TEST] Ciclana Pix");
      try {
        await abreA(page, `/pix-recebido/${id}`);
        const switchLembrar = page.getByRole("switch", { name: /Lembrar para os próximos Pix de \[TEST\] Ciclana Pix/ });
        await expect(switchLembrar).toBeVisible();
        await switchLembrar.click();
        await expect(switchLembrar).toBeChecked();

        await abreA(page, "/pix-recebido/e2e-pix-inexistente");
        await expect(page.getByText("Este Pix não foi encontrado.")).toBeVisible();
      } finally {
        limpaPix(id);
      }
    });
  });
}
