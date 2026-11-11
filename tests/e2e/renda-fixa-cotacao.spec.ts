import { expect, type Locator, type Page, test } from "@playwright/test";
import { executaSql } from "./helpers/db";
import { LAR_DA_INSTALACAO_PRONTA, semeiaSessaoDaInstalacaoPronta, signUpAndSignIn } from "./helpers/sessao";
import { semearInstalacaoPronta } from "./helpers/setup";

// Cotação de referência da renda fixa (TASK-0902) nas três larguras (celular 390, tablet 834, desktop 1440), contra o Worker
// real da instalação pronta. Dados [TEST]: rendas com `e2e-rfc-` no id, do lar da instalação. A cotação é semeada no banco
// (a busca ao Banco Central não roda aqui: é teste de integração, com o fetch falso).

const LAR = LAR_DA_INSTALACAO_PRONTA;
const LARGURAS = [
  { nome: "celular", largura: 390 },
  { nome: "tablet", largura: 834 },
  { nome: "desktop", largura: 1440 },
] as const;

const q = (valor: string | number | null): string =>
  valor === null ? "NULL" : typeof valor === "number" ? String(valor) : `'${valor.replace(/'/g, "''")}'`;

// Uma renda em real (CLT) e uma em dólar (US$ 2.000,00 em partes) com a cotação 5,50 do último recebimento:
// previsto = 5.000,00 + 11.000,00 = 16.000,00 em real.
function semeiaCotacao(): void {
  executaSql(
    "pronta",
    [
      `DELETE FROM fixed_income_receipts WHERE fixed_income_id IN (SELECT id FROM fixed_incomes WHERE household_id = ${q(LAR)})`,
      `DELETE FROM fixed_incomes WHERE household_id = ${q(LAR)}`,
      `INSERT INTO fixed_incomes (id, household_id, name, currency, amount_cents, usual_day, arrival, statement_text, kept_usd_is_investment, archived_at) VALUES ('e2e-rfc-clt', ${q(LAR)}, '[TEST] Salário CLT', 'BRL', 500000, 5, 'auto', 'SALARIO', 0, NULL)`,
      `INSERT INTO fixed_incomes (id, household_id, name, currency, amount_cents, usual_day, arrival, statement_text, kept_usd_is_investment, archived_at) VALUES ('e2e-rfc-dolar', ${q(LAR)}, '[TEST] Salário em dólar', 'USD', 200000, 5, 'partes', 'HIGLOBE', 1, NULL)`,
      `INSERT INTO fixed_income_receipts (id, fixed_income_id, cycle_key, transaction_id, amount_cents, received_on, fx_rate, fx_date, confirmed_by) VALUES ('e2e-rfc-r1', 'e2e-rfc-dolar', '2026-09', NULL, 400000, '2026-10-05', 55000, '2026-10-05', 'pessoa')`,
    ].join("; "),
  );
}

test.beforeAll(() => {
  semearInstalacaoPronta();
  semeiaSessaoDaInstalacaoPronta();
});

// Cada teste semeia o próprio lar (uma chamada ao banco de teste); o wrangler sob carga leva segundos por chamada.
test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await signUpAndSignIn(page);
});

// Ao terminar, os recebimentos e as rendas de teste desta spec saem do banco: a spec de renda fixa (TASK-0901) apaga as
// rendas do lar, e um recebimento que sobra com chave estrangeira faria o DELETE dela falhar. Só as linhas com id e2e-rfc-.
test.afterAll(() => {
  executaSql(
    "pronta",
    "DELETE FROM fixed_income_receipts WHERE id LIKE 'e2e-rfc-%'; DELETE FROM fixed_incomes WHERE id LIKE 'e2e-rfc-%'",
  );
});

// O valor grande do previsto: o primeiro número de imagem dentro do cartão "Previsto por ciclo".
const previstoGrande = (page: Page) =>
  page.getByText("Previsto por ciclo", { exact: true }).locator("xpath=..").getByRole("img").first();

async function caixaDe(alvo: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  await expect(alvo).toBeVisible();
  const caixa = await alvo.boundingBox();
  if (!caixa) throw new Error("O elemento não tem caixa na página.");
  return caixa;
}

