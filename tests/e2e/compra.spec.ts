import { expect, type Locator, type Page, test } from "@playwright/test";
import { addDays, standardCycle } from "../../src/shared/cycle";
import { formatDayMonth } from "../../src/shared/format/dates";
import { todayInSaoPaulo } from "../../src/shared/sao-paulo-date";
import { consultaSql, executaSql } from "./helpers/db";
import { LAR_DA_INSTALACAO_PRONTA, semeiaSessaoDaInstalacaoPronta, signUpAndSignIn } from "./helpers/sessao";
import { semearInstalacaoPronta } from "./helpers/setup";

// Compra (TASK-0403) nas três larguras (celular, tablet e desktop), contra o Worker real da instalação pronta. Dados
// [TEST] com o prefixo e2e-cp-: um banco, um cartão, uma conta, a fatura aberta, o ciclo de hoje e algumas compras.
// Cada teste refaz o estado inicial. Provas de posição (caixas que não se cruzam), alvo de 44 px e cor sobre o verde.

const LAR = LAR_DA_INSTALACAO_PRONTA;
const CONEXAO = "e2e-cp-conexao";
const BANCO = "e2e-cp-banco";
const CARTAO = "e2e-cp-cartao";
const CONTA = "e2e-cp-conta";
const NOME_DO_BANCO = "[TEST] Banco E2E Compra";
const FINAL = "6655";
const CATEGORIA_SUGERIDA = "e2e-cp-cat-servicos";
const CATEGORIA_MERCADO = "e2e-cp-cat-mercado";
const CHAVE_DA_COMPRA = "E2E CP JOSEDASILVA";
const ORIGINAL = "PAG*JOSEDASILVA SAO PAULO BR";
const COMPRA = "/compras/e2e-cp-compra";

const q = (valor: string | number | null): string =>
  valor === null ? "NULL" : typeof valor === "number" ? String(valor) : `'${valor.replace(/'/g, "''")}'`;

function ciclosDeTeste() {
  const hoje = todayInSaoPaulo();
  const atual = standardCycle(hoje, 11);
  const anterior = standardCycle(addDays(atual.startsOn, -1), 11);
  return { hoje, atual, anterior };
}

type Extra = {
  cartao?: boolean;
  movimento?: string;
  categoria?: string | null;
  iaCategoria?: string | null;
  iaConfianca?: string | null;
  categorizadoPor?: string | null;
  tipo?: string | null;
  origemTipo?: string | null;
  parcela?: [number, number];
  data?: string;
  horario?: string | null;
};

// Uma transação de teste. Cartão (com a fatura aberta) ou conta; a chave de estabelecimento é a da compra de teste.
function transacao(id: string, valor: number, descricao: string, extra: Extra = {}): string {
  const { hoje, atual } = ciclosDeTeste();
  const data = extra.data ?? hoje;
  const horario = extra.horario === undefined ? "T17:32:00.000Z" : extra.horario;
  const ocorreu = horario === null ? `${data}T12:00:00.000Z` : `${data}${horario}`;
  const naConta = extra.cartao === false;
  return `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, bill_id, movement, occurred_at, local_date, amount_cents, original_description, establishment_key, installment_number, installment_total, cycle_key, category_id, ai_category_id, ai_confidence, categorized_by, categorized_at, spend_type, spend_type_source, hidden, hidden_reason, last_seen_at) VALUES (${q(id)}, ${q(LAR)}, ${q(`e2e-cp-ext-${id}`)}, ${q(BANCO)}, ${q(naConta ? CONTA : null)}, ${q(naConta ? null : CARTAO)}, ${q(naConta ? null : "e2e-cp-b-a")}, ${q(extra.movimento ?? "compra")}, ${q(ocorreu)}, ${q(data)}, ${q(valor)}, ${q(descricao)}, ${q(CHAVE_DA_COMPRA)}, ${q(extra.parcela?.[0] ?? null)}, ${q(extra.parcela?.[1] ?? null)}, ${q(atual.key)}, ${q(extra.categoria ?? null)}, ${q(extra.iaCategoria ?? null)}, ${q(extra.iaConfianca ?? null)}, ${q(extra.categorizadoPor ?? null)}, ${q(extra.categorizadoPor ? ocorreu : null)}, ${q(extra.tipo ?? "prazeres")}, ${q(extra.origemTipo ?? "padrao")}, 0, NULL, ${q(new Date().toISOString())})`;
}

