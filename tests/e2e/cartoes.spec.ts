import { expect, type Locator, type Page, test } from "@playwright/test";
import { addDays, standardCycle } from "../../src/shared/cycle";
import { monthNamePt } from "../../src/shared/format/dates";
import { todayInSaoPaulo } from "../../src/shared/sao-paulo-date";
import { consultaSql, executaSql } from "./helpers/db";
import { LAR_DA_INSTALACAO_PRONTA, semeiaSessaoDaInstalacaoPronta, signUpAndSignIn } from "./helpers/sessao";
import { semearInstalacaoPronta } from "./helpers/setup";

// Cartões (TASK-0402) nas três larguras (os projetos celular, tablet e desktop), contra o Worker real da instalação
// pronta (8788). Dados [TEST]: um banco, um cartão e faturas com o id `e2e-cr-`, nos ciclos de hoje e do mês anterior.
// Cada teste põe o estado inicial; só a falha de rede é simulada com page.route.

const LAR = LAR_DA_INSTALACAO_PRONTA;
const CONEXAO = "e2e-cr-conexao";
const BANCO = "e2e-cr-banco";
const CARTAO = "e2e-cr-cartao";
const NOME_DO_BANCO = "[TEST] Banco E2E Cartões";
const FINAL = "7777";

const q = (valor: string | number | null): string =>
  valor === null ? "NULL" : typeof valor === "number" ? String(valor) : `'${valor.replace(/'/g, "''")}'`;

// Os ciclos de teste: o atual (o que contém hoje) e o anterior, com dia de início 11 (o padrão do lar).
function ciclosDeTeste() {
  const hoje = todayInSaoPaulo();
  const atual = standardCycle(hoje, 11);
  const anterior = standardCycle(addDays(atual.startsOn, -1), 11);
  const anteriorAoAnterior = standardCycle(addDays(anterior.startsOn, -1), 11);
  return { hoje, atual, anterior, anteriorAoAnterior };
}

