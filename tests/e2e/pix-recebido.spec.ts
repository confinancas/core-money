import { expect, type Page, test } from "@playwright/test";
import { consultaSql, executaSql } from "./helpers/db";
import { LAR_DA_INSTALACAO_PRONTA, semeiaSessaoDaInstalacaoPronta, signUpAndSignIn } from "./helpers/sessao";
import { semearInstalacaoPronta } from "./helpers/setup";

// Pix recebido (TASK-0903) contra o Worker real da instalação pronta. As três larguras (celular 390, tablet 834 e
// desktop 1440) vêm dos projetos do Playwright: cada teste roda uma vez em cada um. Dados [TEST]: ids com `e2e-pix-`
// e o nome do projeto no sufixo, para os três projetos não se atrapalharem.

const LAR = LAR_DA_INSTALACAO_PRONTA;
const q = (valor: string | number | null): string =>
  valor === null ? "NULL" : typeof valor === "number" ? String(valor) : `'${valor.replace(/'/g, "''")}'`;

// Um Pix recebido de uma contraparte, no ciclo 2026-10, numa conta de teste.
function semeiaPix(
  id: string,
  valor: number,
  contraparte: string,
  movimento: "pix_recebido" | "pix_enviado" = "pix_recebido",
): void {
  const agora = "2026-10-20T15:00:00.000Z";
  executaSql(
    "pronta",
    [
      `DELETE FROM transactions WHERE id = ${q(id)}`,
      // O ciclo 2026-10 precisa existir: sem ele a renda do ciclo é nula, a prévia sai zerada e o impacto não aparece.
      `INSERT OR IGNORE INTO cycles (household_id, key, starts_on, ends_on) VALUES (${q(LAR)}, '2026-10', '2026-10-11', '2026-11-10')`,
      `INSERT OR IGNORE INTO pluggy_connections (id, household_id, label, created_at) VALUES ('e2e-pix-conexao', ${q(LAR)}, '[TEST] Conexão Pix', ${q(agora)})`,
      `INSERT OR IGNORE INTO bank_items (id, connection_id, institution_name, created_at) VALUES ('e2e-pix-banco', 'e2e-pix-conexao', '[TEST] Banco Pix', ${q(agora)})`,
      `INSERT OR IGNORE INTO accounts (id, bank_item_id, kind, name, balance_cents, overdraft_used_cents, balance_at) VALUES ('e2e-pix-conta', 'e2e-pix-banco', 'corrente', '[TEST] Conta Pix', 0, 0, ${q(agora)})`,
      `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, movement, occurred_at, local_date, amount_cents, original_description, counterparty_name, counterparty_doc_masked, cycle_key, last_seen_at) VALUES (${q(id)}, ${q(LAR)}, ${q(`[TEST] ext-${id}`)}, 'e2e-pix-banco', 'e2e-pix-conta', ${q(movimento)}, ${q("2026-10-20T15:00:00.000Z")}, '2026-10-20', ${valor}, ${q(`[TEST] Pix de ${contraparte}`)}, ${q(contraparte)}, '***.123.456-**', '2026-10', ${q(agora)})`,
    ].join("; "),
  );
}

function limpaPix(id: string): void {
  executaSql(
    "pronta",
    [
      `DELETE FROM fixed_income_receipts WHERE transaction_id = ${q(id)}`,
      `DELETE FROM transactions WHERE id = ${q(id)}`,
    ].join("; "),
  );
}

function lerPix(id: string): Record<string, unknown> | undefined {
  return consultaSql(
    "pronta",
    `SELECT income_kind, income_subtype, hidden, hidden_reason, categorized_by FROM transactions WHERE id = ${q(id)}`,
  )[0];
}

async function abreA(page: Page, caminho: string): Promise<void> {
  await page.goto(caminho);
}

