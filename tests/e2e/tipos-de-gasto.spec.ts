import { expect, type Page, test } from "@playwright/test";
import { LAR_DA_INSTALACAO_PRONTA, signUpAndSignIn } from "./helpers/sessao";
import { semearInstalacaoPronta } from "./helpers/setup";

// Tipos de gasto (TASK-0802) nas três larguras: a API é simulada com page.route (como as outras telas de categorização).
// O simulador devolve o que a tela precisa e guarda o que a tela manda; a regra de verdade (herança, cartão, retroativo,
// reversão) é dos testes de integração (tests/integration/spend-types).

test.beforeEach(async ({ page }) => {
  await signUpAndSignIn(page);
});

test.beforeAll(() => {
  semearInstalacaoPronta();
});

type Percentuais = {
  fixos: number;
  conforto: number;
  educacao: number;
  extras: number;
  metas: number;
  prazeres: number;
};

type Estado = {
  percentuais: Percentuais;
  categorias: Array<{
    id: string;
    name: string;
    parentId: string | null;
    parentName: string | null;
    defaultSpendType: string | null;
    effectiveSpendType: string;
    origin: string;
  }>;
  regras: Array<{ id: string; kind: string; matchValue: string }>;
  patchesDoLar: Array<Partial<Percentuais>>;
  patchesDeCategoria: Array<{ id: string; defaultSpendType: string | null }>;
  criadas: Array<{ kind: string; matchValue: string }>;
};

const SEMENTE_DE_CATEGORIAS: Estado["categorias"] = [
  {
    id: "e2e-mercado",
    name: "Mercado",
    parentId: null,
    parentName: null,
    defaultSpendType: "fixos",
    effectiveSpendType: "fixos",
    origin: "categoria",
  },
  {
    id: "e2e-assinaturas",
    name: "Assinaturas",
    parentId: null,
    parentName: null,
    defaultSpendType: "conforto",
    effectiveSpendType: "conforto",
    origin: "categoria",
  },
  {
    id: "e2e-saude",
    name: "Saúde",
    parentId: null,
    parentName: null,
    defaultSpendType: null,
    effectiveSpendType: "prazeres",
    origin: "padrao",
  },
  {
    id: "e2e-academia",
    name: "Academia",
    parentId: "e2e-saude",
    parentName: "Saúde",
    defaultSpendType: "fixos",
    effectiveSpendType: "fixos",
    origin: "categoria",
  },
  {
    id: "e2e-outros",
    name: "Outros",
    parentId: null,
    parentName: null,
    defaultSpendType: null,
    effectiveSpendType: "prazeres",
    origin: "padrao",
  },
];

async function simularApi(page: Page, inicial: Partial<Percentuais> = {}): Promise<Estado> {
  const estado: Estado = {
    percentuais: { fixos: 35, conforto: 10, educacao: 5, extras: 5, metas: 10, prazeres: 10, ...inicial },
    categorias: SEMENTE_DE_CATEGORIAS.map((c) => ({ ...c })),
    regras: [],
    patchesDoLar: [],
    patchesDeCategoria: [],
    criadas: [],
  };
  await page.route("**/api/setup/status", (rota) =>
    rota.fulfill({ json: { mode: "pronto", unlocked: false, masterKeyOk: true, hasMembers: true } }),
  );
  await page.route("**/api/household", async (rota) => {
    if (rota.request().method() === "PATCH") {
      const corpo = rota.request().postDataJSON() as { percentages: Percentuais };
      estado.patchesDoLar.push(corpo.percentages);
      estado.percentuais = { ...corpo.percentages };
    }
    const p = estado.percentuais;
    await rota.fulfill({
      json: {
        household: {
          id: LAR_DA_INSTALACAO_PRONTA,
          brand: "matrimoney",
          cycleStartDay: 11,
          percentages: {
            ...p,
            investimentos: 100 - (p.fixos + p.conforto + p.educacao + p.extras + p.metas + p.prazeres),
          },
          paidPlan: false,
          createdAt: "2026-11-01T00:00:00.000Z",
        },
        members: [{ id: "e2e-titular", name: "[TEST] Pessoa A", role: "titular", isMe: true }],
      },
    });
  });
  await page.route("**/api/spend-types", (rota) => {
    const p = estado.percentuais;
    const soma = p.fixos + p.conforto + p.educacao + p.extras + p.metas + p.prazeres;
    const limite = p.fixos + p.conforto + p.educacao + p.extras + p.prazeres;
    rota.fulfill({
      json: {
        percentages: p,
        investmentsPct: 100 - soma,
        limitPct: limite,
        base: { cycleKey: "2026-09", label: "setembro", prevIncomeCents: 1656870 },
        currentLimit: { cycleKey: "2026-10", spendLimitCents: 1076966, pct: 65 },
        categories: estado.categorias,
        automaticRules: estado.regras,
        recentDestinations: [{ name: "[TEST] Corretora Destino", bank: null }],
      },
    });
  });
  await page.route("**/api/categories/*", async (rota) => {
    const id = rota.request().url().split("/").pop() ?? "";
    const corpo = rota.request().postDataJSON() as { defaultSpendType: string | null };
    estado.patchesDeCategoria.push({ id, defaultSpendType: corpo.defaultSpendType });
    estado.categorias = estado.categorias.map((c) =>
      c.id === id
        ? {
            ...c,
            defaultSpendType: corpo.defaultSpendType,
            effectiveSpendType: corpo.defaultSpendType ?? "prazeres",
          }
        : c,
    );
    await rota.fulfill({ json: { category: { id } } });
  });
  await page.route("**/api/automatic-rules", async (rota) => {
    const corpo = rota.request().postDataJSON() as { kind: string; matchValue: string };
    estado.criadas.push(corpo);
    const regra = {
      id: `e2e-regra-${estado.criadas.length}`,
      kind: corpo.kind,
      matchValue: corpo.matchValue.toUpperCase(),
    };
    estado.regras = [...estado.regras.filter((r) => r.kind !== corpo.kind), regra];
    await rota.fulfill({ status: 201, json: { rule: regra, applied: 3 } });
  });
  await page.route("**/api/automatic-rules/*", (rota) => rota.fulfill({ json: { reverted: 0 } }));
  return estado;
}