// Estado inicial: o banco, o cartão e as faturas de teste; os lançamentos e os ciclos de teste são refeitos.
function preparaCartoes(): void {
  const { hoje, atual, anterior, anteriorAoAnterior } = ciclosDeTeste();
  const agora = new Date().toISOString();
  const vencimentoDaAberta = addDays(atual.endsOn, 7);
  const vencimentoDaAnterior = addDays(anterior.endsOn, 7);
  const vencimentoDaAnteriorAoAnterior = addDays(anteriorAoAnterior.endsOn, 7);
  const compra = (
    id: string,
    valor: number,
    descricao: string,
    fatura: string | null,
    ciclo: string,
    extra: { movimento?: string; parcela?: [number, number]; oculto?: boolean; data?: string } = {},
  ) =>
    `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, bill_id, movement, occurred_at, local_date, amount_cents, original_description, establishment_key, installment_number, installment_total, cycle_key, hidden, hidden_reason, last_seen_at) VALUES (${q(id)}, ${q(LAR)}, ${q(`e2e-cr-ext-${id}`)}, ${q(BANCO)}, NULL, ${q(CARTAO)}, ${q(fatura)}, ${q(extra.movimento ?? "compra")}, ${q(`${extra.data ?? hoje}T12:00:00.000Z`)}, ${q(extra.data ?? hoje)}, ${q(valor)}, ${q(descricao)}, ${q(`E2E CR ${id}`)}, ${q(extra.parcela?.[0] ?? null)}, ${q(extra.parcela?.[1] ?? null)}, ${q(ciclo)}, ${q(extra.oculto ? 1 : 0)}, ${q(extra.oculto ? "gasto_terceiros" : null)}, ${q(agora)})`;

  executaSql(
    "pronta",
    [
      `DELETE FROM transactions WHERE id LIKE 'e2e-cr-%'`,
      `DELETE FROM bills WHERE id LIKE 'e2e-cr-%'`,
      `DELETE FROM cycles WHERE household_id = ${q(LAR)}`,
      `INSERT OR IGNORE INTO pluggy_connections (id, household_id, label, created_at) VALUES (${q(CONEXAO)}, ${q(LAR)}, '[TEST] Conexão E2E cartões', ${q(agora)})`,
      `INSERT OR IGNORE INTO bank_items (id, connection_id, institution_name, institution_color, created_at) VALUES (${q(BANCO)}, ${q(CONEXAO)}, ${q(NOME_DO_BANCO)}, '#8A05BE', ${q(agora)})`,
      `UPDATE bank_items SET disconnected_at = NULL WHERE id = ${q(BANCO)}`,
      `INSERT OR REPLACE INTO cards (id, bank_item_id, last4, name, limit_cents, available_cents, best_day) VALUES (${q(CARTAO)}, ${q(BANCO)}, ${q(FINAL)}, '[TEST] Cartão E2E', 600000, 366000, NULL)`,
      `INSERT INTO cycles (household_id, key, starts_on, ends_on) VALUES (${q(LAR)}, ${q(anteriorAoAnterior.key)}, ${q(anteriorAoAnterior.startsOn)}, ${q(anteriorAoAnterior.endsOn)})`,
      `INSERT INTO cycles (household_id, key, starts_on, ends_on) VALUES (${q(LAR)}, ${q(anterior.key)}, ${q(anterior.startsOn)}, ${q(anterior.endsOn)})`,
      `INSERT INTO cycles (household_id, key, starts_on, ends_on) VALUES (${q(LAR)}, ${q(atual.key)}, ${q(atual.startsOn)}, ${q(atual.endsOn)})`,
      `INSERT INTO bills (id, card_id, closes_on, due_on, amount_cents, status, paid_on, cycle_key) VALUES ('e2e-cr-b-pp', ${q(CARTAO)}, ${q(anteriorAoAnterior.endsOn)}, ${q(vencimentoDaAnteriorAoAnterior)}, NULL, 'paga', ${q(vencimentoDaAnteriorAoAnterior)}, ${q(anteriorAoAnterior.key)})`,
      `INSERT INTO bills (id, card_id, closes_on, due_on, amount_cents, status, paid_on, cycle_key) VALUES ('e2e-cr-b-p', ${q(CARTAO)}, ${q(anterior.endsOn)}, ${q(vencimentoDaAnterior)}, NULL, 'paga', ${q(vencimentoDaAnterior)}, ${q(anterior.key)})`,
      `INSERT INTO bills (id, card_id, closes_on, due_on, amount_cents, status, paid_on, cycle_key) VALUES ('e2e-cr-b-a', ${q(CARTAO)}, ${q(atual.endsOn)}, ${q(vencimentoDaAberta)}, NULL, 'aberta', NULL, ${q(atual.key)})`,
      compra(
        "e2e-cr-pp-1",
        -312000,
        "[TEST] Mercado anterior ao anterior",
        "e2e-cr-b-pp",
        anteriorAoAnterior.key,
        { data: anteriorAoAnterior.startsOn },
      ),
      compra("e2e-cr-p-1", -287040, "[TEST] Mercado anterior", "e2e-cr-b-p", anterior.key, {
        data: anterior.startsOn,
      }),
      compra("e2e-cr-compra-1", -18990, "[TEST] Mercado E2E", "e2e-cr-b-a", atual.key),
      compra("e2e-cr-compra-2", -7490, "[TEST] iFood E2E", "e2e-cr-b-a", atual.key),
      compra("e2e-cr-parc-1", -14990, "[TEST] Amazon E2E", "e2e-cr-b-a", atual.key, { parcela: [2, 6] }),
      compra("e2e-cr-parc-2", -26630, "[TEST] Decathlon E2E", "e2e-cr-b-a", atual.key, { parcela: [1, 3] }),
      compra("e2e-cr-estorno", 5000, "[TEST] Estorno E2E", "e2e-cr-b-a", atual.key, { movimento: "estorno" }),
      compra("e2e-cr-oculto", -31250, "[TEST] Terceiros E2E", "e2e-cr-b-a", atual.key, { oculto: true }),
    ].join("; "),
  );
}

