import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { marca } from "./marca";

// Moldura nas três larguras (projetos do playwright.config.ts: celular 390, tablet 834, desktop 1440).
// As asserções mudam conforme o projeto; cada uma confere o que aquela largura deve mostrar.

const MENU = "Navegação principal";
const IA = `Assistente de IA do ${marca.name}`;
const ABAS_SEM_IA = ["Início", "Cartões", "Contas do mês (despesas)", "Renda", "Relatório", "Configurações"];

type Largura = "celular" | "tablet" | "desktop";

function larguraDo(testInfo: TestInfo): Largura {
  return testInfo.project.name as Largura;
}

function menu(page: Page): Locator {
  return page.getByRole("navigation", { name: MENU });
}

function linkDoMenu(page: Page, nome: string): Locator {
  return menu(page).getByRole("link", { name: nome, exact: true });
}

// Rótulos dos links do menu visível, na ordem em que aparecem.
async function rotulosDoMenu(page: Page): Promise<string[]> {
  return menu(page)
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("aria-label") ?? ""));
}

async function caixa(locator: Locator) {
  const medida = await locator.boundingBox();
  if (!medida) throw new Error("elemento sem caixa visível");
  return medida;
}

// Cada link do menu tem 44 px ou mais de área de toque de verdade: o ponto perto da borda de cima e de baixo acerta o link.
async function areaDeToqueDe(link: Locator) {
  const medida = await caixa(link);
  const centroX = medida.x + medida.width / 2;
  const acerta = (y: number) =>
    link.evaluate(
      (elemento, [x, ponto]) => {
        const alvo = document.elementFromPoint(x, ponto);
        return alvo !== null && elemento.contains(alvo);
      },
      [centroX, y] as const,
    );

  expect(medida.height).toBeGreaterThanOrEqual(44);
  expect(medida.width).toBeGreaterThanOrEqual(44);
  expect(await acerta(medida.y + 2)).toBe(true);
  expect(await acerta(medida.y + medida.height - 2)).toBe(true);
}

