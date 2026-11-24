import { expect, type Locator, type Page, test } from "@playwright/test";
import { consultaSql, executaSql } from "./helpers/db";
import { LAR_DA_INSTALACAO_PRONTA, signUpAndSignIn } from "./helpers/sessao";
import { semearInstalacaoPronta, zeraChavesDaInstalacaoPronta } from "./helpers/setup";

// Para categorizar (TASK-0304) nas três larguras (celular, tablet, desktop), contra o Worker da instalação pronta.
// Dados [TEST] com o prefixo e2e-pc-. Cenários da seção Testes: 2, 3, 4, 5, 6, 12, 16, 20 e 26. Provas de layout:
// colunas do tablet e do desktop, nenhuma sobreposição, botão Aceitar com contraste de 4,5:1 ou mais.

const LAR = LAR_DA_INSTALACAO_PRONTA;
const CONEXAO = "e2e-pc-conexao";
const BANCO = "e2e-pc-banco";
const CONTA = "e2e-pc-conta";
const CARTAO = "e2e-pc-cartao";
const CATEGORIA_IA = "e2e-pc-categoria";
const CATEGORIA_NOME = "Triagem E2E";

const q = (valor: string | number | null): string =>
  valor === null ? "NULL" : typeof valor === "number" ? String(valor) : `'${valor.replace(/'/g, "''")}'`;

type Linha = {
  id: string;
  nome: string;
  chave: string;
  valor: number;
  movement?: string;
  cartao?: boolean;
  sugestao?: boolean;
  data?: string;
};

// Insere o cenário: banco, conta, cartão e categoria de teste, e as linhas dadas (sem categoria, pendentes).
function semeiaFila(linhas: Linha[]): void {
  const agora = new Date().toISOString();
  executaSql(
    "pronta",
    [
      "DELETE FROM fixed_income_receipts WHERE transaction_id LIKE 'e2e-pc-%'",
      "DELETE FROM transactions WHERE id LIKE 'e2e-pc-%'",
    ].join(";\n"),
  );
  executaSql("pronta", `DELETE FROM rules WHERE household_id = ${q(LAR)} AND match_value LIKE 'TEST E2E%'`);
  executaSql(
    "pronta",
    [
      `INSERT OR IGNORE INTO pluggy_connections (id, household_id, label, created_at) VALUES (${q(CONEXAO)}, ${q(LAR)}, '[TEST] Conexão E2E para categorizar', ${q(agora)})`,
      `INSERT OR IGNORE INTO bank_items (id, connection_id, institution_name, institution_color, created_at) VALUES (${q(BANCO)}, ${q(CONEXAO)}, '[TEST] Banco E2E', '#0E9A63', ${q(agora)})`,
      `INSERT OR IGNORE INTO categories (id, household_id, name, color, parent_id, default_spend_type, ai_hint, sort, archived_at) VALUES (${q(CATEGORIA_IA)}, ${q(LAR)}, '[TEST] ${CATEGORIA_NOME}', '#1B84F2', NULL, 'fixos', NULL, 0, NULL)`,
      `INSERT OR IGNORE INTO accounts (id, bank_item_id, kind, name, balance_cents, overdraft_used_cents, balance_at) VALUES (${q(CONTA)}, ${q(BANCO)}, 'corrente', '[TEST] Conta E2E', 0, 0, ${q(agora)})`,
      `INSERT OR IGNORE INTO cards (id, bank_item_id, last4, name) VALUES (${q(CARTAO)}, ${q(BANCO)}, '7777', '[TEST] Cartão E2E')`,
    ].join(";\n"),
  );
  for (const linha of linhas) {
    const cartao = linha.cartao === true;
    executaSql(
      "pronta",
      `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, movement, occurred_at, local_date,
         amount_cents, original_description, establishment_key, counterparty_name, ai_category_id, last_seen_at)
       VALUES (${q(linha.id)}, ${q(LAR)}, ${q(`[TEST] ext-${linha.id}`)}, ${q(BANCO)}, ${cartao ? "NULL" : q(CONTA)},
         ${cartao ? q(CARTAO) : "NULL"}, ${q(linha.movement ?? (cartao ? "compra" : "pix_enviado"))}, ${q(agora)},
         ${q(linha.data ?? "2026-11-05")}, ${linha.valor}, ${q(linha.nome)}, ${q(linha.chave)},
         NULL, ${linha.sugestao === false ? "NULL" : q(CATEGORIA_IA)}, ${q(agora)})`,
    );
  }
}

