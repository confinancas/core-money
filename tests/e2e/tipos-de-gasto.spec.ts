import { expect, type Locator, type Page, test } from "@playwright/test";
import { establishmentKey } from "../../src/shared/establishment-key";
import { todayInSaoPaulo } from "../../src/shared/sao-paulo-date";
import { consultaSql, executaSql } from "./helpers/db";
import { LAR_DA_INSTALACAO_PRONTA, semeiaSessaoDaInstalacaoPronta, signUpAndSignIn } from "./helpers/sessao";
import { semearInstalacaoPronta } from "./helpers/setup";

// Tipos de gasto (TASK-0802) nas três larguras, contra o Worker real da instalação pronta (8788). Dados [TEST]: o
// lar da instalação, uma conexão de teste, uma conta, um cartão, transações com `e2e-tg-` no id e um ciclo de teste.
// Cada teste põe o lar no estado inicial (percentuais da spec, sem regra, sem transação de teste) e desfaz o que fez.
// Só o caso de falha (HTTP 500 ao salvar) fica simulado com page.route.

const LAR = LAR_DA_INSTALACAO_PRONTA;
const CONEXAO = "e2e-tg-conexao";
const BANCO = "e2e-tg-banco";
const CONTA = "e2e-tg-conta";
const CARTAO = "e2e-tg-cartao";
const MERCADO = `seed:${LAR}:mercado`;
// Com acento minúsculo (rodada 2): a regra da corretora casa a contraparte normalizada no SQL, sem o acento.
const CONTRAPARTE = "[TEST] Corretora Ágil Ações";
const PESSOA = "e2e-pessoa-pronta";

const q = (valor: string | number | null): string =>
  valor === null ? "NULL" : typeof valor === "number" ? String(valor) : `'${valor.replace(/'/g, "''")}'`;

function restauraPercentuais(): string {
  return `UPDATE households SET pct_fixed = 35, pct_comfort = 10, pct_education = 5, pct_extras = 5, pct_goals = 10, pct_pleasures = 10 WHERE id = ${q(LAR)}`;
}

// Estado inicial: sem transação, sem regra e sem ciclo de teste; a conexão, a conta e o cartão de teste existem.
function preparaLar(): void {
  const agora = new Date().toISOString();
  executaSql(
    "pronta",
    [
      `DELETE FROM transactions WHERE id LIKE 'e2e-tg-%'`,
      `DELETE FROM automatic_rules WHERE household_id = ${q(LAR)}`,
      `DELETE FROM cycles WHERE household_id = ${q(LAR)}`,
      restauraPercentuais(),
      `INSERT OR IGNORE INTO pluggy_connections (id, household_id, label, created_at) VALUES (${q(CONEXAO)}, ${q(LAR)}, '[TEST] Conexão E2E tipos', ${q(agora)})`,
      `INSERT OR IGNORE INTO bank_items (id, connection_id, institution_name, created_at) VALUES (${q(BANCO)}, ${q(CONEXAO)}, '[TEST] Banco E2E', ${q(agora)})`,
      `INSERT OR IGNORE INTO accounts (id, bank_item_id, kind, name, balance_cents, overdraft_used_cents, balance_at) VALUES (${q(CONTA)}, ${q(BANCO)}, 'corrente', '[TEST] Conta E2E', 0, 0, ${q(agora)})`,
      `INSERT OR IGNORE INTO cards (id, bank_item_id, last4, name) VALUES (${q(CARTAO)}, ${q(BANCO)}, '1234', '[TEST] Cartão E2E')`,
      // Ciclo de teste: o anterior (renda de base) e o atual, que contém hoje. Limite de 10.769,66 com os percentuais da spec.
      `INSERT INTO cycles (household_id, key, starts_on, ends_on, prev_income_cents, spend_limit_cents, pct_fixed, pct_comfort, pct_education, pct_extras, pct_pleasures) VALUES (${q(LAR)}, '1999-12', '1999-12-11', '2000-01-10', 1656870, NULL, NULL, NULL, NULL, NULL, NULL)`,
      `INSERT INTO cycles (household_id, key, starts_on, ends_on, prev_income_cents, spend_limit_cents, pct_fixed, pct_comfort, pct_education, pct_extras, pct_pleasures) VALUES (${q(LAR)}, '2000-01', '2000-01-11', '2999-12-31', 1656870, 1076966, 35, 10, 5, 5, 10)`,
    ].join("; "),
  );
}