test.describe("menu", () => {
  test("cenários 1 e 2: a forma do menu muda com a largura", async ({ page }, testInfo) => {
    await page.goto("/inicio");
    const largura = larguraDo(testInfo);

    if (largura === "celular") {
      // Barra de baixo: 7 posições na ordem do manual, só ícones, Início marcado, a IA 33 px acima da barra.
      await expect(menu(page)).toBeVisible();
      expect(await rotulosDoMenu(page)).toEqual([
        "Início",
        "Cartões",
        "Contas do mês (despesas)",
        IA,
        "Renda",
        "Relatório",
        "Configurações",
      ]);
      const barra = await caixa(menu(page));
      const viewport = page.viewportSize();
      expect(Math.round(barra.y + barra.height)).toBe(viewport?.height);
      const ia = await caixa(page.getByRole("link", { name: IA }));
      expect(Math.round(barra.y - ia.y)).toBe(33);
      expect(ia.width).toBe(66);
      for (const link of await menu(page).getByRole("link").all()) {
        expect((await link.textContent())?.trim() ?? "").toBe("");
      }
      await expect(linkDoMenu(page, "Início")).toHaveAttribute("aria-current", "page");
    }

    if (largura === "tablet") {
      // Barra de 96 px com ícones, IA logo abaixo do logo, Configurações no pé.
      const barra = await caixa(page.locator("aside").first());
      expect(Math.round(barra.width)).toBe(96);
      const ia = await caixa(page.getByRole("link", { name: IA }));
      const inicio = await caixa(linkDoMenu(page, "Início"));
      expect(ia.y).toBeLessThan(inicio.y);
      const relatorio = await caixa(linkDoMenu(page, "Relatório"));
      const configuracoes = await caixa(linkDoMenu(page, "Configurações"));
      expect(configuracoes.y).toBeGreaterThan(relatorio.y + relatorio.height);
      await expect(page.getByRole("link", { name: `${marca.name}, início` })).toBeVisible();
    }

    if (largura === "desktop") {
      // Barra de 252 px com nomes, cartão do Assistente, sem rodapé do lar (sem membros).
      const barra = await caixa(page.locator("aside").first());
      expect(Math.round(barra.width)).toBe(252);
      for (const nome of ABAS_SEM_IA) {
        await expect(menu(page).getByText(nome.replace(" (despesas)", ""), { exact: true })).toBeVisible();
      }
      await expect(page.getByText("Pergunte sobre o dinheiro de vocês")).toBeVisible();
      await expect(page.getByText("Conta do casal")).toHaveCount(0);
    }
  });

  test("cenário 3: fronteiras 767, 768, 1199 e 1200 px", async ({ page }) => {
    await page.goto("/inicio");

    for (const [largura, esperado] of [
      [767, "celular"],
      [768, "tablet"],
      [1199, "tablet"],
      [1200, "desktop"],
    ] as const) {
      await page.setViewportSize({ width: largura, height: 900 });
      if (esperado === "celular") {
        await expect(menu(page)).toBeVisible();
        await expect(page.locator("aside")).toHaveCount(0);
      } else {
        await expect(page.locator("aside").first()).toBeVisible();
        const barra = await caixa(page.locator("aside").first());
        expect(Math.round(barra.width)).toBe(esperado === "tablet" ? 96 : 252);
      }
    }
  });

  test("cenário 4: tocar em Cartões troca a rota e marca o item", async ({ page }) => {
    await page.goto("/inicio");

    await linkDoMenu(page, "Cartões").click();

    await expect(page).toHaveURL(/\/cartoes$/);
    await expect(linkDoMenu(page, "Cartões")).toHaveAttribute("aria-current", "page");
  });

  test("cenário 4: Configurações abre sem seta de voltar", async ({ page }) => {
    await page.goto("/configuracoes");

    await expect(page.getByRole("link", { name: "Voltar" })).toHaveCount(0);
    await expect(linkDoMenu(page, "Configurações")).toHaveAttribute("aria-current", "page");
  });

  test("cenário 5: detalhes marcam a aba de origem", async ({ page }) => {
    await page.goto("/compras/abc");
    await expect(linkDoMenu(page, "Cartões")).toHaveAttribute("aria-current", "page");

    await page.goto("/pix-recebido/abc");
    await expect(linkDoMenu(page, "Renda")).toHaveAttribute("aria-current", "page");

    await page.goto("/configuracoes/bancos/abc");
    await expect(linkDoMenu(page, "Configurações")).toHaveAttribute("aria-current", "page");
  });

  test("cenário 6: a aba de origem (fromTab) marca Início; sem estado, Cartões", async ({
    page,
  }, testInfo) => {
    const largura = larguraDo(testInfo);

    await page.goto("/inicio");
    await page.evaluate(() => {
      history.pushState({ usr: { fromTab: "inicio" }, key: "teste", idx: 1 }, "", "/categorias/escolher");
      window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    });
    await expect(page).toHaveURL(/\/categorias\/escolher$/);
    if (largura === "celular") {
      // Tela cheia sem menu no celular: o X mostra a aba de origem.
      await expect(page.getByRole("link", { name: "Fechar" })).toHaveAttribute("href", "/inicio");
    } else {
      await expect(linkDoMenu(page, "Início")).toHaveAttribute("aria-current", "page");
    }

    // Recarregar a mesma URL manteria o state (o navegador guarda o history.state no reload): sai antes.
    await page.goto("/inicio");
    await page.goto("/categorias/escolher");
    if (largura === "celular") {
      await expect(page.getByRole("link", { name: "Fechar" })).toHaveAttribute("href", "/cartoes");
    } else {
      await expect(linkDoMenu(page, "Cartões")).toHaveAttribute("aria-current", "page");
    }
  });

  test("cenário 7: /contas/nova é tela cheia: sem menu no celular, com a barra no tablet e no desktop", async ({
    page,
  }, testInfo) => {
    await page.goto("/contas/nova");

    await expect(page.getByRole("link", { name: "Fechar" })).toBeVisible();
    if (larguraDo(testInfo) === "celular") {
      await expect(menu(page)).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Fechar" })).toHaveAttribute("href", "/contas");
    } else {
      await expect(linkDoMenu(page, "Contas do mês (despesas)")).toHaveAttribute("aria-current", "page");
    }
  });

  test("cenário 8: /assistente no celular não tem menu; nas outras larguras, só a IA fica marcada", async ({
    page,
  }, testInfo) => {
    await page.goto("/assistente");

    if (larguraDo(testInfo) === "celular") {
      await expect(menu(page)).toHaveCount(0);
    } else {
      await expect(page.getByRole("link", { name: IA })).toHaveAttribute("aria-current", "page");
      await expect(page.locator('[aria-current="page"]')).toHaveCount(1);
    }
  });

  test("cenário 11: rota desconhecida mostra Página não encontrada dentro da moldura e leva ao início", async ({
    page,
  }) => {
    await page.goto("/nada/aqui");

    await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
    await page.getByRole("button", { name: "Ir para o início" }).click();
    await expect(page).toHaveURL(/\/inicio$/);
  });

  test("área de toque: cada link do menu tem 44 px ou mais, e o toque perto da borda acerta o link", async ({
    page,
  }, testInfo) => {
    await page.goto("/inicio");

    const links = await menu(page).getByRole("link").all();
    expect(links.length).toBeGreaterThanOrEqual(6);
    for (const link of links) {
      await areaDeToqueDe(link);
    }

    if (larguraDo(testInfo) !== "celular") {
      // Fora do celular, o botão da IA também: 66 px de círculo.
      await areaDeToqueDe(page.getByRole("link", { name: IA }));
    }
  });
});

test.describe("moldura", () => {
  test("cenário 14: /inicio, /compras/abc, /contas/nova e /nada/aqui não têm rolagem horizontal", async ({
    page,
  }) => {
    for (const rota of ["/inicio", "/compras/abc", "/contas/nova", "/nada/aqui"]) {
      await page.goto(rota);
      await expect(page.locator("main").first()).toBeVisible();

      const medidas = await page.evaluate(() => ({
        conteudo: document.documentElement.scrollWidth,
        janela: window.innerWidth,
      }));
      expect(medidas.conteudo, rota).toBeLessThanOrEqual(medidas.janela);
    }
  });

  test("não há id repetido na tela (o rosto da IA aparece uma vez por tela)", async ({ page }) => {
    for (const rota of ["/inicio", "/assistente"]) {
      await page.goto(rota);

      const repetidos = await page.evaluate(() => {
        const ids = [...document.querySelectorAll("[id]")].map((elemento) => elemento.id);
        return ids.filter((id, indice) => ids.indexOf(id) !== indice);
      });
      expect(repetidos, rota).toEqual([]);
    }
  });
});