type Entrada = { id: string; nome: string; valor: number; renda?: boolean };

// Entradas (Pix recebido) com sugestão de renda, no ciclo 2026-10: parte do salário (renda fixa de teste) ou renda variável
// (Venda). Um comando só, porque cada executaSql sobe o wrangler.
function semeiaEntradas(entradas: Entrada[]): void {
  const agora = new Date().toISOString();
  const comandos = [
    `INSERT OR IGNORE INTO cycles (household_id, key, starts_on, ends_on) VALUES (${q(LAR)}, '2026-10', '2026-10-11', '2026-11-10')`,
    `INSERT OR IGNORE INTO fixed_incomes (id, household_id, name, currency, amount_cents, usual_day, arrival, statement_text, kept_usd_is_investment, archived_at) VALUES ('e2e-pc-renda', ${q(LAR)}, '[TEST] Salário em dólar E2E', 'BRL', 1000000, 5, 'manual', NULL, 0, NULL)`,
  ];
  for (const e of entradas) {
    comandos.push(
      `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, movement, occurred_at, local_date,
         amount_cents, original_description, establishment_key, counterparty_name, counterparty_doc_masked, cycle_key,
         ai_income_kind, ai_income_subtype, ai_fixed_income_id, ai_confidence, ai_reason, last_seen_at)
       VALUES (${q(e.id)}, ${q(LAR)}, ${q(`[TEST] ext-${e.id}`)}, ${q(BANCO)}, ${q(CONTA)}, 'pix_recebido', ${q(agora)},
         '2026-10-20', ${e.valor}, ${q(e.nome)}, ${q(`TEST E2E ${e.id}`)}, ${q(e.nome)}, '***.123.456-**', '2026-10',
         ${e.renda ? "'parte_salario'" : "'variavel'"}, ${e.renda ? "NULL" : "'venda'"},
         ${e.renda ? "'e2e-pc-renda'" : "NULL"}, 'media', NULL, ${q(agora)})`,
    );
  }
  executaSql("pronta", comandos.join(";\n"));
}

const DUAS = (): Linha[] => [
  { id: "e2e-pc-1", nome: "[TEST] Pix E2E um", chave: "TEST E2E um", valor: -15000 },
  { id: "e2e-pc-2", nome: "[TEST] Pix E2E dois", chave: "TEST E2E dois", valor: -8000 },
];

// A IA aparece quando existe a linha da chave do Claude. A linha é de teste (o queue não a decifra).
function ligaIADeTeste(): void {
  executaSql(
    "pronta",
    "INSERT INTO app_secrets (name, ciphertext, iv, updated_at) VALUES ('claude_api_key', 'AAAA', 'AAAA', '2026-11-11T00:00:00.000Z')",
  );
}

// Cada executaSql sobe o wrangler (3 a 5 s) e o gancho entra no limite do teste: 120 s, como o Meu Pluggy.
test.setTimeout(120_000);

// A instância pronta é um lar só: outras specs deixam linhas pendentes nele, e a fila conta essas linhas também.
// Esconde o que não é desta spec (marcado com hidden_reason) e libera depois, para não mexer nos dados dos outros.
function isolaFila(): void {
  executaSql(
    "pronta",
    `UPDATE transactions SET hidden = 1, hidden_reason = 'e2e-pc' WHERE household_id = ${q(LAR)} AND hidden = 0 AND id NOT LIKE 'e2e-pc-%'`,
  );
}

