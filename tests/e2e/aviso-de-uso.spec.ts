import { expect, type Locator, type Page, test } from "@playwright/test";
import { executaSql } from "./helpers/db";
import { semeiaSessaoDaInstalacaoPronta, signUpAndSignIn } from "./helpers/sessao";
import { semearInstalacaoPronta } from "./helpers/setup";

// Aviso de uso do plano gratuito (TASK-0109). A instalação pronta (8788) é a do Worker real: o uso do dia é semeado
// no D1 de teste. Só o limite da Cloudflare (a página 1027) e o 429 do D1 são simulados com page.route, como a spec pede.
// As três larguras são os projetos do Playwright (390, 834 e 1440 px).
const TEXTO_DA_FAIXA_DE_LEITURA_72 = "72% das leituras do banco de hoje";
const TEXTO_DA_FAIXA_DE_LEITURA_91 = "91% das leituras do banco de hoje";
const LEITURAS_72 = 3_600_000;
const LEITURAS_91 = 4_550_000;

const hoje = () => new Date().toISOString().slice(0, 10);

// Uso do dia no D1 de teste (o que as requisições teriam gravado). Os testes desfazem no fim.
function semeiaLeiturasDeHoje(leituras: number): void {
  executaSql(
    "pronta",
    `INSERT INTO usage_daily (day, requests, rows_read, rows_written, size_bytes) VALUES ('${hoje()}', 0, ${leituras}, 0, 0) ON CONFLICT(day) DO UPDATE SET rows_read = ${leituras}`,
  );
}

function zeraUso(): void {
  executaSql("pronta", "DELETE FROM usage_daily; UPDATE households SET paid_plan = 0");
}

// Abre Configurações e espera a leitura do uso: a faixa depende dela, e a primeira chamada de cada página pode demorar.
async function abreConfiguracoes(page: Page): Promise<void> {
  const usoLido = page.waitForResponse((resposta) => resposta.url().endsWith("/api/usage") && resposta.ok(), {
    timeout: 20_000,
  });
  await page.goto("/configuracoes");
  await usoLido;
}

// Alvo de toque: pelo menos 44 px de altura e de largura, medido pelo navegador.
async function alvoDeToqueDeNoMinimo44(alvo: Locator): Promise<void> {
  await expect(alvo).toBeVisible();
  const caixa = await alvo.boundingBox();
  expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(caixa?.width ?? 0).toBeGreaterThanOrEqual(44);
}

async function caixaDe(alvo: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  await expect(alvo).toBeVisible();
  const caixa = await alvo.boundingBox();
  if (!caixa) throw new Error("O elemento não tem caixa na página.");
  return caixa;
}

// Nada sai da largura da tela: sem rolagem horizontal da página.
async function semRolagemHorizontal(page: Page): Promise<void> {
  const sobra = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sobra).toBeLessThanOrEqual(0);
}