type Transacao = {
  id: string;
  descricao: string;
  movimento: "pix_enviado" | "compra";
  valorCentavos: number;
  contraparte?: string | null;
  categoria?: string | null;
  tipo?: string | null;
  origem?: string | null;
  cartao?: boolean;
};

// Uma saída de teste (conta ou cartão), gravada como a importação grava: a chave de estabelecimento vem da descrição.
function insereTransacao(t: Transacao): void {
  const agora = new Date().toISOString();
  const hoje = todayInSaoPaulo();
  const naConta = t.cartao !== true;
  executaSql(
    "pronta",
    `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, movement, occurred_at, local_date, amount_cents, original_description, establishment_key, counterparty_name, category_id, categorized_by, categorized_at, spend_type, spend_type_source, last_seen_at) VALUES (${q(t.id)}, ${q(LAR)}, ${q(`e2e-tg-ext-${t.id}`)}, ${q(BANCO)}, ${q(naConta ? CONTA : null)}, ${q(naConta ? null : CARTAO)}, ${q(t.movimento)}, ${q(`${hoje}T12:00:00.000Z`)}, ${q(hoje)}, ${q(t.valorCentavos)}, ${q(t.descricao)}, ${q(establishmentKey(t.descricao))}, ${q(t.contraparte ?? null)}, ${q(t.categoria ?? null)}, ${q(t.categoria ? PESSOA : null)}, ${q(t.categoria ? agora : null)}, ${q(t.tipo ?? null)}, ${q(t.origem ?? null)}, ${q(agora)})`,
  );
}

function linhaDaTransacao(id: string): { spend_type: string | null; spend_type_source: string | null } {
  const [linha] = consultaSql(
    "pronta",
    `SELECT spend_type, spend_type_source FROM transactions WHERE id = ${q(id)}`,
  );
  if (!linha) throw new Error(`transação ${id} não existe`);
  return linha as { spend_type: string | null; spend_type_source: string | null };
}

test.beforeAll(() => {
  semearInstalacaoPronta();
  semeiaSessaoDaInstalacaoPronta();
});

test.beforeEach(async ({ page }) => {
  await signUpAndSignIn(page);
  preparaLar();
});

test.afterEach(() => {
  executaSql(
    "pronta",
    [
      `DELETE FROM transactions WHERE id LIKE 'e2e-tg-%'`,
      `DELETE FROM automatic_rules WHERE household_id = ${q(LAR)}`,
      `DELETE FROM cycles WHERE household_id = ${q(LAR)}`,
      restauraPercentuais(),
      `UPDATE categories SET default_spend_type = 'fixos' WHERE id = ${q(MERCADO)}`,
    ].join("; "),
  );
});

test.afterAll(() => {
  executaSql(
    "pronta",
    [
      `DELETE FROM transactions WHERE id LIKE 'e2e-tg-%'`,
      `DELETE FROM cards WHERE id = ${q(CARTAO)}`,
      `DELETE FROM accounts WHERE id = ${q(CONTA)}`,
      `DELETE FROM bank_items WHERE id = ${q(BANCO)}`,
      `DELETE FROM pluggy_connections WHERE id = ${q(CONEXAO)}`,
    ].join("; "),
  );
});

const botaoDoTipo = (page: Page, sinal: "Aumentar" | "Diminuir", rotulo: string) =>
  page.getByRole("button", { name: `${sinal} ${rotulo}`, exact: true });

// Alvo de toque: pelo menos 44 px de altura e de largura, medido pelo navegador.
async function alvoDeToqueDeNoMinimo44(alvo: Locator): Promise<void> {
  await expect(alvo).toBeVisible();
  const caixa = await alvo.boundingBox();
  expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(caixa?.width ?? 0).toBeGreaterThanOrEqual(44);
}