test.describe("Pix recebido", () => {
  test.beforeAll(() => {
    semearInstalacaoPronta();
  });

  test.beforeEach(async ({ page }) => {
    semeiaSessaoDaInstalacaoPronta();
    await signUpAndSignIn(page);
  });

  test("renda variável de venda: a prévia mostra o impacto, e salvar grava e volta", async ({
    page,
  }, info) => {
    const id = `e2e-pix-variavel-${info.project.name}`;
    semeiaPix(id, 150_000, "[TEST] Fulana Pix");
    try {
      await abreA(page, `/pix-recebido/${id}?voltar=/para-categorizar&opcao=variavel`);
      await expect(page.getByRole("heading", { name: "Pix recebido" })).toBeVisible();
      await expect(page.getByText("Para classificar")).toBeVisible();

      // Cenário 10: ?opcao=variavel abre com Renda variável marcada.
      await expect(page.getByRole("radio", { name: /Renda variável/ })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await page.getByRole("button", { name: "Venda" }).click();
      await expect(page.getByText("→")).toBeVisible();
      await expect(page.getByText("Renda de outubro")).toBeVisible();

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

  test("reembolso oculta o Pix e não há renda fixa cadastrada na opção de parte do salário", async ({
    page,
  }, info) => {
    const id = `e2e-pix-reembolso-${info.project.name}`;
    semeiaPix(id, 90_000, "[TEST] Beltrana Pix");
    // A instância pronta é compartilhada: outras specs cadastram rendas fixas nela. Este teste só precisa que o lar
    // não tenha renda ativa; arquiva as que existem agora e desarquiva só esses ids no fim (não apaga nada).
    const ativas = consultaSql(
      "pronta",
      `SELECT id FROM fixed_incomes WHERE household_id = ${q(LAR)} AND archived_at IS NULL`,
    ).map((linha) => String(linha.id));
    const lista = ativas.map((rendaId) => q(rendaId)).join(", ");
    if (ativas.length > 0) {
      executaSql(
        "pronta",
        `UPDATE fixed_incomes SET archived_at = ${q(new Date().toISOString())} WHERE id IN (${lista})`,
      );
    }
    try {
      await abreA(page, `/pix-recebido/${id}?voltar=/renda`);
      await page.getByRole("radio", { name: /Reembolso de terceiros/ }).check();
      await expect(page.getByText("Fora dos cálculos", { exact: true })).toBeVisible();

      await page.getByRole("radio", { name: /Parte do salário/ }).check();
      await expect(page.getByText("Nenhuma renda fixa cadastrada.")).toBeVisible();
    } finally {
      limpaPix(id);
      if (ativas.length > 0) {
        executaSql("pronta", `UPDATE fixed_incomes SET archived_at = NULL WHERE id IN (${lista})`);
      }
    }
  });

  test("reembolso: o selo e o valor riscado seguem a escolha, e salvar oculta o Pix (cenário 3)", async ({
    page,
  }, info) => {
    const id = `e2e-pix-riscado-${info.project.name}`;
    semeiaPix(id, 120_000, "[TEST] Dona Reembolso");
    try {
      await abreA(page, `/pix-recebido/${id}?voltar=/renda`);
      const valor = page.getByRole("img", { name: /^mais 1\.200,00$/ });
      await expect(valor).toBeVisible();
      await expect(page.getByText("Reembolso de terceiros · fora dos cálculos")).toHaveCount(0);
      expect(await valor.evaluate((el) => getComputedStyle(el).textDecorationLine)).not.toBe("line-through");

      await page.getByRole("radio", { name: /Reembolso de terceiros/ }).click();
      await expect(page.getByText("Reembolso de terceiros · fora dos cálculos")).toBeVisible();
      expect(await valor.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");

      await page.getByRole("button", { name: "Salvar classificação" }).click();
      await page.waitForURL(/\/renda$/);
      const linha = lerPix(id);
      expect(linha?.income_kind).toBe("reembolso");
      expect(linha?.hidden).toBe(1);
      expect(linha?.hidden_reason).toBe("reembolso_terceiros");
    } finally {
      limpaPix(id);
    }
  });

  test("a sugestão da IA vem marcada, com a certeza por extenso, e nada é gravado antes de salvar (cenário 16)", async ({
    page,
  }, info) => {
    const id = `e2e-pix-sugestao-${info.project.name}`;
    semeiaPix(id, 80_000, "[TEST] Dona Sugestao");
    executaSql(
      "pronta",
      `UPDATE transactions SET ai_income_kind = 'variavel', ai_income_subtype = 'cashback', ai_confidence = 'media' WHERE id = ${q(id)}`,
    );
    try {
      await abreA(page, `/pix-recebido/${id}`);
      await expect(page.getByRole("radio", { name: /Renda variável/ })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(page.getByRole("button", { name: "Cashback" })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByText("Sugestão da IA · média certeza")).toBeVisible();
      expect(lerPix(id)?.income_kind).toBeNull();
    } finally {
      limpaPix(id);
    }
  });

  test("um Pix enviado diz que não foi encontrado (cenário 12)", async ({ page }, info) => {
    const id = `e2e-pix-enviado-${info.project.name}`;
    semeiaPix(id, -50_000, "[TEST] Destino", "pix_enviado");
    try {
      await abreA(page, `/pix-recebido/${id}`);
      await expect(page.getByText("Este Pix não foi encontrado.")).toBeVisible();
    } finally {
      limpaPix(id);
    }
  });

  test("a tela segue o protótipo: topo verde e colunas por largura, com a barra de salvar no fluxo", async ({
    page,
  }, info) => {
    const id = `e2e-pix-layout-${info.project.name}`;
    semeiaPix(id, 150_000, "[TEST] Mariana Layout");
    try {
      await abreA(page, `/pix-recebido/${id}`);
      await expect(page.getByRole("heading", { name: "Pix recebido" })).toBeVisible();
      const topo = page.locator("header").first();
      expect(await topo.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("gradient");
      await expect(page.getByText("PIX", { exact: true })).toBeVisible();

      const destaque = await page.getByText("Pix de [TEST] Mariana Layout", { exact: true }).boundingBox();
      const escolha = await page.getByRole("heading", { name: "Como conta" }).boundingBox();
      const dados = await page.getByText("Descrição do banco", { exact: true }).boundingBox();
      expect(destaque && escolha && dados).toBeTruthy();
      const [xd, xe, xdados] = [destaque?.x ?? 0, escolha?.x ?? 0, dados?.x ?? 0];
      const [ye, ydados] = [escolha?.y ?? 0, dados?.y ?? 0];
      const largura = page.viewportSize()?.width ?? 0;
      if (largura >= 1200) {
        // Desktop: três colunas, da esquerda para a direita.
        expect(xd).toBeLessThan(xe - 100);
        expect(xe).toBeLessThan(xdados - 100);
      } else if (largura >= 768) {
        // Tablet: destaque e escolha à esquerda, dados à direita.
        expect(Math.abs(xd - xe)).toBeLessThan(60);
        expect(xdados).toBeGreaterThan(xe + 100);
      } else {
        // Celular: uma coluna.
        expect(xdados).toBeLessThan(xe + 100);
        expect(ydados).toBeGreaterThan(ye);
      }

      // A barra de salvar fica no fluxo (não fixa): não cobre o conteúdo.
      const salvar = page.getByRole("button", { name: "Salvar classificação" });
      expect(await salvar.evaluate((el) => getComputedStyle(el).position)).not.toBe("fixed");
      const rolagemHorizontal = await page.evaluate(
        (larg) => document.documentElement.scrollWidth > larg,
        largura,
      );
      expect(rolagemHorizontal).toBe(false);
    } finally {
      limpaPix(id);
    }
  });

  test("o switch de lembrar aparece com o remetente e o botão do Pix inexistente diz que não foi encontrado", async ({
    page,
  }, info) => {
    const id = `e2e-pix-lembrar-${info.project.name}`;
    semeiaPix(id, 60_000, "[TEST] Ciclana Pix");
    try {
      await abreA(page, `/pix-recebido/${id}`);
      const switchLembrar = page.getByRole("switch", {
        name: /Lembrar para os próximos Pix de \[TEST\] Ciclana Pix/,
      });
      await expect(switchLembrar).toBeVisible();
      // Pix ainda não classificado: o lembrar começa ligado (a spec da tela).
      await expect(switchLembrar).toHaveAttribute("aria-checked", "true");
      await switchLembrar.click();
      await expect(switchLembrar).toHaveAttribute("aria-checked", "false");

      await abreA(page, "/pix-recebido/e2e-pix-inexistente");
      await expect(page.getByText("Este Pix não foi encontrado.")).toBeVisible();
    } finally {
      limpaPix(id);
    }
  });
});