// Estado inicial: banco, cartão, conta, fatura aberta, ciclos, categorias de teste e as compras. Remove as regras da chave.
function preparaCompras(): void {
  const { hoje, atual, anterior } = ciclosDeTeste();
  const agora = new Date().toISOString();
  const vencimento = addDays(atual.endsOn, 7);
  executaSql(
    "pronta",
    [
      `DELETE FROM transactions WHERE id LIKE 'e2e-cp-%'`,
      `DELETE FROM bills WHERE id LIKE 'e2e-cp-%'`,
      `DELETE FROM rules WHERE household_id = ${q(LAR)} AND match_value LIKE 'E2E CP%'`,
      `INSERT OR IGNORE INTO pluggy_connections (id, household_id, label, created_at) VALUES (${q(CONEXAO)}, ${q(LAR)}, '[TEST] Conexão E2E compra', ${q(agora)})`,
      `INSERT OR IGNORE INTO bank_items (id, connection_id, institution_name, institution_color, created_at) VALUES (${q(BANCO)}, ${q(CONEXAO)}, ${q(NOME_DO_BANCO)}, '#8A05BE', ${q(agora)})`,
      `UPDATE bank_items SET disconnected_at = NULL WHERE id = ${q(BANCO)}`,
      `INSERT OR REPLACE INTO cards (id, bank_item_id, last4, name, limit_cents, available_cents, best_day) VALUES (${q(CARTAO)}, ${q(BANCO)}, ${q(FINAL)}, '[TEST] Cartão E2E compra', 600000, 366000, NULL)`,
      `INSERT OR REPLACE INTO accounts (id, bank_item_id, kind, name, balance_cents, overdraft_used_cents, balance_at) VALUES (${q(CONTA)}, ${q(BANCO)}, 'corrente', '[TEST] Conta E2E compra', 0, 0, ${q(agora)})`,
      `INSERT OR REPLACE INTO cycles (household_id, key, starts_on, ends_on) VALUES (${q(LAR)}, ${q(anterior.key)}, ${q(anterior.startsOn)}, ${q(anterior.endsOn)})`,
      `INSERT OR REPLACE INTO cycles (household_id, key, starts_on, ends_on) VALUES (${q(LAR)}, ${q(atual.key)}, ${q(atual.startsOn)}, ${q(atual.endsOn)})`,
      `INSERT OR REPLACE INTO categories (id, household_id, name, color, parent_id, default_spend_type, ai_hint, sort, archived_at) VALUES (${q(CATEGORIA_SUGERIDA)}, ${q(LAR)}, '[TEST] Serviços E2E', '#1B84F2', NULL, NULL, NULL, 0, NULL)`,
      `INSERT OR REPLACE INTO categories (id, household_id, name, color, parent_id, default_spend_type, ai_hint, sort, archived_at) VALUES (${q(CATEGORIA_MERCADO)}, ${q(LAR)}, '[TEST] Mercado E2E', '#22B8E0', NULL, 'fixos', NULL, 0, NULL)`,
      `INSERT INTO bills (id, card_id, closes_on, due_on, amount_cents, status, paid_on, cycle_key) VALUES ('e2e-cp-b-a', ${q(CARTAO)}, ${q(atual.endsOn)}, ${q(vencimento)}, NULL, 'aberta', NULL, ${q(atual.key)})`,
      transacao("e2e-cp-compra", -4500, ORIGINAL, { iaCategoria: CATEGORIA_SUGERIDA, iaConfianca: "pouca" }),
      transacao("e2e-cp-parcelada", -12990, "[TEST] Loja parcelada E2E", {
        parcela: [2, 6],
        categoria: CATEGORIA_MERCADO,
        categorizadoPor: "ia",
        tipo: "fixos",
        origemTipo: "categoria",
      }),
      transacao("e2e-cp-automatica", -9990, "[TEST] Mercado automático E2E", {
        categoria: CATEGORIA_MERCADO,
        categorizadoPor: "regra",
        tipo: "fixos",
        origemTipo: "categoria",
      }),
      transacao("e2e-cp-estorno", 5000, "[TEST] Estorno E2E", { movimento: "estorno", data: hoje }),
      transacao("e2e-cp-debito", -15990, "[TEST] Débito E2E", { cartao: false, movimento: "debito" }),
      transacao("e2e-cp-boleto", -58000, "[TEST] Boleto E2E", { cartao: false, movimento: "boleto" }),
    ].join("; "),
  );
}