// Tira o cartão de teste do lar (como um banco desconectado) e volta depois.
const desconectaBanco = (): void =>
  executaSql(
    "pronta",
    `UPDATE bank_items SET disconnected_at = '2026-01-01T00:00:00.000Z' WHERE id = ${q(BANCO)}`,
  );
const reconectaBanco = (): void =>
  executaSql("pronta", `UPDATE bank_items SET disconnected_at = NULL WHERE id = ${q(BANCO)}`);

test.beforeAll(() => {
  semearInstalacaoPronta();
  semeiaSessaoDaInstalacaoPronta();
});

test.beforeEach(async ({ page }) => {
  await signUpAndSignIn(page);
  preparaCartoes();
});

test.afterEach(() => {
  executaSql(
    "pronta",
    [
      `DELETE FROM transactions WHERE id LIKE 'e2e-cr-%'`,
      `DELETE FROM bills WHERE id LIKE 'e2e-cr-%'`,
      `UPDATE bank_items SET disconnected_at = NULL WHERE id = ${q(BANCO)}`,
    ].join("; "),
  );
});

test.afterAll(() => {
  executaSql(
    "pronta",
    [
      `DELETE FROM transactions WHERE id LIKE 'e2e-cr-%'`,
      `DELETE FROM bills WHERE id LIKE 'e2e-cr-%'`,
      `DELETE FROM cards WHERE id = ${q(CARTAO)}`,
      `DELETE FROM bank_items WHERE id = ${q(BANCO)}`,
      `DELETE FROM pluggy_connections WHERE id = ${q(CONEXAO)}`,
      `DELETE FROM cycles WHERE household_id = ${q(LAR)} AND key IN (${q(ciclosDeTeste().atual.key)}, ${q(ciclosDeTeste().anterior.key)}, ${q(ciclosDeTeste().anteriorAoAnterior.key)})`,
    ].join("; "),
  );
});

// Alvo de toque: pelo menos 44 px de altura e de largura, medido pelo navegador.
async function alvoDeToque44(alvo: Locator): Promise<void> {
  await expect(alvo).toBeVisible();
  const caixa = await alvo.boundingBox();
  expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(caixa?.width ?? 0).toBeGreaterThanOrEqual(44);
}

// Sem rolagem horizontal da página, em qualquer largura.
async function semRolagemHorizontal(page: Page): Promise<void> {
  const medida = await page.evaluate(() => ({
    rolagem: document.documentElement.scrollWidth,
    janela: document.documentElement.clientWidth,
  }));
  expect(medida.rolagem).toBeLessThanOrEqual(medida.janela);
}

// O cartão é o link com o final e o ciclo; as compras recentes também levam o nome do banco, então não serve.
const cartaoNaLista = (page: Page) => page.getByRole("link", { name: /final 7777 · ciclo de/ });

test("lista: cartão com a fatura aberta, o limite usado e os balões do topo", async ({ page }, info) => {
  await page.goto("/cartoes");
  await expect(page.getByRole("heading", { name: "Cartões", level: 1 })).toBeVisible();
  const cartao = cartaoNaLista(page);
  await expect(cartao).toBeVisible();
  await expect(cartao).toContainText(`final ${FINAL}`);
  await expect(cartao).toContainText("Fatura aberta");
  await expect(cartao.getByRole("img", { name: "631,00" })).toBeVisible();
  await expect(cartao).toContainText("3.660,00 de limite disponível de 6.000,00");
  await expect(cartao.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "39");
  // Selo "paga" com o ✓ (o svg fica dentro da pílula).
  await expect(cartao.getByText(/ paga$/).locator("svg")).toHaveCount(1);

  // Balões: faturas abertas (631,00) e parcelas futuras (1.132,20, com as parcelas da aberta).
  await expect(page.getByText("Faturas abertas")).toBeVisible();
  await expect(page.getByRole("img", { name: "1.132,20" })).toBeVisible();

  await alvoDeToque44(cartao);
  const largura = info.project.use.viewport?.width ?? 390;
  const caixa = await cartao.boundingBox();
  expect(caixa?.x ?? 0).toBeGreaterThanOrEqual(15);
  expect((caixa?.x ?? 0) + (caixa?.width ?? 0)).toBeLessThanOrEqual(largura - 15);
  await semRolagemHorizontal(page);
});