function liberaFila(): void {
  executaSql(
    "pronta",
    "UPDATE transactions SET hidden = 0, hidden_reason = NULL WHERE hidden_reason = 'e2e-pc'",
  );
  // Só o que esta spec criou: as linhas, as regras de teste, o cartão, a categoria, a conta e o banco de teste.
  executaSql(
    "pronta",
    [
      "DELETE FROM fixed_income_receipts WHERE transaction_id LIKE 'e2e-pc-%' OR fixed_income_id = 'e2e-pc-renda'",
      "DELETE FROM transactions WHERE id LIKE 'e2e-pc-%'",
      `DELETE FROM rules WHERE household_id = ${q(LAR)} AND match_value LIKE 'TEST E2E%'`,
      `DELETE FROM rules WHERE household_id = ${q(LAR)} AND scope = 'remetente' AND match_value LIKE '%PAGADORA E2E PC%'`,
      "DELETE FROM fixed_incomes WHERE id = 'e2e-pc-renda'",
      `DELETE FROM cards WHERE id = ${q(CARTAO)}`,
      `DELETE FROM accounts WHERE id = ${q(CONTA)}`,
      `DELETE FROM categories WHERE id = ${q(CATEGORIA_IA)}`,
      `DELETE FROM bank_items WHERE id = ${q(BANCO)}`,
      `DELETE FROM pluggy_connections WHERE id = ${q(CONEXAO)}`,
      "DELETE FROM app_secrets WHERE name = 'claude_api_key' AND ciphertext = 'AAAA'",
    ].join(";\n"),
  );
}

test.beforeAll(() => {
  semearInstalacaoPronta();
});

test.beforeEach(async ({ page }) => {
  semearInstalacaoPronta();
  ligaIADeTeste();
  await signUpAndSignIn(page);
  isolaFila();
  semeiaFila(DUAS());
});

test.afterEach(() => {
  liberaFila();
});

async function abre(page: Page): Promise<void> {
  await page.goto("/para-categorizar");
  await expect(page.getByRole("heading", { name: "Para categorizar" })).toBeVisible();
}