test.describe("aviso de uso do plano gratuito", () => {
  test.beforeEach(() => {
    semearInstalacaoPronta();
    semeiaSessaoDaInstalacaoPronta();
    zeraUso();
  });

  test.afterEach(() => {
    zeraUso();
  });

  test("cenário 6: 72% mostra a faixa de atenção, dentro da tela, com alvos de 44 px; fechar a atenção a guarda", async ({
    page,
  }) => {
    semeiaLeiturasDeHoje(LEITURAS_72);
    await signUpAndSignIn(page);
    await abreConfiguracoes(page);

    const faixa = page.getByRole("region", { name: "Aviso de uso do plano gratuito" });
    await expect(faixa).toContainText(TEXTO_DA_FAIXA_DE_LEITURA_72);
    await expect(faixa).toContainText(
      "Se chegar a 100%, o app fica sem dados até as 21h (horário de Brasília).",
    );

    // A faixa fica no topo do conteúdo, antes da primeira seção, e cabe na largura da tela.
    const caixaDaFaixa = await caixaDe(faixa);
    const caixaDaPrimeiraSecao = await caixaDe(
      page.getByRole("heading", { level: 2, name: "Casal", exact: true }),
    );
    expect(caixaDaFaixa.y).toBeLessThan(caixaDaPrimeiraSecao.y);
    const larguraDaTela = page.viewportSize()?.width ?? 0;
    expect(caixaDaFaixa.x).toBeGreaterThanOrEqual(0);
    expect(caixaDaFaixa.x + caixaDaFaixa.width).toBeLessThanOrEqual(larguraDaTela);
    await semRolagemHorizontal(page);

    await alvoDeToqueDeNoMinimo44(page.getByRole("button", { name: "Fechar aviso" }));
    await alvoDeToqueDeNoMinimo44(faixa.getByRole("button", { name: /Como fazer o upgrade/ }));

    // Fechar a atenção: some, e continua sumida depois de recarregar (o navegador guarda a escolha).
    await page.getByRole("button", { name: "Fechar aviso" }).click();
    await expect(faixa).toHaveCount(0);
    const usoRelido = page.waitForResponse(
      (resposta) => resposta.url().endsWith("/api/usage") && resposta.ok(),
    );
    await page.reload();
    await usoRelido;
    await expect(page.getByRole("heading", { name: "Configurações", exact: true })).toBeVisible();
    await expect(faixa).toHaveCount(0);
  });

  test("cenário 6: 91% mostra a faixa crítica, sem o ×, e o painel do upgrade abre na própria tela", async ({
    page,
  }) => {
    semeiaLeiturasDeHoje(LEITURAS_91);
    await signUpAndSignIn(page);
    await abreConfiguracoes(page);

    const faixa = page.getByRole("region", { name: "Aviso de uso do plano gratuito" });
    await expect(faixa).toContainText(TEXTO_DA_FAIXA_DE_LEITURA_91);
    await expect(page.getByRole("button", { name: "Fechar aviso" })).toHaveCount(0);

    await faixa.getByRole("button", { name: /Como fazer o upgrade/ }).click();
    const painel = page.getByRole("dialog");
    await expect(painel).toContainText("dash.cloudflare.com");
    await expect(painel).toContainText("Workers Paid (US$ 5 por mês)");
    await expect(painel).toContainText("Nada muda no código nem nos dados.");
    await alvoDeToqueDeNoMinimo44(painel.getByRole("button", { name: "Fechar", exact: true }));
    await painel.getByRole("button", { name: "Fechar", exact: true }).click();
    await expect(painel).toHaveCount(0);
  });

  test("cenário 8: 'Estou no plano pago' tira a faixa nesta tela e no recarregamento; a seção mostra as quatro barras", async ({
    page,
  }) => {
    semeiaLeiturasDeHoje(LEITURAS_91);
    await signUpAndSignIn(page);
    await abreConfiguracoes(page);
    const faixa = page.getByRole("region", { name: "Aviso de uso do plano gratuito" });
    await expect(faixa).toBeVisible();

    const chave = page.getByRole("switch", { name: "Estou no plano pago" });
    await expect(chave).toHaveAttribute("aria-checked", "false");
    // O switch tem a área de toque de 46 px do componente (o pseudo-elemento) e a linha dele tem 64 px.
    const areaDeToque = await chave.evaluate((elemento) => {
      const pseudo = getComputedStyle(elemento, "::before");
      return { altura: Number.parseFloat(pseudo.height), largura: Number.parseFloat(pseudo.width) };
    });
    expect(areaDeToque.altura).toBeGreaterThanOrEqual(44);
    expect(areaDeToque.largura).toBeGreaterThanOrEqual(44);
    await alvoDeToqueDeNoMinimo44(chave.locator("xpath=ancestor::div[contains(@class,'min-h-16')][1]"));

    await chave.click();
    await expect(chave).toHaveAttribute("aria-checked", "true");
    await expect(faixa).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("switch", { name: "Estou no plano pago" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(faixa).toHaveCount(0);

    // A seção segue mostrando o uso, com as quatro barras e a estimativa nas leituras.
    await page.getByRole("button", { name: /Uso de hoje/ }).click();
    for (const nome of ["Requisições", "Leituras do banco", "Escritas do banco", "Tamanho do banco"]) {
      await expect(page.getByRole("progressbar", { name: nome })).toBeVisible();
    }
    await expect(page.getByText("estimativa", { exact: true })).toBeVisible();
    await expect(page.getByText("de 5.000.000")).toBeVisible();
    await expect(page.getByText("de 500 MB")).toBeVisible();
    await semRolagemHorizontal(page);
  });

  test("cenário 10: a página 1027 da Cloudflare vira a tela de limite, dentro da moldura; as telas continuam abrindo", async ({
    page,
  }) => {
    await page.route("**/api/members", (rota) =>
      rota.fulfill({
        status: 429,
        contentType: "text/html; charset=UTF-8",
        body: "<!DOCTYPE html><html><body>error code: 1027</body></html>",
      }),
    );
    await signUpAndSignIn(page);
    await page.goto("/configuracoes");

    await expect(page.getByRole("heading", { name: "Limite do plano gratuito atingido" })).toBeVisible();
    await expect(
      page.getByText("O Matrimoney usou hoje todas as requisições do plano gratuito da Cloudflare."),
    ).toBeVisible();
    await expect(
      page.getByText("Os dados voltam às 21h (horário de Brasília), quando a Cloudflare zera os contadores."),
    ).toBeVisible();
    await expect(page.getByText("error code: 1027")).toHaveCount(0);
    await alvoDeToqueDeNoMinimo44(page.getByRole("button", { name: "Como fazer o upgrade" }));
    await alvoDeToqueDeNoMinimo44(page.getByRole("button", { name: "Tentar de novo" }));
    await semRolagemHorizontal(page);

    // A moldura segue: o menu da aba continua aí, e a tela da outra aba também abre.
    await page.getByRole("button", { name: "Como fazer o upgrade" }).click();
    await expect(page.getByRole("dialog")).toContainText("Como fazer o upgrade");
    await page.getByRole("dialog").getByRole("button", { name: "Fechar", exact: true }).click();

    // Tentar de novo: sem a rota quebrada, o conteúdo volta.
    await page.unroute("**/api/members");
    await page.getByRole("button", { name: "Tentar de novo" }).click();
    await expect(page.getByRole("heading", { name: "Configurações", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Limite do plano gratuito atingido" })).toHaveCount(0);
  });

  test("cenário 9: o 429 limite_d1 do banco vira a tela de limite com a causa do banco", async ({ page }) => {
    await page.route("**/api/members", (rota) =>
      rota.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "limite_d1", resetsAt: "2026-11-11T00:00:00.000Z" }),
      }),
    );
    await signUpAndSignIn(page);
    await page.goto("/configuracoes");

    await expect(page.getByRole("heading", { name: "Limite do plano gratuito atingido" })).toBeVisible();
    await expect(
      page.getByText(
        "O banco do Matrimoney chegou ao limite diário de leituras ou escritas do plano gratuito da Cloudflare.",
      ),
    ).toBeVisible();
    await page.unroute("**/api/members");
  });
});