test("lista: as compras recentes ficam ao lado dos cartões no desktop e embaixo nas outras larguras", async ({
  page,
}, info) => {
  await page.goto("/cartoes");
  const cartao = cartaoNaLista(page);
  await expect(cartao).toBeVisible();
  const titulo = page.getByRole("heading", { name: "Últimas compras" });
  await expect(titulo).toBeVisible();
  // Sem categoria, a compra mostra só "Revisar categoria" (sem data nem banco).
  await expect(page.getByRole("link", { name: /Mercado E2E/ })).toContainText("Revisar categoria");
  await expect(page.getByRole("link", { name: /Mercado E2E/ })).not.toContainText("Hoje");
  await expect(page.getByRole("link", { name: /Estorno E2E/ })).toContainText("estorno");

  const caixaDoCartao = await cartao.boundingBox();
  const caixaDoTitulo = await titulo.boundingBox();
  // Tablet e desktop: as compras ficam ao lado dos cartões (duas colunas). Celular: embaixo.
  if (info.project.name !== "celular") {
    expect(caixaDoTitulo?.x ?? 0).toBeGreaterThan((caixaDoCartao?.x ?? 0) + (caixaDoCartao?.width ?? 0));
  } else {
    expect(caixaDoTitulo?.y ?? 0).toBeGreaterThan((caixaDoCartao?.y ?? 0) + (caixaDoCartao?.height ?? 0));
  }
});