const botaoDoTipo = (page: Page, sinal: "Aumentar" | "Diminuir", rotulo: string) =>
  page.getByRole("button", { name: `${sinal} ${rotulo}`, exact: true });

test("percentual: + grava sozinho e mostra Salvo; Investimentos fecha em 100%", async ({ page }) => {
  const estado = await simularApi(page);
  await page.goto("/configuracoes/tipos-de-gasto");
  await expect(page.getByRole("heading", { name: "Distribuição da renda" })).toBeVisible();

  await botaoDoTipo(page, "Aumentar", "Custos fixos").click();
  await expect(page.getByRole("status").filter({ hasText: "Salvo" })).toBeVisible();
  expect(estado.patchesDoLar).toEqual([
    { fixos: 36, conforto: 10, educacao: 5, extras: 5, metas: 10, prazeres: 10 },
  ]);
  await expect(page.getByTestId("total-distribuicao")).toHaveText("76%");
});

test("soma acima de 100: o aviso aparece e nada é gravado", async ({ page }) => {
  const estado = await simularApi(page, { fixos: 60, metas: 10 });
  await page.goto("/configuracoes/tipos-de-gasto");
  for (let i = 0; i < 25; i++) await botaoDoTipo(page, "Aumentar", "Metas").click();
  await expect(
    page.getByText("Os outros tipos passam de 100%. Reduza algum para sobrar para Investimentos."),
  ).toBeVisible();
  await expect(page.getByTestId("total-distribuicao")).toHaveText("125%");
  await page.waitForTimeout(900);
  expect(estado.patchesDoLar).toEqual([]);
});

test("tipo padrão de uma categoria: a folha grava o tipo novo da categoria", async ({ page }) => {
  const estado = await simularApi(page);
  await page.goto("/configuracoes/tipos-de-gasto");
  await page.getByRole("button", { name: /^Mercado: Custos fixos\. Trocar o tipo$/ }).click();
  const folha = page.getByRole("dialog");
  await expect(folha).toBeVisible();
  await folha.getByRole("radio", { name: "Conforto", exact: true }).click();
  await folha.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(folha).toBeHidden();
  expect(estado.patchesDeCategoria).toEqual([{ id: "e2e-mercado", defaultSpendType: "conforto" }]);
});

test("regra da corretora: Definir, o texto, Salvar regra e a mensagem com o número de transações", async ({
  page,
}) => {
  const estado = await simularApi(page);
  await page.goto("/configuracoes/tipos-de-gasto");
  await page.getByRole("button", { name: "Definir", exact: true }).first().click();
  const folha = page.getByRole("dialog");
  await folha.getByRole("textbox", { name: "Texto do extrato ou nome de quem recebe" }).fill("corretora x");
  await folha.getByRole("button", { name: "Salvar regra", exact: true }).click();
  await expect(page.getByText("Regra salva. 3 transações viraram Investimentos.")).toBeVisible();
  expect(estado.criadas).toEqual([{ kind: "corretora", matchValue: "corretora x" }]);
});

test("Configurações mostra a linha Distribuição da renda, com os números do lar, e leva à tela", async ({
  page,
}) => {
  await simularApi(page);
  await page.goto("/configuracoes");
  await expect(page.getByRole("heading", { name: "Distribuição da renda" })).toBeVisible();
  const linha = page.getByRole("link", { name: /Tipos de gasto/ });
  await expect(linha).toContainText(
    "Fixos 35 · Conforto 10 · Educação 5 · Extras 5 · Metas 10 · Prazeres 10 · Invest. 25",
  );
  await linha.click();
  await expect(page).toHaveURL(/\/configuracoes\/tipos-de-gasto$/);
});

test("alvos de 44 px, sem rolagem horizontal e colunas da largura", async ({ page }, testInfo) => {
  await simularApi(page);
  await page.goto("/configuracoes/tipos-de-gasto");
  await expect(page.getByRole("heading", { name: "Dinheiro guardado · fica fora do limite" })).toBeVisible();

  const botoes = page.getByRole("button", { name: /^(Aumentar|Diminuir) / });
  const total = await botoes.count();
  expect(total).toBeGreaterThanOrEqual(12);
  for (let i = 0; i < total; i++) {
    const caixa = await botoes.nth(i).boundingBox();
    expect(caixa?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  const semRolagem = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(semRolagem).toBe(true);

  const distribuicao = await page.getByRole("heading", { name: "Distribuição da renda" }).boundingBox();
  const guardado = await page
    .getByRole("heading", { name: "Dinheiro guardado · fica fora do limite" })
    .boundingBox();
  if (testInfo.project.name === "celular") {
    // Uma coluna só: a seção "Dinheiro guardado" vem depois da distribuição, na mesma faixa da margem esquerda.
    expect(guardado?.y ?? 0).toBeGreaterThan(distribuicao?.y ?? 0);
    expect(guardado?.x ?? 0).toBeLessThan(60);
  } else {
    expect((guardado?.x ?? 0) > (distribuicao?.x ?? 0) + 50).toBe(true);
  }
});