// A cor do texto é clara (branca, com transparência) quando está sobre o verde. Lê o RGB calculado do navegador.
async function corDoTextoClara(alvo: Locator): Promise<boolean> {
  const cor = await alvo.evaluate((el) => getComputedStyle(el).color);
  const partes = cor.match(/[\d.]+/g)?.map(Number) ?? [];
  const [r = 0, g = 0, b = 0] = partes;
  return r >= 200 && g >= 200 && b >= 200;
}

for (const { nome, largura } of LARGURAS) {
  test.describe(`${nome} (${largura} px)`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 900 });
    });

    test("a lista e o previsto mostram o dólar convertido pela cotação, sobre o verde e sem rolagem lateral", async ({
      page,
    }) => {
      semeiaCotacao();
      await page.goto("/renda/fixa");

      await expect(previstoGrande(page)).toHaveAttribute("aria-label", "16.000,00");
      const legenda = page.locator("li", { hasText: "[TEST] Salário em dólar" });
      await expect(legenda.getByRole("img", { name: "11.000,00" })).toBeVisible();
      await expect(legenda).toContainText("≈");
      // A legenda está na faixa verde do topo: o texto é claro sobre o verde.
      expect(await corDoTextoClara(legenda)).toBe(true);
      const caixaLegenda = await caixaDe(legenda);
      expect(caixaLegenda.y).toBeLessThan(400);

      // Sem rolagem lateral e sem sobreposição com o cartão do previsto.
      const semRolagemLateral = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
      expect(semRolagemLateral).toBe(true);

      // A linha da lista mostra o convertido com "≈" e o valor em dólar na linha de baixo.
      const linhaDaLista = page.getByRole("button", { name: /\[TEST\] Salário em dólar/ });
      await expect(linhaDaLista).toContainText("≈");
      await expect(linhaDaLista).toContainText("US$ 2.000,00");
      const alvo = await caixaDe(linhaDaLista);
      expect(alvo.height).toBeGreaterThanOrEqual(44);
    });

    test("o editor mostra a última cotação, em texto legível e sem sobrepor a linha seguinte", async ({
      page,
    }) => {
      semeiaCotacao();
      await page.goto("/renda/fixa?id=e2e-rfc-dolar");

      const texto = page.getByText("Última: 5,50 em 05/10, então 2.000,00 dólares ≈ 11.000,00 reais.", {
        exact: true,
      });
      await expect(texto).toBeVisible();
      const caixaDoTexto = await caixaDe(texto);
      const caixaDaLinhaSeguinte = await caixaDe(page.getByText("Costuma cair", { exact: true }));
      // A linha de "Costuma cair" começa depois do fim do texto da cotação.
      expect(caixaDaLinhaSeguinte.y).toBeGreaterThanOrEqual(caixaDoTexto.y + caixaDoTexto.height - 1);
      // O texto da cotação fica dentro do quadro, sem sair pela direita.
      const quadro = page.getByText("Cotação automática", { exact: true }).locator("xpath=..");
      const caixaDoQuadro = await caixaDe(quadro);
      expect(caixaDoTexto.x + caixaDoTexto.width).toBeLessThanOrEqual(
        caixaDoQuadro.x + caixaDoQuadro.width + 1,
      );
    });
  });
}

// Layout das colunas, nas três larguras: no celular o editor fica abaixo da lista; no tablet e no desktop, a lista à
// esquerda e o editor à direita, do mesmo topo.
test("as colunas: celular com o editor abaixo, tablet e desktop com a lista à esquerda e o editor à direita", async ({
  page,
}) => {
  semeiaCotacao();
  await page.goto("/renda/fixa?id=e2e-rfc-dolar");
  const botaoDaLista = page.getByRole("button", { name: /\[TEST\] Salário CLT/ });
  const titulo = page.getByRole("heading", { name: "Editar", exact: true });

  await page.setViewportSize({ width: 390, height: 900 });
  const listaCelular = await caixaDe(botaoDaLista);
  const editorCelular = await caixaDe(titulo);
  expect(editorCelular.y).toBeGreaterThanOrEqual(listaCelular.y + listaCelular.height - 1);

  for (const largura of [834, 1440]) {
    await page.setViewportSize({ width: largura, height: 900 });
    const lista = await caixaDe(botaoDaLista);
    const editor = await caixaDe(titulo);
    expect(editor.x, `editor à direita em ${largura} px`).toBeGreaterThan(lista.x + lista.width - 1);
    expect(Math.abs(editor.y - lista.y), `mesmo topo em ${largura} px`).toBeLessThan(120);
  }
});
