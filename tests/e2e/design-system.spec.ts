import { expect, type Page, test } from "@playwright/test";

// Catálogo do design system, nos três projetos (celular 390, tablet 834, desktop 1440).
// Valores fictícios; só existe no build de desenvolvimento e no --mode e2e.

const TODOS_OS_VALORES = "[data-v]";

async function todosComFiltro(page: Page, filtro: string) {
  await expect
    .poll(() =>
      page.locator(TODOS_OS_VALORES).evaluateAll((elementos, esperado) => {
        return (
          elementos.length > 0 &&
          elementos.every((elemento) => getComputedStyle(elemento).filter === esperado)
        );
      }, filtro),
    )
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/catalogo");
  await expect(page.getByRole("heading", { name: "Catálogo do design system" })).toBeVisible();
});

test("botão primário: 52 px ou mais, verde da marca e caixa alta", async ({ page }) => {
  const botao = page.getByRole("button", { name: "Primário", exact: true });

  await expect(botao).toHaveCSS("background-color", "rgb(14, 154, 99)");
  await expect(botao).toHaveCSS("text-transform", "uppercase");
  const caixa = await botao.boundingBox();
  expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(52);
});

test("cenário 2: centavos a 60% da parte inteira, com algarismos tabulares e sem quebra", async ({
  page,
}) => {
  const medidas = await page.locator(".mm-money").evaluateAll((elementos) =>
    elementos.map((elemento) => {
      const estilo = getComputedStyle(elemento);
      const centavos = elemento.querySelector(".mm-cents");
      return {
        razao: parseFloat(getComputedStyle(centavos as Element).fontSize) / parseFloat(estilo.fontSize),
        tabular: estilo.fontVariantNumeric.includes("tabular-nums"),
        semQuebra: estilo.whiteSpace === "nowrap",
      };
    }),
  );

  expect(medidas.length).toBeGreaterThanOrEqual(7);
  for (const medida of medidas) {
    expect(medida.razao).toBeCloseTo(0.6, 2);
    expect(medida.tabular).toBe(true);
    expect(medida.semQuebra).toBe(true);
  }
});

test("cenário 3: o olho borra todo data-v, inclusive no diálogo aberto, e volta", async ({ page }) => {
  await page.getByRole("button", { name: "Ocultar valores" }).click();
  await expect(page.locator("html")).toHaveClass(/mm-oculto/);
  await expect(page.getByRole("button", { name: "Mostrar valores" })).toBeVisible();
  await todosComFiltro(page, "blur(7px)");

  await page.getByRole("button", { name: "Abrir confirmação" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await todosComFiltro(page, "blur(7px)");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.getByRole("button", { name: "Mostrar valores" }).click();
  await todosComFiltro(page, "none");
});

test("cenário 5: chave, segmentado e escolha respondem ao toque e ao teclado", async ({ page }) => {
  const chave = page.getByRole("switch", { name: "Avisar no limite" });
  await expect(chave).toHaveAttribute("aria-checked", "true");
  await chave.click();
  await expect(chave).toHaveAttribute("aria-checked", "false");

  // A área de toque da chave tem 46 px de altura: 22 px acima e abaixo do centro ainda acertam a chave.
  await chave.scrollIntoViewIfNeeded();
  for (const deslocamento of [-22, 22]) {
    const acertou = await chave.evaluate((elemento, dy) => {
      const caixa = elemento.getBoundingClientRect();
      const alvo = document.elementFromPoint(caixa.left + caixa.width / 2, caixa.top + caixa.height / 2 + dy);
      return alvo !== null && elemento.contains(alvo);
    }, deslocamento);
    expect(
      acertou,
      `a ${Math.abs(deslocamento)} px do centro, ${deslocamento < 0 ? "acima" : "abaixo"}`,
    ).toBe(true);
  }

  await page.getByRole("radio", { name: "Mês", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Ciclo", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  const escolha = page.getByRole("radio", { name: "Nós dois", exact: true });
  await escolha.click();
  await expect(escolha).toHaveAttribute("aria-checked", "true");
});

test("cenário 6: Esc cancela, mostra Cancelado e devolve o foco; confirmar mostra Confirmado", async ({
  page,
}) => {
  const abrir = page.getByRole("button", { name: "Abrir confirmação" });

  await abrir.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("Cancelado", { exact: true })).toBeVisible();
  await expect(abrir).toBeFocused();

  await abrir.click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.getByText("Confirmado", { exact: true })).toBeVisible();
});

test("cenário 9: a grade tem 1, 2 ou 3 colunas conforme a largura, sem rolagem horizontal", async ({
  page,
}, info) => {
  const esperadas: Record<string, number> = { celular: 1, tablet: 2, desktop: 3 };

  const colunas = await page
    .getByTestId("grade-do-catalogo")
    .evaluate((elemento) => getComputedStyle(elemento).gridTemplateColumns.split(" ").length);
  expect(colunas).toBe(esperadas[info.project.name]);

  const medidas = await page.evaluate(() => ({
    conteudo: document.documentElement.scrollWidth,
    janela: window.innerWidth,
  }));
  expect(medidas.conteudo).toBeLessThanOrEqual(medidas.janela);
});

test("a Nunito vem do próprio app, sem pedido ao Google Fonts", async ({ page }) => {
  const pedidos: string[] = [];
  page.on("request", (pedido) => pedidos.push(pedido.url()));

  await page.reload();
  await expect(page.getByRole("heading", { name: "Catálogo do design system" })).toBeVisible();

  expect(
    pedidos.some((url) => url.includes("fonts.googleapis.com") || url.includes("fonts.gstatic.com")),
  ).toBe(false);
  const familias = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((fonte) => fonte.status === "loaded").map((fonte) => fonte.family);
  });
  expect(familias.some((familia) => familia.includes("Nunito"))).toBe(true);
});

test.describe("sem movimento reduzido", () => {
  test("o esqueleto pulsa", async ({ page }) => {
    await expect(page.locator(".mm-esqueleto").first()).toHaveCSS("animation-name", "mm-pulsar");
  });
});

test.describe("com movimento reduzido", () => {
  test.use({ reducedMotion: "reduce" });

  test("cenário 8: o esqueleto fica parado e o olho troca sem transição", async ({ page }) => {
    await expect(page.locator(".mm-esqueleto").first()).toHaveCSS("animation-name", "none");
    await expect(page.locator(TODOS_OS_VALORES).first()).toHaveCSS("transition-property", "none");
  });
});