test.beforeAll(() => {
  semearInstalacaoPronta();
  semeiaSessaoDaInstalacaoPronta();
});

test.beforeEach(async ({ page }) => {
  await signUpAndSignIn(page);
  preparaCompras();
});

test.afterAll(() => {
  const { atual, anterior } = ciclosDeTeste();
  executaSql(
    "pronta",
    [
      `DELETE FROM transactions WHERE id LIKE 'e2e-cp-%'`,
      `DELETE FROM bills WHERE id LIKE 'e2e-cp-%'`,
      `DELETE FROM rules WHERE household_id = ${q(LAR)} AND match_value LIKE 'E2E CP%'`,
      `DELETE FROM categories WHERE id LIKE 'e2e-cp-cat-%'`,
      `DELETE FROM cards WHERE id = ${q(CARTAO)}`,
      `DELETE FROM accounts WHERE id = ${q(CONTA)}`,
      `DELETE FROM bank_items WHERE id = ${q(BANCO)}`,
      `DELETE FROM pluggy_connections WHERE id = ${q(CONEXAO)}`,
      `DELETE FROM cycles WHERE household_id = ${q(LAR)} AND key IN (${q(atual.key)}, ${q(anterior.key)})`,
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

// O cartão é o retângulo de classe rounded-card que contém o texto (o Card, ou o link da categoria).
const cartaoDe = (texto: Locator): Locator =>
  texto.locator(
    'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " rounded-card ")][1]',
  );

type Caixa = { x: number; y: number; largura: number; altura: number };
async function caixaDe(alvo: Locator): Promise<Caixa> {
  await expect(alvo).toBeVisible();
  const caixa = await alvo.boundingBox();
  if (caixa === null) throw new Error("sem caixa");
  return { x: caixa.x, y: caixa.y, largura: caixa.width, altura: caixa.height };
}

// Duas caixas não se cruzam: uma fica inteira à esquerda, à direita, acima ou abaixo da outra.
function naoSeCruzam(a: Caixa, b: Caixa): boolean {
  return (
    a.x + a.largura <= b.x + 0.5 ||
    b.x + b.largura <= a.x + 0.5 ||
    a.y + a.altura <= b.y + 0.5 ||
    b.y + b.altura <= a.y + 0.5
  );
}

// Contraste WCAG entre duas cores em rgb(...).
function rgbDe(texto: string): [number, number, number] {
  const [r = 0, g = 0, b = 0] = (texto.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  return [r, g, b];
}
function luminancia([r, g, b]: [number, number, number]): number {
  const canal = (valor: number) => {
    const s = valor / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}
function contraste(a: [number, number, number], b: [number, number, number]): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (claro + 0.05) / (escuro + 0.05);
}

const ISO_DA_HORA = /Hoje, \d{2}\/\d{2} às 14:32 · \[TEST\] Banco E2E Compra final 6655/;

test("detalhe: título, categoria sugerida, tipo padrão, forma, fatura, ciclo e descrição, com os textos da spec", async ({
  page,
}) => {
  await page.goto(COMPRA);
  await expect(page.getByRole("heading", { level: 1, name: "Compra" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: ORIGINAL })).toBeVisible();
  // Sem nome próprio, a linha Original não aparece.
  await expect(page.getByText(`Original: ${ORIGINAL}`)).toHaveCount(0);
  await expect(page.getByText(ISO_DA_HORA)).toBeVisible();

  await expect(page.getByText("Sem categoria · revisar")).toBeVisible();
  await expect(page.getByText("Sugestão da IA: [TEST] Serviços E2E (pouca certeza)")).toBeVisible();
  await expect(page.getByText("Prazeres · padrão")).toBeVisible();
  await expect(
    page.getByText("Sem categoria ainda, então entrou como Prazeres, o padrão. Toque em outro para trocar."),
  ).toBeVisible();

  await expect(page.getByText("Crédito à vista")).toBeVisible();
  const vencimento = formatDayMonth(addDays(ciclosDeTeste().atual.endsOn, 7));
  const fechamento = formatDayMonth(ciclosDeTeste().atual.endsOn);
  await expect(page.getByText(`Fecha ${fechamento} · vence ${vencimento}`)).toBeVisible();
  await expect(page.getByText(/^[A-ZÇÃÉÍÓÚ][a-zçãéíóú]+ · \d{2}\/\d{2} – \d{2}\/\d{2}$/)).toBeVisible();
  await expect(page.getByText("Descrição do banco")).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(5);
  await semRolagemHorizontal(page);
});

test("layout: as caixas não se cruzam, ficam na ordem do protótipo e os alvos têm 44 px", async ({
  page,
}, info) => {
  await page.goto(COMPRA);
  const titulo = cartaoDe(page.getByRole("heading", { level: 2, name: ORIGINAL }));
  const categoria = cartaoDe(page.getByText("Sem categoria · revisar"));
  const tipo = cartaoDe(page.getByRole("radiogroup", { name: "Tipo de gasto" }));
  const linhas = cartaoDe(page.getByText("Descrição do banco"));
  const ocultar = cartaoDe(page.getByRole("switch", { name: "Ocultar dos cálculos e gasto de terceiros" }));

  const caixas = {
    titulo: await caixaDe(titulo),
    categoria: await caixaDe(categoria),
    tipo: await caixaDe(tipo),
    linhas: await caixaDe(linhas),
    ocultar: await caixaDe(ocultar),
  };
  const nomes = Object.keys(caixas) as (keyof typeof caixas)[];
  for (const [indice, nome] of nomes.entries()) {
    for (const outro of nomes.slice(indice + 1)) {
      expect(naoSeCruzam(caixas[nome], caixas[outro]), `${nome} não cruza ${outro}`).toBe(true);
    }
  }

  const largura = info.project.name;
  if (largura === "celular") {
    // Uma coluna, na ordem: título, categoria, tipo, linhas, ocultar.
    expect(caixas.titulo.y).toBeLessThan(caixas.categoria.y);
    expect(caixas.categoria.y).toBeLessThan(caixas.tipo.y);
    expect(caixas.tipo.y).toBeLessThan(caixas.linhas.y);
    expect(caixas.linhas.y).toBeLessThan(caixas.ocultar.y);
    expect(Math.abs(caixas.titulo.x - caixas.tipo.x)).toBeLessThan(1);
  } else if (largura === "tablet") {
    // Duas colunas: à esquerda título, categoria e tipo; à direita linhas e ocultar (como CompraTablet).
    expect(Math.abs(caixas.titulo.x - caixas.categoria.x)).toBeLessThan(1);
    expect(caixas.categoria.y).toBeGreaterThan(caixas.titulo.y);
    expect(caixas.tipo.y).toBeGreaterThan(caixas.categoria.y);
    expect(caixas.linhas.x).toBeGreaterThan(caixas.titulo.x + caixas.titulo.largura);
    expect(caixas.ocultar.y).toBeGreaterThan(caixas.linhas.y);
  } else {
    // Três colunas: título | categoria e tipo | linhas e ocultar, topos alinhados.
    expect(caixas.titulo.x).toBeLessThan(caixas.categoria.x);
    expect(caixas.categoria.x).toBeLessThan(caixas.linhas.x);
    expect(Math.abs(caixas.titulo.y - caixas.categoria.y)).toBeLessThan(2);
    expect(Math.abs(caixas.categoria.y - caixas.linhas.y)).toBeLessThan(2);
    expect(caixas.tipo.x).toBeCloseTo(caixas.categoria.x, 0);
    expect(caixas.ocultar.x).toBeCloseTo(caixas.linhas.x, 0);
  }

  // Alvos de toque: a seta, o lápis, os chips, a chave e a linha da categoria.
  await alvoDeToque44(page.getByRole("link", { name: "Voltar" }));
  await alvoDeToque44(page.getByRole("button", { name: "Renomear" }));
  await alvoDeToque44(page.getByRole("radio", { name: "Conforto" }));
  await alvoDeToque44(page.getByRole("switch", { name: "Ocultar dos cálculos e gasto de terceiros" }));
  await alvoDeToque44(page.getByRole("link", { name: /Sem categoria · revisar/ }));
  await semRolagemHorizontal(page);
});

test("cor: o título branco e o texto laranja da categoria têm contraste suficiente sobre o fundo", async ({
  page,
}) => {
  await page.goto(COMPRA);
  const titulo = page.getByRole("heading", { level: 1, name: "Compra" });
  const cabecalho = page.locator("header").filter({ has: titulo });
  await expect(titulo).toBeVisible();
  // O título está dentro do cabeçalho verde (não sobra para fora dele).
  const caixaDoCabecalho = await caixaDe(cabecalho);
  const caixaDoTitulo = await caixaDe(titulo);
  expect(caixaDoTitulo.y).toBeGreaterThanOrEqual(caixaDoCabecalho.y);
  expect(caixaDoTitulo.y + caixaDoTitulo.altura).toBeLessThanOrEqual(
    caixaDoCabecalho.y + caixaDoCabecalho.altura,
  );

  // Branco sobre o pior ponto do gradiente (a parada mais escura, #0B8C5A).
  const cor = await titulo.evaluate((elemento) => getComputedStyle(elemento).color);
  const contrasteComOVerde = contraste(rgbDe(cor), [11, 140, 90]);
  expect(contrasteComOVerde, `branco sobre #0B8C5A: ${contrasteComOVerde.toFixed(2)}`).toBeGreaterThanOrEqual(
    3,
  );

  // Laranja sobre o verde-claro: 19 px em negrito (texto grande), com 3:1 ou mais.
  const nome = page.getByText("Sem categoria · revisar");
  const estilo = await nome.evaluate((elemento) => {
    const fundo = getComputedStyle(elemento.closest("a") as HTMLElement).backgroundColor;
    const estiloDoNome = getComputedStyle(elemento);
    return { cor: estiloDoNome.color, fundo, tamanho: estiloDoNome.fontSize, peso: estiloDoNome.fontWeight };
  });
  expect(Number.parseFloat(estilo.tamanho)).toBeGreaterThanOrEqual(18.66);
  expect(Number(estilo.peso)).toBeGreaterThanOrEqual(700);
  const contrasteDoLaranja = contraste(rgbDe(estilo.cor), rgbDe(estilo.fundo));
  expect(contrasteDoLaranja).toBeGreaterThanOrEqual(3);
});

test("renomear: o título muda, aparece o original, e usar original desfaz; o banco guarda a descrição original", async ({
  page,
}) => {
  await page.goto(COMPRA);
  await page.getByRole("button", { name: "Renomear" }).click();
  await page.getByLabel("Nome que aparece para vocês").fill("  Conserto do portão  ");
  await page.getByRole("button", { name: "Salvar" }).click();

  await expect(page.getByRole("heading", { level: 2, name: "Conserto do portão" })).toBeVisible();
  await expect(page.getByText(`Original: ${ORIGINAL}`)).toBeVisible();
  const banco = consultaSql(
    "pronta",
    "SELECT original_description, custom_name, category_id FROM transactions WHERE id = 'e2e-cp-compra'",
  );
  expect(banco[0]).toEqual({
    original_description: ORIGINAL,
    custom_name: "Conserto do portão",
    category_id: null,
  });

  await page.getByRole("button", { name: "Renomear" }).click();
  await page.getByRole("button", { name: "Usar original" }).click();
  await expect(page.getByRole("heading", { level: 2, name: ORIGINAL })).toBeVisible();
  await expect(page.getByText(`Original: ${ORIGINAL}`)).toHaveCount(0);
  expect(consultaSql("pronta", "SELECT custom_name FROM transactions WHERE id = 'e2e-cp-compra'")[0]).toEqual(
    {
      custom_name: null,
    },
  );
});

test("nome nas próximas: a chave nasce desligada; ligada, a regra guarda o nome e reabre desligada, com o nome atual", async ({
  page,
}) => {
  await page.goto(COMPRA);
  await page.getByRole("button", { name: "Renomear" }).click();
  const chave = page.getByRole("switch", { name: /Usar este nome nas próximas de/ });
  await expect(chave).toHaveAttribute("aria-checked", "false");
  await page.getByLabel("Nome que aparece para vocês").fill("Presente da mãe");
  await chave.click();
  await page.getByRole("button", { name: "Salvar" }).click();

  await expect(page.getByRole("heading", { level: 2, name: "Presente da mãe" })).toBeVisible();
  const regra = consultaSql(
    "pronta",
    `SELECT set_custom_name FROM rules WHERE household_id = '${LAR}' AND scope = 'estabelecimento' AND match_value = '${CHAVE_DA_COMPRA}' AND disabled_at IS NULL`,
  );
  expect(regra).toEqual([{ set_custom_name: "Presente da mãe" }]);

  await page.getByRole("button", { name: "Renomear" }).click();
  await expect(page.getByRole("switch", { name: /Usar este nome nas próximas de/ })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(page.getByText("Hoje as próximas usam Presente da mãe.")).toBeVisible();
});

test("só esta compra: renomear sem ligar a chave não cria nem muda regra", async ({ page }) => {
  await page.goto(COMPRA);
  await page.getByRole("button", { name: "Renomear" }).click();
  await page.getByLabel("Nome que aparece para vocês").fill("Só esta");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Só esta" })).toBeVisible();
  expect(
    consultaSql(
      "pronta",
      `SELECT id FROM rules WHERE household_id = '${LAR}' AND match_value = '${CHAVE_DA_COMPRA}'`,
    ),
  ).toEqual([]);
});

test("tipo: trocar grava na hora, a ajuda vira a de escolhido, e o cartão não oferece Metas", async ({
  page,
}) => {
  await page.goto(COMPRA);
  await expect(page.getByRole("radio", { name: "Metas" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Investimentos" })).toHaveCount(0);

  await page.getByRole("radio", { name: "Conforto" }).click();
  await expect(page.getByRole("radio", { name: "Conforto" })).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByText(
      "Vale só para esta compra. Para todas da categoria, defina o tipo padrão em Configurações › Tipos de gasto.",
    ),
  ).toBeVisible();
  await expect
    .poll(() =>
      consultaSql(
        "pronta",
        "SELECT spend_type, spend_type_source FROM transactions WHERE id = 'e2e-cp-compra'",
      ),
    )
    .toEqual([{ spend_type: "conforto", spend_type_source: "escolhido" }]);
});

test("ocultar: a etiqueta aparece, o valor fica riscado e a chave desfaz", async ({ page }) => {
  await page.goto(COMPRA);
  const chave = page.getByRole("switch", { name: "Ocultar dos cálculos e gasto de terceiros" });
  await chave.click();
  await expect(page.getByText("Gasto de terceiros · fora dos cálculos")).toBeVisible();
  await expect(page.getByRole("img", { name: "45,00" })).toHaveClass(/line-through/);
  await expect
    .poll(() =>
      consultaSql("pronta", "SELECT hidden, hidden_reason FROM transactions WHERE id = 'e2e-cp-compra'"),
    )
    .toEqual([{ hidden: 1, hidden_reason: "gasto_terceiros" }]);

  await chave.click();
  await expect(page.getByText("Gasto de terceiros · fora dos cálculos")).toHaveCount(0);
  await expect(page.getByRole("img", { name: "45,00" })).not.toHaveClass(/line-through/);
  await expect
    .poll(() =>
      consultaSql("pronta", "SELECT hidden, hidden_reason FROM transactions WHERE id = 'e2e-cp-compra'"),
    )
    .toEqual([{ hidden: 0, hidden_reason: null }]);
});

test("categoria: tocar leva ao seletor com a compra, e a volta é para a compra", async ({ page }) => {
  await page.goto(COMPRA);
  await page.getByRole("link", { name: /Sem categoria · revisar/ }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/categorias/escolher");
  const destino = new URL(page.url());
  expect(destino.searchParams.get("transacao")).toBe("e2e-cp-compra");
  expect(destino.searchParams.get("voltar")).toBe("/compras/e2e-cp-compra");
});

test("categoria automática e categoria da IA: o texto de cada origem", async ({ page }) => {
  await page.goto("/compras/e2e-cp-automatica");
  await expect(page.getByText("Automática: vocês já confirmaram antes. Toque para trocar")).toBeVisible();
  // O nome aparece no cartão e na ajuda do tipo ("Veio da categoria …"): o casamento exato pega só o cartão.
  await expect(page.getByText("[TEST] Mercado E2E", { exact: true })).toBeVisible();

  await page.goto("/compras/e2e-cp-parcelada");
  await expect(
    page.getByText("Sugerida pela IA no histórico, sem conferência. Toque para trocar"),
  ).toBeVisible();
  await expect(page.getByText("Crédito parcelado · parcela 2 de 6")).toBeVisible();
});

test("estorno: o título é Estorno, o valor sai com menos em verde", async ({ page }) => {
  await page.goto("/compras/e2e-cp-estorno");
  await expect(page.getByRole("heading", { level: 1, name: "Estorno" })).toBeVisible();
  const valor = page.getByRole("img", { name: "menos 50,00" });
  await expect(valor).toBeVisible();
  await expect(valor).toHaveCSS("color", "rgb(23, 128, 79)");
  await expect(page.getByText("Estorno", { exact: true }).nth(1)).toBeVisible();
});

test("boleto: sem fatura, com os sete tipos, e com nome e ocultar", async ({ page }) => {
  await page.goto("/compras/e2e-cp-boleto");
  await expect(page.getByRole("heading", { level: 1, name: "Boleto" })).toBeVisible();
  await expect(page.getByText("Fatura", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Sem fatura ainda")).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(7);
  await expect(page.getByRole("radio", { name: "Metas" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Investimentos" })).toBeVisible();
  await expect(page.getByText("Boleto", { exact: true }).nth(1)).toBeVisible();
  await page.getByRole("radio", { name: "Investimentos" }).click();
  await expect
    .poll(() => consultaSql("pronta", "SELECT spend_type FROM transactions WHERE id = 'e2e-cp-boleto'"))
    .toEqual([{ spend_type: "investimentos" }]);
  await page.getByRole("switch", { name: "Ocultar dos cálculos e gasto de terceiros" }).click();
  await expect(page.getByText("Gasto de terceiros · fora dos cálculos")).toBeVisible();
});

test("erro ao gravar: o chip volta ao anterior e o aviso aparece sob o cartão", async ({ page }) => {
  await page.route("**/api/transactions/e2e-cp-compra", (rota) => {
    if (rota.request().method() !== "PATCH") return rota.continue();
    return rota.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "erro_interno", message: "Algo deu errado. Tente de novo." }),
    });
  });
  await page.goto(COMPRA);
  await page.getByRole("radio", { name: "Conforto" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Não deu para salvar. Tente de novo." }),
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: "Prazeres" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "Conforto" })).toHaveAttribute("aria-checked", "false");
});

test("compra que não existe: aviso de não existe mais", async ({ page }) => {
  await page.goto("/compras/e2e-cp-nao-existe");
  await expect(page.getByText("Esta compra não existe mais.")).toBeVisible();
});

test("olho ligado: os valores da compra ficam borrados", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("mm:ocultar-valores", "1"));
  await page.goto(COMPRA);
  const valor = page.getByRole("img", { name: "45,00" });
  await expect(valor).toBeVisible();
  await expect.poll(() => valor.evaluate((elemento) => getComputedStyle(elemento).filter)).toContain("blur");
});