test("abre com o limite do ciclo, a distribuição e a categoria com o tipo da spec", async ({ page }) => {
  await page.goto("/configuracoes/tipos-de-gasto");
  await expect(page.getByRole("heading", { name: "Distribuição da renda" })).toBeVisible();
  await expect(page.getByTestId("total-distribuicao")).toHaveText("100%");
  await expect(page.getByTestId("valor-limite")).not.toHaveText("—");
  await expect(
    page.getByText("65% da renda do ciclo anterior · Fixos + Conforto + Educação + Extras + Prazeres"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Mercado: Custos fixos. Trocar o tipo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Academia: Custos fixos. Trocar o tipo" })).toBeVisible();
  // Pílula do tipo como no protótipo: borda e fundo transparente (sem o fundo cheio na cor do tipo).
  const pilula = page
    .getByRole("button", { name: "Mercado: Custos fixos. Trocar o tipo" })
    .locator('span[data-tipo="fixos"]');
  await expect(pilula).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(pilula).toHaveCSS("border-top-style", "solid");
});

test("percentual: + grava sozinho (Salvo) e o limite mostra a prévia do próximo ciclo", async ({ page }) => {
  await page.goto("/configuracoes/tipos-de-gasto");
  await expect(page.getByTestId("total-distribuicao")).toHaveText("100%");

  const gravacao = page.waitForResponse(
    (r) => r.url().endsWith("/api/household") && r.request().method() === "PATCH",
  );
  await botaoDoTipo(page, "Aumentar", "Custos fixos").click();
  expect((await gravacao).status()).toBe(200);
  await expect(page.getByRole("status").filter({ hasText: "Salvo" })).toBeVisible();
  await expect(page.getByText("Com os novos percentuais, o próximo ciclo terá 66% da renda.")).toBeVisible();

  const [lar] = consultaSql("pronta", `SELECT pct_fixed FROM households WHERE id = ${q(LAR)}`);
  expect(lar).toEqual({ pct_fixed: 36 });
});

test("soma acima de 100: o aviso aparece e nada é gravado", async ({ page }) => {
  executaSql("pronta", `UPDATE households SET pct_fixed = 60 WHERE id = ${q(LAR)}`);
  let gravou = false;
  page.on("request", (pedido) => {
    if (pedido.url().endsWith("/api/household") && pedido.method() === "PATCH") gravou = true;
  });
  await page.goto("/configuracoes/tipos-de-gasto");
  await expect(page.getByTestId("total-distribuicao")).toHaveText("100%");

  await botaoDoTipo(page, "Aumentar", "Custos fixos").click();
  await expect(page.getByTestId("total-distribuicao")).toHaveText("101%");
  await expect(
    page.getByText("Os outros tipos passam de 100%. Reduza algum para sobrar para Investimentos."),
  ).toBeVisible();
  await page.waitForTimeout(900);
  expect(gravou).toBe(false);
  const [lar] = consultaSql("pronta", `SELECT pct_fixed FROM households WHERE id = ${q(LAR)}`);
  expect(lar).toEqual({ pct_fixed: 60 });
});

test("falha ao salvar um percentual (HTTP 500, simulada): a mensagem da spec e a linha como estava", async ({
  page,
}) => {
  await page.route("**/api/household", (rota) => {
    if (rota.request().method() === "PATCH")
      return rota.fulfill({ status: 500, json: { error: "erro_interno" } });
    return rota.continue();
  });
  await page.goto("/configuracoes/tipos-de-gasto");
  await expect(page.getByTestId("total-distribuicao")).toHaveText("100%");
  await botaoDoTipo(page, "Aumentar", "Custos fixos").click();
  await expect(page.getByText("Não deu para salvar agora. Tente de novo.")).toBeVisible();
  const [lar] = consultaSql("pronta", `SELECT pct_fixed FROM households WHERE id = ${q(LAR)}`);
  expect(lar).toEqual({ pct_fixed: 35 });
});

test("tipo padrão de uma categoria: a compra que herdava recebe o novo tipo", async ({ page }) => {
  await page.goto("/configuracoes/tipos-de-gasto");
  // A categoria da semente existe depois da primeira leitura da tela; a compra de teste entra depois.
  await expect(page.getByRole("button", { name: "Mercado: Custos fixos. Trocar o tipo" })).toBeVisible();
  insereTransacao({
    id: "e2e-tg-compra-1",
    descricao: "[TEST] Mercado E2E",
    movimento: "compra",
    valorCentavos: -4500,
    categoria: MERCADO,
    tipo: "fixos",
    origem: "categoria",
    cartao: true,
  });
  expect(linhaDaTransacao("e2e-tg-compra-1")).toEqual({
    spend_type: "fixos",
    spend_type_source: "categoria",
  });

  await page.getByRole("button", { name: "Mercado: Custos fixos. Trocar o tipo" }).click();
  const folha = page.getByRole("dialog");
  // "Investimentos" cabe no botão da folha (o texto não estoura a opção), nas três larguras.
  const investimentos = folha.getByRole("radio", { name: "Investimentos", exact: true });
  await expect(investimentos).toBeVisible();
  expect(await investimentos.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await folha.getByRole("radio", { name: "Conforto", exact: true }).click();
  const gravacao = page.waitForResponse(
    (r) => r.url().includes("/api/categories/") && r.request().method() === "PATCH",
  );
  await folha.getByRole("button", { name: "Salvar", exact: true }).click();
  expect((await gravacao).status()).toBe(200);
  await expect(folha).toBeHidden();
  await expect(page.getByRole("button", { name: "Mercado: Conforto. Trocar o tipo" })).toBeVisible();

  expect(linhaDaTransacao("e2e-tg-compra-1")).toEqual({
    spend_type: "conforto",
    spend_type_source: "categoria",
  });
});

test("regra automática: criar faz o Pix virar Investimentos; remover devolve ao padrão", async ({ page }) => {
  insereTransacao({
    id: "e2e-tg-pix-1",
    descricao: "[TEST] Pix Corretora E2E",
    movimento: "pix_enviado",
    valorCentavos: -2500,
    contraparte: CONTRAPARTE,
  });
  expect(linhaDaTransacao("e2e-tg-pix-1")).toEqual({ spend_type: null, spend_type_source: null });

  await page.goto("/configuracoes/tipos-de-gasto");
  await page.getByRole("button", { name: "Definir", exact: true }).first().click();
  const folha = page.getByRole("dialog");
  // O destino recente aparece na folha (o Pix de teste está na janela de 90 dias); tocar nele preenche o texto.
  await alvoDeToqueDeNoMinimo44(folha.getByRole("button", { name: CONTRAPARTE, exact: true }));
  await folha.getByRole("button", { name: CONTRAPARTE, exact: true }).click();
  await expect(folha.getByRole("textbox", { name: "Texto do extrato ou nome de quem recebe" })).toHaveValue(
    CONTRAPARTE,
  );
  await folha.getByRole("button", { name: "Salvar regra", exact: true }).click();
  await expect(page.getByText("Regra salva. 1 transação virou Investimentos.")).toBeVisible();
  expect(linhaDaTransacao("e2e-tg-pix-1")).toEqual({
    spend_type: "investimentos",
    spend_type_source: "regra",
  });

  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remover regra", exact: true }).click();
  await expect(
    page.getByText("Regra removida. As transações voltaram para a categoria ou o padrão."),
  ).toBeVisible();
  expect(linhaDaTransacao("e2e-tg-pix-1")).toEqual({ spend_type: "prazeres", spend_type_source: "padrao" });
});

test("alvos de 44 px, sem rolagem horizontal e colunas da largura", async ({ page }, testInfo) => {
  await page.goto("/configuracoes/tipos-de-gasto");
  await expect(page.getByRole("heading", { name: "Dinheiro guardado · fica fora do limite" })).toBeVisible();

  const botoes = page.getByRole("button", { name: /^(Aumentar|Diminuir) / });
  const total = await botoes.count();
  expect(total).toBeGreaterThanOrEqual(12);
  for (let i = 0; i < total; i++) {
    await alvoDeToqueDeNoMinimo44(botoes.nth(i));
  }

  const semRolagem = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(semRolagem).toBe(true);

  // Colunas como nos protótipos (rodada 2): celular em uma coluna; tablet com "Dinheiro guardado" embaixo da distribuição
  // na esquerda e "Tipo padrão" no topo da direita; desktop com "Tipo padrão" na coluna do meio e "Regras automáticas"
  // numa terceira coluna, no mesmo topo de "Dinheiro guardado".
  const caixa = async (nome: string) => {
    const box = await page.getByRole("heading", { name: nome, exact: true }).boundingBox();
    if (box === null) throw new Error(`título "${nome}" sem caixa`);
    return box;
  };
  const distribuicao = await caixa("Distribuição da renda");
  const guardado = await caixa("Dinheiro guardado · fica fora do limite");
  const gastos = await caixa("Gastos · entram no limite");
  const tipo = await caixa("Tipo padrão por categoria");
  const regras = await caixa("Regras automáticas");
  if (testInfo.project.name === "celular") {
    // Uma coluna, na ordem do protótipo.
    expect(guardado.y).toBeGreaterThan(distribuicao.y);
    expect(guardado.x).toBeLessThan(60);
    expect(tipo.y).toBeGreaterThan(guardado.y);
    expect(regras.y).toBeGreaterThan(tipo.y);
  } else if (testInfo.project.name === "tablet") {
    // "Gastos" e "Dinheiro guardado" são títulos da coluna da esquerda; "Tipo padrão" e "Regras", da direita. (O título
    // da distribuição fica dentro do cartão, com o padding dele, por isso não serve de referência de coluna.)
    expect(Math.abs(guardado.x - gastos.x)).toBeLessThan(5);
    expect(guardado.y).toBeGreaterThan(distribuicao.y);
    expect(tipo.x - gastos.x).toBeGreaterThan(200);
    expect(Math.abs(regras.x - tipo.x)).toBeLessThan(5);
    expect(regras.y).toBeGreaterThan(tipo.y);
  } else {
    expect(guardado.x - distribuicao.x).toBeGreaterThan(200);
    expect(Math.abs(tipo.x - guardado.x)).toBeLessThan(5);
    expect(regras.x - guardado.x).toBeGreaterThan(200);
    expect(Math.abs(regras.y - guardado.y)).toBeLessThan(5);
  }
});

test("um toque feito durante a gravação não se perde: a tela e o banco ficam com o último (37%)", async ({
  page,
}) => {
  // O PATCH leva 500 ms: o segundo toque chega enquanto o primeiro ainda está sendo gravado.
  await page.route("**/api/household", async (rota) => {
    if (rota.request().method() === "PATCH") {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return rota.continue();
  });
  await page.goto("/configuracoes/tipos-de-gasto");
  await expect(page.getByTestId("total-distribuicao")).toHaveText("100%");
  await botaoDoTipo(page, "Aumentar", "Custos fixos").click();
  await page.waitForTimeout(800);
  await botaoDoTipo(page, "Aumentar", "Custos fixos").click();
  await expect(page.getByRole("button", { name: "Diminuir Custos fixos", exact: true })).toBeVisible();
  await expect(page.getByText("37%", { exact: true }).first()).toBeVisible();
  // Duas gravações em sequência, com o PATCH de 500 ms e a máquina ocupada: o banco pode levar alguns segundos a chegar
  // ao 37. Se o toque se perdesse, ficaria em 36 para sempre, e o poll acabaria em falha.
  await expect
    .poll(() => consultaSql("pronta", `SELECT pct_fixed FROM households WHERE id = ${q(LAR)}`), {
      timeout: 20_000,
    })
    .toEqual([{ pct_fixed: 37 }]);
  await expect(page.getByText("37%", { exact: true }).first()).toBeVisible();
});

test("configurações mostra a linha Distribuição da renda, com os números do lar, e leva à tela", async ({
  page,
}) => {
  await page.goto("/configuracoes");
  await expect(page.getByRole("heading", { name: "Distribuição da renda" })).toBeVisible();
  const linha = page.getByRole("link", { name: /Tipos de gasto/ });
  await expect(linha).toContainText(
    "Fixos 35 · Conforto 10 · Educação 5 · Extras 5 · Metas 10 · Prazeres 10 · Invest. 25",
  );
  await linha.click();
  await expect(page).toHaveURL(/\/configuracoes\/tipos-de-gasto$/);
});