// Luminância relativa (WCAG) de uma cor rgb(...), e a razão de contraste entre duas.
async function contrasteDoBotao(botao: Locator): Promise<number> {
  return botao.evaluate((el) => {
    const cor = (texto: string) =>
      texto
        .match(/\d+(\.\d+)?/g)!
        .slice(0, 3)
        .map(Number);
    const lum = ([r, g, b]: number[]) => {
      const c = [r, g, b].map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    };
    const estilo = getComputedStyle(el);
    const a = lum(cor(estilo.color));
    const b = lum(cor(estilo.backgroundColor));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

test("cenário 2: mostra a fila, o progresso e aceita em massa", async ({ page }) => {
  await abre(page);
  await expect(page.getByText("0 de 2 categorizados")).toBeVisible();
  await expect(page.getByText("faltam 2")).toBeVisible();

  const aceitar = page.getByRole("button", { name: "Aceitar", exact: true });
  await expect(aceitar).toBeEnabled();
  const caixa = await aceitar.boundingBox();
  expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(await contrasteDoBotao(aceitar)).toBeGreaterThanOrEqual(4.5);

  await aceitar.click();
  await expect(page.getByText("2 de 2 categorizados")).toBeVisible();
  await expect(page.getByText("tudo certo")).toBeVisible();

  const larguraDaJanela = page.viewportSize()?.width ?? 0;
  const semRolagemHorizontal = await page.evaluate(
    (larg) => document.documentElement.scrollWidth <= larg,
    larguraDaJanela,
  );
  expect(semRolagemHorizontal).toBe(true);
  // Rodada 1: nenhum valor com "R$" na tela (o componente de valor usa só o número).
  expect(await page.locator("body").innerText()).not.toContain("R$");
});

test("layout: sem rolagem horizontal, ✓ dentro da tela, uma coluna até o tablet", async ({ page }) => {
  await abre(page);
  const larguraDaJanela = page.viewportSize()?.width ?? 0;
  const semRolagem = await page.evaluate(
    (larg) => document.documentElement.scrollWidth <= larg,
    larguraDaJanela,
  );
  expect(semRolagem).toBe(true);
  const confirmar = page.getByRole("button", { name: /^Confirmar/ }).first();
  const caixaDoCheck = await confirmar.boundingBox();
  expect(caixaDoCheck).toBeTruthy();
  expect(caixaDoCheck!.x).toBeGreaterThanOrEqual(0);
  expect(caixaDoCheck!.x + caixaDoCheck!.width).toBeLessThanOrEqual(larguraDaJanela);
  // Rótulos dos filtros numa linha só (Todos 2, Entradas 0), em todas as larguras.
  const linhasDoRotulo = await page.getByRole("radio").evaluateAll((botoes) =>
    botoes.map((b) => {
      const r = document.createRange();
      r.selectNodeContents(b);
      return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
    }),
  );
  expect(linhasDoRotulo.every((n) => n === 1)).toBe(true);
  const filtros = await page.getByRole("radiogroup", { name: "Filtrar" }).boundingBox();
  const lista = await page.getByTestId("lista").boundingBox();
  expect(filtros && lista).toBeTruthy();
  if (larguraDaJanela >= 1200) {
    // Desktop: filtros à esquerda, lista à direita.
    expect(filtros!.x + filtros!.width).toBeLessThanOrEqual(lista!.x + 1);
  } else {
    // Celular e tablet: uma coluna, filtros acima da lista.
    expect(filtros!.y + filtros!.height).toBeLessThanOrEqual(lista!.y + 1);
  }
});

test("títulos longos: o ✓ continua dentro da tela", async ({ page }) => {
  semeiaFila([
    {
      id: "e2e-pc-longo",
      nome: "[TEST] Pix para NOME DE PESSOA MUITO COMPRIDO QUE NAO CABE NA LINHA DO CELULAR",
      chave: "TEST E2E longo",
      valor: -15000,
    },
  ]);
  await abre(page);
  const larguraDaJanela = page.viewportSize()?.width ?? 0;
  const semRolagem = await page.evaluate(
    (larg) => document.documentElement.scrollWidth <= larg,
    larguraDaJanela,
  );
  expect(semRolagem).toBe(true);
  const caixa = await page
    .getByRole("button", { name: /^Confirmar/ })
    .first()
    .boundingBox();
  expect(caixa && caixa.x + caixa.width <= larguraDaJanela).toBe(true);
});

test("cenário 3: o ✓ confirma só a linha; a outra continua na fila", async ({ page }) => {
  await abre(page);
  await page.getByRole("button", { name: /Confirmar .*Triagem E2E.* para \[TEST\] Pix E2E um/ }).click();
  await expect(page.getByText("1 de 2 categorizados")).toBeVisible();
  await expect(page.getByText("faltam 1")).toBeVisible();
  await expect(page.getByText("[TEST] Pix E2E dois")).toBeVisible();
});

test("cenário 4: desfazer devolve a linha à fila e desconta o progresso", async ({ page }) => {
  await abre(page);
  await page.getByRole("button", { name: "Aceitar", exact: true }).click();
  await expect(page.getByText("2 de 2 categorizados")).toBeVisible();
  // Cada confirmação tem o seu Desfazer (uma linha por item): desfaz as duas.
  await page.getByRole("button", { name: "Desfazer", exact: true }).first().click();
  await page.getByRole("button", { name: "Desfazer", exact: true }).first().click();
  await expect(page.getByText("0 de 2 categorizados")).toBeVisible();
  await expect(page.getByText("[TEST] Pix E2E um")).toBeVisible();
});

test("cenário 5: no filtro Cartão, Aceitar confirma só as compras", async ({ page }) => {
  semeiaFila([
    ...DUAS(),
    {
      id: "e2e-pc-cartao-1",
      nome: "[TEST] Compra E2E",
      chave: "TEST E2E compra",
      valor: -4590,
      cartao: true,
      data: "2026-11-06",
    },
  ]);
  await abre(page);
  await page.getByRole("radio", { name: /^Cartão/ }).click();
  await expect(page.getByText("[TEST] Compra E2E")).toBeVisible();
  await page.getByRole("button", { name: "Aceitar", exact: true }).click();
  await expect(page.getByText("1 de 3 categorizados")).toBeVisible();
  await page.getByRole("radio", { name: /^Todos/ }).click();
  await expect(page.getByText("[TEST] Pix E2E um")).toBeVisible();
  await expect(page.getByTestId("lista").getByText("[TEST] Compra E2E")).toHaveCount(0);
});

test("cenário 6: linha sem sugestão mostra o aviso, sem ✓, e leva ao detalhe", async ({ page }) => {
  semeiaFila([
    {
      id: "e2e-pc-sem",
      nome: "[TEST] Pix sem sugestão",
      chave: "TEST E2E sem",
      valor: -2000,
      sugestao: false,
    },
  ]);
  await abre(page);
  await expect(page.getByText("Sem sugestão · toque para escolher")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Confirmar/ })).toHaveCount(0);
  await page.getByText("[TEST] Pix sem sugestão").click();
  // A linha da fila leva com ?fila=1 (TASK-0404, withQueueParam).
  await expect(page).toHaveURL(/\/pix\/e2e-pc-sem\?fila=1$/);
});

test("cenário 12: sem pendentes, a tela diz que está tudo categorizado", async ({ page }) => {
  semeiaFila([]);
  await abre(page);
  await expect(page.getByText("Tudo categorizado!")).toBeVisible();
});

test("cenário 16: confirmar uma compra leva as iguais que esperavam", async ({ page }) => {
  semeiaFila([
    { id: "e2e-pc-i1", nome: "[TEST] ASAAS E2E", chave: "TEST E2E igual", valor: -3000, movement: "compra" },
    { id: "e2e-pc-i2", nome: "[TEST] ASAAS E2E", chave: "TEST E2E igual", valor: -3000, movement: "compra" },
    { id: "e2e-pc-i3", nome: "[TEST] ASAAS E2E", chave: "TEST E2E igual", valor: -3000, movement: "compra" },
  ]);
  await abre(page);
  await page
    .getByRole("button", { name: /Confirmar .*Triagem E2E.* para \[TEST\] ASAAS E2E/ })
    .first()
    .click();
  await expect(page.getByText("+ 2 iguais")).toBeVisible();
  await expect(page.getByText("3 de 3 categorizados")).toBeVisible();
});

test("cenário 20: desfazer a confirmação devolve as iguais à fila", async ({ page }) => {
  semeiaFila([
    { id: "e2e-pc-i1", nome: "[TEST] ASAAS E2E", chave: "TEST E2E igual", valor: -3000, movement: "compra" },
    { id: "e2e-pc-i2", nome: "[TEST] ASAAS E2E", chave: "TEST E2E igual", valor: -3000, movement: "compra" },
    { id: "e2e-pc-i3", nome: "[TEST] ASAAS E2E", chave: "TEST E2E igual", valor: -3000, movement: "compra" },
  ]);
  await abre(page);
  await page
    .getByRole("button", { name: /Confirmar .*Triagem E2E.* para \[TEST\] ASAAS E2E/ })
    .first()
    .click();
  await expect(page.getByText("3 de 3 categorizados")).toBeVisible();
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(page.getByText("0 de 3 categorizados")).toBeVisible();
  await expect(page.getByText("faltam 3")).toBeVisible();
});

test("cenário 17: o ✓ de uma entrada confirma como parte do salário, e o Desfazer devolve tudo", async ({
  page,
}) => {
  semeiaFila([]);
  semeiaEntradas([{ id: "e2e-pc-ent-1", nome: "[TEST] Pagadora E2E PC", valor: 150_000, renda: true }]);
  await abre(page);
  await expect(page.getByText(/Parte do salário · \[TEST\] Salário em dólar E2E/)).toBeVisible();

  await page.getByRole("button", { name: /^Confirmar Parte do salário.* para .*Pagadora E2E PC/ }).click();
  await expect(page.getByText("1 de 1 categorizados")).toBeVisible();
  const confirmada = consultaSql(
    "pronta",
    "SELECT t.income_kind AS kind, t.fixed_income_id AS renda, (SELECT COUNT(*) FROM fixed_income_receipts WHERE transaction_id = t.id) AS recebimentos, (SELECT COUNT(*) FROM rules WHERE scope = 'remetente' AND disabled_at IS NULL AND match_value LIKE '%PAGADORA E2E PC%') AS regras FROM transactions AS t WHERE t.id = 'e2e-pc-ent-1'",
  )[0];
  expect(confirmada).toMatchObject({
    kind: "parte_salario",
    renda: "e2e-pc-renda",
    recebimentos: 1,
    regras: 1,
  });

  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(page.getByText("0 de 1 categorizados")).toBeVisible();
  await expect(page.getByText(/Pagadora E2E PC/).first()).toBeVisible();
  const desfeita = consultaSql(
    "pronta",
    "SELECT t.income_kind AS kind, (SELECT COUNT(*) FROM fixed_income_receipts WHERE transaction_id = t.id) AS recebimentos, (SELECT COUNT(*) FROM rules WHERE scope = 'remetente' AND disabled_at IS NULL AND match_value LIKE '%PAGADORA E2E PC%') AS regras FROM transactions AS t WHERE t.id = 'e2e-pc-ent-1'",
  )[0];
  expect(desfeita).toMatchObject({ kind: null, recebimentos: 0, regras: 0 });
});

test("cenário 18: Aceitar com 25 entradas confirma 20, e as outras 5 continuam na lista", async ({
  page,
}) => {
  semeiaFila([]);
  semeiaEntradas(
    Array.from({ length: 25 }, (_, i) => ({
      id: `e2e-pc-ent-${String(i).padStart(2, "0")}`,
      nome: `[TEST] Pagadora E2E PC ${i}`,
      valor: 10_000 + i,
    })),
  );
  await abre(page);
  await expect(page.getByText("faltam 25")).toBeVisible();

  await page.getByRole("button", { name: "Aceitar", exact: true }).click();
  await expect(page.getByText("20 de 25 categorizados")).toBeVisible();
  await expect(page.getByText("faltam 5")).toBeVisible();
  await expect(page.getByTestId("lista").getByRole("listitem")).toHaveCount(5);
  const contagem = consultaSql(
    "pronta",
    "SELECT COUNT(*) AS total FROM transactions WHERE id LIKE 'e2e-pc-ent-%' AND income_kind = 'variavel'",
  )[0];
  expect(contagem?.total).toBe(20);
});

test("cenário 26: sem a chave do Claude, a tela oferece colar a chave e não aceita nada", async ({
  page,
}) => {
  zeraChavesDaInstalacaoPronta();
  // As linhas têm sugestão gravada (ai_category_id): sem a chave, nenhuma aparece nem ganha ✓.
  semeiaFila(DUAS());
  await abre(page);
  await expect(page.getByText("Sem IA: vocês escolhem cada um.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Colar a chave" })).toHaveAttribute(
    "href",
    "/configuracoes/claude",
  );
  await expect(page.getByRole("button", { name: "Aceitar", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Confirmar/ })).toHaveCount(0);
  await expect(page.getByText("Sem sugestão · toque para escolher")).toHaveCount(2);
});