test("lista: toque na compra leva a /compras/:id, e o item oculto aparece riscado", async ({ page }) => {
  await page.goto("/cartoes");
  await expect(page.getByRole("link", { name: /Terceiros E2E/ })).toBeVisible();
  await expect(page.getByText("Gasto de terceiros · fora dos cálculos").first()).toBeVisible();
  await expect(page.getByRole("img", { name: "312,50", exact: true }).first()).toHaveClass(/line-through/);
  // A compra sai sem sinal; só o estorno leva o "−".
  await expect(page.getByRole("img", { name: "74,90", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("img", { name: "menos 74,90" })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "menos 50,00" }).first()).toBeVisible();
  await page.getByRole("link", { name: /Mercado E2E/ }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/compras/e2e-cr-compra-1");
});

test("detalhe: cabeçalho, fatura aberta, balões e cinco faturas no gráfico", async ({ page }, info) => {
  await page.goto("/cartoes");
  await cartaoNaLista(page).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/cartoes/${CARTAO}`);
  await expect(
    page.getByRole("heading", { name: `${NOME_DO_BANCO} · final ${FINAL}`, level: 1 }),
  ).toBeVisible();

  const mesAberto = monthNamePt(ciclosDeTeste().atual.key);
  await expect(page.getByText(`Fatura aberta · ciclo de ${mesAberto}`)).toBeVisible();
  await expect(page.getByText(/^Disponível/).first()).toBeVisible();
  await expect(page.getByRole("img", { name: "3.660,00" }).first()).toBeVisible();
  await expect(page.getByRole("img", { name: "6.000,00" }).first()).toBeVisible();
  await expect(page.getByText("Média 2 meses")).toBeVisible();
  await expect(page.getByRole("img", { name: "2.995,20" })).toBeVisible();

  // Janela de cinco faturas em torno da aberta: duas antes e duas depois.
  await expect(page.getByRole("button", { name: /^Fatura de / })).toHaveCount(5);
  await alvoDeToque44(page.getByRole("button", { name: /^Fatura de / }).first());

  // Lista de compras da fatura aberta: os ocultos entram na contagem à parte.
  await expect(page.getByRole("heading", { name: "Gastos da fatura aberta" })).toBeVisible();
  await expect(page.getByText("5 lançamentos · 1 fora")).toBeVisible();

  // Desktop: o gráfico fica à esquerda da lista de gastos. Celular e tablet: a lista vem depois, embaixo.
  const grafico = await page.getByRole("figure", { name: "Faturas do cartão" }).boundingBox();
  const gastos = await page.getByRole("heading", { name: "Gastos da fatura aberta" }).boundingBox();
  expect(grafico).not.toBeNull();
  // Tablet e desktop: as faturas à esquerda e os gastos à direita. Celular: os gastos embaixo.
  if (info.project.name !== "celular") {
    expect((grafico?.x ?? 0) + (grafico?.width ?? 0)).toBeLessThanOrEqual(gastos?.x ?? 0);
  } else {
    expect(gastos?.y ?? 0).toBeGreaterThan((grafico?.y ?? 0) + (grafico?.height ?? 0) - 1);
  }
  await semRolagemHorizontal(page);
});

test("detalhe: as setas e as barras trocam a fatura; a anterior mostra a variação e a futura as parcelas", async ({
  page,
}) => {
  await page.goto(`/cartoes/${CARTAO}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(FINAL);

  const anterior = page.getByRole("button", { name: "Fatura anterior" });
  const proxima = page.getByRole("button", { name: "Próxima fatura" });
  await alvoDeToque44(anterior);
  await alvoDeToque44(proxima);

  // Aberta → anterior (fechada): ▼ 8,0% contra a de dois meses atrás (3.120,00).
  await anterior.click();
  await expect(page.getByText("▼ 8,0%")).toBeVisible();
  await expect(page.getByText("· fechada")).toBeVisible();

  // Mais uma para trás: a primeira da série não tem mês anterior, e a seta fica desabilitada.
  await anterior.click();
  await expect(page.getByText("sem mês anterior")).toBeVisible();
  await expect(anterior).toBeDisabled();

  // Para a frente até a primeira futura: as parcelas da compra parcelada, pelo nome.
  for (let i = 0; i < 3; i++) await proxima.click();
  await expect(page.getByText("· futura")).toBeVisible();
  await expect(page.getByText("Só parcelas: [TEST] Amazon E2E 3/6 · [TEST] Decathlon E2E 2/3")).toBeVisible();

  // Tocar numa barra seleciona a fatura: a barra escolhida fica marcada.
  // A barra tocada vai para o centro (selecionada): o nome dela fica pressionado.
  const barras = page.getByRole("button", { name: /^Fatura de / });
  const nome = await barras.first().getAttribute("aria-label");
  await barras.first().click();
  await expect(page.getByRole("button", { name: nome ?? "", exact: true, pressed: true })).toBeVisible();
});

test("sem cartões: o estado vazio leva a conectar banco", async ({ page }) => {
  desconectaBanco();
  try {
    await page.goto("/cartoes");
    await expect(page.getByRole("heading", { name: "Nenhum cartão ainda" })).toBeVisible();
    await expect(
      page.getByText("Os cartões aparecem aqui quando um banco com cartão de crédito estiver conectado."),
    ).toBeVisible();
    await alvoDeToque44(page.getByRole("button", { name: "Conectar banco" }));
  } finally {
    reconectaBanco();
  }
});

test("falha de rede: mostra o estado de erro e a tentativa de novo carrega a lista", async ({ page }) => {
  await page.route("**/api/cards", (rota) => rota.abort());
  await page.goto("/cartoes");
  await expect(page.getByRole("alert")).toContainText("Não foi possível carregar");
  await page.unroute("**/api/cards");
  await page.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(cartaoNaLista(page)).toBeVisible();
});

test("o olho esconde os valores dos cartões", async ({ page }) => {
  await page.goto("/cartoes");
  await expect(cartaoNaLista(page)).toBeVisible();
  await page.getByRole("button", { name: "Ocultar valores" }).click();
  await expect(page.locator("html")).toHaveClass(/mm-oculto/);
  await page.getByRole("button", { name: "Mostrar valores" }).click();
  await expect(page.locator("html")).not.toHaveClass(/mm-oculto/);
});

// F1: o topo do detalhe inteiro fica dentro do verde, e o texto tem o gradiente atrás dele, nas três larguras.
test("detalhe: o topo inteiro fica dentro do verde, com fundo em gradiente", async ({ page }) => {
  await page.goto(`/cartoes/${CARTAO}`);
  const topo = page.locator("header").first();
  await expect(topo).toHaveCSS("background-image", /gradient/);
  const alvos = [
    page.getByText("Fecha", { exact: true }).first(),
    page.getByText(/^Disponível/).first(),
    page.getByText("Parcelas futuras", { exact: true }).first(),
    page.getByText("Melhor dia", { exact: true }).first(),
  ];
  // Só mede o topo depois que o conteúdo chegou (o topo cresce quando os dados entram).
  await expect(page.getByText("Fecha", { exact: true }).first()).toBeVisible();
  const caixaDoTopo = await topo.boundingBox();
  for (const alvo of alvos) {
    await expect(alvo).toBeVisible();
    const caixa = await alvo.boundingBox();
    expect(caixa).not.toBeNull();
    expect(caixa?.y ?? 0).toBeGreaterThanOrEqual(caixaDoTopo?.y ?? 0);
    expect((caixa?.y ?? 0) + (caixa?.height ?? 0)).toBeLessThanOrEqual(
      (caixaDoTopo?.y ?? 0) + (caixaDoTopo?.height ?? 0),
    );
    // O fundo computado do contêiner atrás do texto é o gradiente do verde.
    const fundo = await alvo.evaluate((el) => {
      for (let no: HTMLElement | null = el as HTMLElement; no; no = no.parentElement) {
        const imagem = getComputedStyle(no).backgroundImage;
        if (imagem && imagem !== "none") return imagem;
      }
      return "";
    });
    expect(fundo).toContain("gradient");
  }
});

// F2: com o olho ligado, os valores do limite e do topo são borrados no próprio elemento (não só o título).
test("olho: os valores do limite e do topo ficam borrados no próprio elemento", async ({ page }) => {
  await page.goto("/cartoes");
  await expect(cartaoNaLista(page)).toBeVisible();
  await page.getByRole("button", { name: "Ocultar valores" }).click();
  await expect(cartaoNaLista(page).getByRole("img", { name: "3.660,00" }).first()).toHaveCSS(
    "filter",
    /blur/,
  );
  // A escolha fica no aparelho: o detalhe, carregado de novo, abre com os valores borrados.
  await page.goto(`/cartoes/${CARTAO}`);
  await expect(page.getByRole("img", { name: "3.660,00" }).first()).toHaveCSS("filter", /blur/);
  await expect(page.getByRole("img", { name: "631,00" }).first()).toHaveCSS("filter", /blur/);
  await page.evaluate(() => window.localStorage.removeItem("mm:ocultar-valores"));
});

// F6 e F8: "Faturas" no título; as pílulas sem variação são neutras (contorno ou cinza claro).
test("detalhe: as pílulas sem variação são neutras, e o título é Faturas", async ({ page }) => {
  await page.goto(`/cartoes/${CARTAO}`);
  await expect(page.getByRole("heading", { name: "Faturas", level: 2 })).toBeVisible();
  const aberta = page.getByText("parcial · aberta", { exact: true });
  await expect(aberta).toHaveCSS("border-top-width", "1px");
  await expect(aberta).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const anterior = page.getByRole("button", { name: "Fatura anterior" });
  await anterior.click();
  await anterior.click();
  const semMes = page.getByText("sem mês anterior", { exact: true });
  await expect(semMes).toHaveCSS("background-color", "rgb(225, 231, 228)");
  await expect(semMes).toHaveCSS("color", "rgb(102, 117, 110)");
});

// Confere que os dados de teste foram gravados (checagem do próprio teste, sem depender da tela).
test("os dados de teste estão no banco da instalação", () => {
  const linhas = consultaSql("pronta", `SELECT COUNT(*) AS total FROM bills WHERE id LIKE 'e2e-cr-%'`);
  expect(Number((linhas[0] as { total: number }).total)).toBe(3);
});