// Rodada 2, B1: com contagens de três algarismos em todas as abas, o segmentado cabe na pílula e não invade a lista.
// Semeia 100 compras de cartão, 100 Pix e 100 entradas de uma vez (um comando SQL), com as duas linhas da semente.
test("B1: três algarismos nas abas, o segmentado cabe na pílula e não invade a lista", async ({ page }) => {
  executaSql(
    "pronta",
    [
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100)
       INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, movement, occurred_at, local_date,
         amount_cents, original_description, establishment_key, counterparty_name, ai_category_id, last_seen_at)
       SELECT 'e2e-pc-c' || i, ${q(LAR)}, '[TEST] ext-c' || i, ${q(BANCO)}, NULL, ${q(CARTAO)}, 'compra', ${q("2026-11-11T00:00:00.000Z")},
         '2026-11-05', -1000 - i, '[TEST] Compra muitas ' || i, 'TEST MUITAS C ' || i, NULL, NULL, ${q("2026-11-11T00:00:00.000Z")} FROM n`,
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100)
       INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, movement, occurred_at, local_date,
         amount_cents, original_description, establishment_key, counterparty_name, ai_category_id, last_seen_at)
       SELECT 'e2e-pc-p' || i, ${q(LAR)}, '[TEST] ext-p' || i, ${q(BANCO)}, ${q(CONTA)}, NULL, 'pix_enviado', ${q("2026-11-11T00:00:00.000Z")},
         '2026-11-05', -1000 - i, '[TEST] Pix muitos ' || i, 'TEST MUITAS P ' || i, '[TEST] Pessoa ' || i, NULL, ${q("2026-11-11T00:00:00.000Z")} FROM n`,
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100)
       INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, movement, occurred_at, local_date,
         amount_cents, original_description, establishment_key, counterparty_name, ai_category_id, last_seen_at)
       SELECT 'e2e-pc-e' || i, ${q(LAR)}, '[TEST] ext-e' || i, ${q(BANCO)}, ${q(CONTA)}, NULL, 'pix_recebido', ${q("2026-11-11T00:00:00.000Z")},
         '2026-11-05', 1000 + i, '[TEST] Entrada muitas ' || i, 'TEST MUITAS E ' || i, '[TEST] Remetente ' || i, NULL, ${q("2026-11-11T00:00:00.000Z")} FROM n`,
    ].join(";\n"),
  );
  await abre(page);
  await expect(page.getByRole("radio", { name: /^Cartão \d{3}$/ })).toBeVisible();
  const larguraDaJanela = page.viewportSize()?.width ?? 0;
  for (const rotulo of [/^Todos \d{3}$/, /^Pix \d{3}$/, /^Cartão \d{3}$/, /^Entradas \d{3}$/]) {
    await expect(page.getByRole("radio", { name: rotulo })).toBeVisible();
  }
  const grupo = await page.getByRole("radiogroup", { name: "Filtrar" }).boundingBox();
  expect(grupo).toBeTruthy();
  for (const botao of await page.getByRole("radio").all()) {
    const caixa = await botao.boundingBox();
    expect(caixa).toBeTruthy();
    expect(caixa!.x).toBeGreaterThanOrEqual(grupo!.x - 1);
    expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(grupo!.x + grupo!.width + 1);
  }
  if (larguraDaJanela >= 1200) {
    const lista = await page.getByTestId("lista").boundingBox();
    expect(lista).toBeTruthy();
    expect(grupo!.x + grupo!.width).toBeLessThanOrEqual(lista!.x + 1);
  }
  const semRolagem = await page.evaluate(
    (larg) => document.documentElement.scrollWidth <= larg,
    larguraDaJanela,
  );
  expect(semRolagem).toBe(true);
});

// Rodada 2, notas do desktop: o cartão de progresso não ocupa a largura toda (cerca de 674 px, como o protótipo) e
// alinha com o conteúdo; o texto do cartão da IA cabe em quatro linhas ou menos, em todas as larguras.
test("notas: progresso alinhado com o conteúdo no desktop e texto da IA em até quatro linhas", async ({
  page,
}) => {
  await abre(page);
  const largura = page.viewportSize()?.width ?? 0;
  const texto = await page.getByText("Confira as sugestões abaixo antes de aceitar.").boundingBox();
  expect(texto).toBeTruthy();
  expect(texto!.height).toBeLessThanOrEqual(80);
  if (largura >= 1200) {
    const progresso = await page.getByTestId("progresso").boundingBox();
    const colunaDaEsquerda = await page.getByRole("radiogroup", { name: "Filtrar" }).boundingBox();
    expect(progresso && colunaDaEsquerda).toBeTruthy();
    expect(progresso!.width).toBeLessThanOrEqual(680);
    expect(Math.abs(progresso!.x - colunaDaEsquerda!.x)).toBeLessThanOrEqual(12);
  }
});

// Rodada 2: a visita não se perde ao girar o tablet. Confirma uma linha, gira a janela (paisagem e de volta ao retrato)
// e confere que "Categorizados agora" continua com a confirmação.
test("visita: as confirmações sobrevivem a girar o tablet", async ({ page }) => {
  await abre(page);
  await page
    .getByRole("button", { name: /^Confirmar/ })
    .first()
    .click();
  await expect(page.getByText(/Categorizados agora · 1/)).toBeVisible();
  await page.setViewportSize({ width: 1194, height: 834 });
  await expect(page.getByText(/Categorizados agora · 1/)).toBeVisible();
  await page.setViewportSize({ width: 834, height: 1194 });
  await expect(page.getByText(/Categorizados agora · 1/)).toBeVisible();
});

// Rodada 3, C1: a visita acaba quando a pessoa sai da fila. Confirma uma linha, vai ao Início pelo menu e volta:
// Y é o counts.todos atual (uma linha) e X começa em zero, sem "Categorizados agora" da visita anterior.
test("visita: sair para o Início e voltar começa uma visita nova", async ({ page }) => {
  await abre(page);
  await page
    .getByRole("button", { name: /^Confirmar/ })
    .first()
    .click();
  await expect(page.getByText(/Categorizados agora · 1/)).toBeVisible();
  await page.getByRole("link", { name: "Início" }).first().click();
  await expect(page).toHaveURL(/\/inicio$/);
  // A URL troca antes de a tela trocar. Voltar antes de a fila sair da tela não é sair: a mesma tela continua, com a
  // mesma visita (era a falha da primeira tentativa no CI). Só volta depois que a fila desmontou.
  await expect(page.getByTestId("progresso")).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Para categorizar" })).toBeVisible();
  // A fila carregou quando o filtro mostra a contagem atual (uma linha): só então a visita é conferida.
  await expect(page.getByRole("radio", { name: /^Todos 1$/ })).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("progresso")).toContainText("0 de 1 categorizados");
  await expect(page.getByText(/Categorizados agora/)).toHaveCount(0);
});
