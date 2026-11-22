import { expect, type Page, test } from "@playwright/test";
import { addDays, standardCycle } from "../../src/shared/cycle";
import { todayInSaoPaulo } from "../../src/shared/sao-paulo-date";
import { consultaSql, executaSql } from "./helpers/db";
import { LAR_DA_INSTALACAO_PRONTA, semeiaSessaoDaInstalacaoPronta, signUpAndSignIn } from "./helpers/sessao";
import { semearInstalacaoPronta } from "./helpers/setup";

// Pix enviado (TASK-0404), contra o Worker real da instalação pronta, nas três larguras dos projetos do Playwright
// (celular 390, tablet 834 e desktop 1440). Dados [TEST] com o prefixo e2e-px-. Cenário 1 (Pix sozinho), os textos, o
// pagamento de cartão, o seletor de categoria em modo fila, a fila de 3 itens (Pix, compra, Pix) até Para categorizar,
// o Lembrar (desabilitado sem categoria; com iguais, cenário 13) e a chave de nome desligada ao abrir a edição.

const LAR = LAR_DA_INSTALACAO_PRONTA;
const CONEXAO = "e2e-px-conexao";
const BANCO = "e2e-px-banco";
const CONTA = "e2e-px-conta";
const CARTAO = "e2e-px-cartao";
const CATEGORIA = "e2e-px-categoria";
const NOME_DA_CATEGORIA = "[TEST] Serviços E2E PX";
const MOTIVO_DO_ISOLAMENTO = "e2e-px";

const q = (valor: string | number | null): string =>
  valor === null ? "NULL" : typeof valor === "number" ? String(valor) : `'${valor.replace(/'/g, "''")}'`;

function ciclo() {
  const hoje = todayInSaoPaulo();
  const atual = standardCycle(hoje, 11);
  return { hoje, atual };
}

// Um Pix enviado da conta, sem categoria (vai para a fila). Quem recebeu tem banco e chave, para as linhas aparecerem.
function pix(id: string, valor: number, nome: string, dia: string): string {
  const { atual } = ciclo();
  const agora = new Date().toISOString();
  return `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, bill_id, movement, occurred_at, local_date, amount_cents, original_description, establishment_key, counterparty_name, counterparty_doc_masked, counterparty_bank, pix_key_masked, cycle_key, spend_type, spend_type_source, last_seen_at) VALUES (${q(id)}, ${q(LAR)}, ${q(`e2e-px-ext-${id}`)}, ${q(BANCO)}, ${q(CONTA)}, NULL, NULL, 'pix_enviado', ${q(`${dia}T17:32:00.000Z`)}, ${q(dia)}, ${q(valor)}, ${q(`PIX ENVIADO ${nome}`)}, NULL, ${q(nome)}, ${q("•••.456.789-••")}, ${q("Banco do Brasil")}, ${q("Celular (11) 9••••-4821")}, ${q(atual.key)}, 'prazeres', 'padrao', ${q(agora)})`;
}

// Uma compra no cartão, sem categoria (a fila tem compras de cartão).
function compra(id: string, valor: number, dia: string): string {
  const { atual } = ciclo();
  const agora = new Date().toISOString();
  return `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, bill_id, movement, occurred_at, local_date, amount_cents, original_description, establishment_key, cycle_key, last_seen_at) VALUES (${q(id)}, ${q(LAR)}, ${q(`e2e-px-ext-${id}`)}, ${q(BANCO)}, NULL, ${q(CARTAO)}, NULL, 'compra', ${q(`${dia}T17:32:00.000Z`)}, ${q(dia)}, ${q(valor)}, '[TEST] E2E PX LOJA', 'E2E PX LOJA', ${q(atual.key)}, ${q(agora)})`;
}

// A instância pronta é um lar só, e a fila conta as linhas pendentes de todas as specs. Esconde o que não é desta spec
// (com o motivo e2e-px) e devolve no fim, para não mexer no estado dos outros (CLAUDE.md: E2E que muda o estado).
function isolaFila(): string {
  return `UPDATE transactions SET hidden = 1, hidden_reason = ${q(MOTIVO_DO_ISOLAMENTO)} WHERE household_id = ${q(LAR)} AND hidden = 0 AND id NOT LIKE 'e2e-px-%'`;
}

function liberaFila(): void {
  executaSql(
    "pronta",
    `UPDATE transactions SET hidden = 0, hidden_reason = NULL WHERE hidden_reason = ${q(MOTIVO_DO_ISOLAMENTO)}`,
  );
}

function limpaDaSpec(): string[] {
  return [
    `DELETE FROM transactions WHERE id LIKE 'e2e-px-%'`,
    `DELETE FROM rules WHERE household_id = ${q(LAR)} AND (match_value LIKE 'E2E PX%' OR match_value IN ('[TEST] JOAO P SILVA|•••.456.789-••', '[TEST] NU PAGAMENTOS|•••.456.789-••', '[TEST] DIARISTA|•••.456.789-••'))`,
  ];
}

// Estado de cada teste: banco, conta, cartão, categoria e ciclo de teste, a fila isolada e as linhas dadas.
function preparar(linhas: string[]): void {
  const { atual } = ciclo();
  const agora = new Date().toISOString();
  executaSql(
    "pronta",
    [
      ...limpaDaSpec(),
      isolaFila(),
      `INSERT OR IGNORE INTO pluggy_connections (id, household_id, label, created_at) VALUES (${q(CONEXAO)}, ${q(LAR)}, '[TEST] Conexão E2E pix', ${q(agora)})`,
      `INSERT OR IGNORE INTO bank_items (id, connection_id, institution_name, institution_color, created_at) VALUES (${q(BANCO)}, ${q(CONEXAO)}, '[TEST] Banco E2E Pix', '#1E9E63', ${q(agora)})`,
      `UPDATE bank_items SET disconnected_at = NULL WHERE id = ${q(BANCO)}`,
      `INSERT OR REPLACE INTO accounts (id, bank_item_id, kind, name, balance_cents, overdraft_used_cents, balance_at) VALUES (${q(CONTA)}, ${q(BANCO)}, 'corrente', '[TEST] Conta E2E pix', 0, 0, ${q(agora)})`,
      `INSERT OR IGNORE INTO cards (id, bank_item_id, last4, name) VALUES (${q(CARTAO)}, ${q(BANCO)}, '7788', '[TEST] Cartão E2E pix')`,
      `INSERT OR IGNORE INTO categories (id, household_id, name, color, parent_id, default_spend_type, ai_hint, sort, archived_at) VALUES (${q(CATEGORIA)}, ${q(LAR)}, ${q(NOME_DA_CATEGORIA)}, '#1B84F2', NULL, NULL, NULL, 0, NULL)`,
      `INSERT OR REPLACE INTO cycles (household_id, key, starts_on, ends_on) VALUES (${q(LAR)}, ${q(atual.key)}, ${q(atual.startsOn)}, ${q(atual.endsOn)})`,
      ...linhas,
    ].join("; "),
  );
}

// Os três Pix de sempre: JOAO (hoje), NU PAGAMENTOS (ontem) e DIARISTA (anteontem).
function tresPix(): string[] {
  const { hoje } = ciclo();
  return [
    pix("e2e-px-1", -15000, "[TEST] JOAO P SILVA", hoje),
    pix("e2e-px-2", -2870, "[TEST] NU PAGAMENTOS", addDays(hoje, -1)),
    pix("e2e-px-3", -8000, "[TEST] DIARISTA", addDays(hoje, -2)),
  ];
}

// Cada executaSql sobe o wrangler (3 a 5 s): as specs de vários passos pedem mais tempo, como o Meu Pluggy.
test.setTimeout(120_000);

test.beforeAll(() => {
  semearInstalacaoPronta();
  semeiaSessaoDaInstalacaoPronta();
});

test.beforeEach(async ({ page }) => {
  await signUpAndSignIn(page);
});

// Devolve o que a spec escondeu e apaga o que ela criou, mesmo quando o teste falha.
test.afterEach(() => {
  liberaFila();
});

test.afterAll(() => {
  executaSql(
    "pronta",
    [
      ...limpaDaSpec(),
      `DELETE FROM categories WHERE id = ${q(CATEGORIA)}`,
      `DELETE FROM cards WHERE id = ${q(CARTAO)}`,
      `DELETE FROM accounts WHERE id = ${q(CONTA)}`,
      `DELETE FROM bank_items WHERE id = ${q(BANCO)}`,
      `DELETE FROM pluggy_connections WHERE id = ${q(CONEXAO)}`,
    ].join("; "),
  );
});

// Espera a tela nova (título que só o Pix tem) antes de afirmar, para não achar elementos da tela anterior.
async function esperaPix(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Pix enviado" })).toBeVisible();
}

async function esperaCompra(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: "Compra" })).toBeVisible();
}

const caminho = (page: Page): string => new URL(page.url()).pathname;
const busca = (page: Page): string => new URL(page.url()).search;

// Abre o seletor pelo cartão da categoria, escolhe a categoria de teste e salva.
async function escolheACategoria(page: Page): Promise<void> {
  await page.getByRole("link", { name: /Sem categoria · revisar/ }).click();
  await expect.poll(() => caminho(page)).toBe("/categorias/escolher");
  await page.getByRole("radio", { name: new RegExp(NOME_DA_CATEGORIA.replace(/[[\]]/g, "\\$&")) }).click();
  await page.getByRole("button", { name: "Salvar categoria" }).click();
}

const chaveDeLembrar = (page: Page) => page.getByRole("switch", { name: /^Lembrar para os próximos Pix/ });
const botaoDaFila = (page: Page) => page.getByRole("button", { name: /Salvar e ir para o próximo/ });

test("cenário 1: Pix sozinho mostra o título, quem recebeu e o botão Salvar", async ({ page }) => {
  preparar(tresPix());
  await page.goto("/pix/e2e-px-1");
  await esperaPix(page);
  await expect(page.getByText("[TEST] JOAO P SILVA").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar" })).toBeVisible();
});

test("textos do Pix: pílula, avatar, 'saiu do', caixa de guardado, linhas do banco e o Ocultar", async ({
  page,
}) => {
  preparar(tresPix());
  await page.goto("/pix/e2e-px-1");
  await esperaPix(page);
  await expect(page.getByText("PIX", { exact: true })).toBeVisible();
  // Iniciais de "[TEST] JOAO P SILVA": a primeira letra da primeira palavra e da última ("[" e "S"). "JS" é provado na unidade.
  await expect(page.getByText("[S", { exact: true })).toBeVisible();
  await expect(page.getByText(/saiu do \[TEST\] Banco E2E Pix/)).toBeVisible();
  await expect(page.getByText("Pix não diz o que foi.", { exact: false })).toBeVisible();
  await expect(page.getByText("Dinheiro guardado · só Pix e TED", { exact: true })).toBeVisible();
  await expect(page.getByText("Banco do Brasil", { exact: true })).toBeVisible();
  await expect(page.getByText("Celular (11) 9••••-4821", { exact: true })).toBeVisible();
  await expect(page.getByText("Conta no ciclo", { exact: true })).toBeVisible();
  await expect(page.getByText(/ · \d{2}\/\d{2} – \d{2}\/\d{2}$/)).toBeVisible();
  await expect(page.getByText("PIX ENVIADO [TEST] JOAO P SILVA", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Para Pix feito por outra pessoa ou em nome dela. Continua no extrato, mas sai dos totais, gráficos e insights.",
      { exact: true },
    ),
  ).toBeVisible();
});

test("ligar e desligar 'É pagamento de cartão' muda o texto e volta ao gasto", async ({ page }) => {
  preparar(tresPix());
  await page.goto("/pix/e2e-px-2");
  await esperaPix(page);
  await page.getByRole("switch", { name: "É pagamento de cartão" }).click();
  await expect(page.getByText("Pagamento de cartão · não conta como gasto")).toBeVisible();
  // Ligado, a categoria e as chaves somem, e a frase dos próximos usa o destinatário.
  await expect(page.getByText("Categoria", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText(/Os próximos para \[TEST\] NU PAGAMENTOS entram assim sozinhos\./),
  ).toBeVisible();
  await page.getByRole("switch", { name: "É pagamento de cartão" }).click();
  await expect(page.getByText("Pagamento de cartão · não conta como gasto")).toHaveCount(0);
});

test("Lembrar sem categoria: chave desligada e desabilitada, com o texto de escolher a categoria", async ({
  page,
}) => {
  preparar(tresPix());
  await page.goto("/pix/e2e-px-1");
  await esperaPix(page);
  await expect(chaveDeLembrar(page)).toBeDisabled();
  await expect(chaveDeLembrar(page)).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("Escolha a categoria para poder lembrar.")).toBeVisible();
});

test("nome nos próximos Pix: a chave abre desligada, também depois de ligar e cancelar", async ({ page }) => {
  preparar(tresPix());
  await page.goto("/pix/e2e-px-1");
  await esperaPix(page);
  await page.getByRole("button", { name: "Renomear" }).click();
  await expect(page.getByPlaceholder("Ex.: Pedreiro da varanda")).toBeVisible();
  const chave = page.getByRole("switch", {
    name: "Usar este nome nos próximos Pix para [TEST] JOAO P SILVA",
  });
  await expect(chave).toHaveAttribute("aria-checked", "false");
  await chave.click();
  await expect(chave).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.getByRole("button", { name: "Renomear" }).click();
  await expect(
    page.getByRole("switch", { name: "Usar este nome nos próximos Pix para [TEST] JOAO P SILVA" }),
  ).toHaveAttribute("aria-checked", "false");
});

test("modo fila: escolher a categoria volta ao Pix em fila, com o Lembrar ligado e o botão da fila", async ({
  page,
}) => {
  preparar(tresPix());
  await page.goto("/pix/e2e-px-1?fila=1");
  await esperaPix(page);
  await expect(page.getByText("1 de 3 para categorizar")).toBeVisible();
  await expect(botaoDaFila(page)).toContainText("faltam 2");

  await escolheACategoria(page);

  // A volta é a tela do Pix com a busca (?fila=1), e não a Compra.
  await expect.poll(() => caminho(page)).toBe("/pix/e2e-px-1");
  expect(busca(page)).toBe("?fila=1");
  await esperaPix(page);
  await expect(page.getByText(NOME_DA_CATEGORIA, { exact: true })).toBeVisible();
  await expect(chaveDeLembrar(page)).toHaveAttribute("aria-checked", "true");
  await expect(botaoDaFila(page)).toBeVisible();
  // Categorizado, o item saiu da fila: faltam os outros dois.
  await expect(botaoDaFila(page)).toContainText("faltam 2");
});

test("fila de 3 itens (Pix, compra, Pix) percorrida pelo botão até voltar a Para categorizar", async ({
  page,
}) => {
  const { hoje } = ciclo();
  preparar([
    pix("e2e-px-f1", -15000, "[TEST] JOAO P SILVA", hoje),
    compra("e2e-px-f2", -4500, addDays(hoje, -1)),
    pix("e2e-px-f3", -8000, "[TEST] DIARISTA", addDays(hoje, -2)),
  ]);

  await page.goto("/pix/e2e-px-f1?fila=1");
  await esperaPix(page);
  await expect(page.getByText("1 de 3 para categorizar")).toBeVisible();
  await escolheACategoria(page);
  await expect.poll(() => caminho(page)).toBe("/pix/e2e-px-f1");
  await esperaPix(page);

  // Primeiro Pix categorizado: o botão leva à compra, a próxima da fila relida.
  await botaoDaFila(page).click();
  await expect.poll(() => caminho(page)).toBe("/compras/e2e-px-f2");
  expect(busca(page)).toBe("?fila=1");
  await esperaCompra(page);
  await expect(page.getByText("1 de 2 para categorizar")).toBeVisible();
  await escolheACategoria(page);
  await expect.poll(() => caminho(page)).toBe("/compras/e2e-px-f2");
  expect(busca(page)).toBe("?fila=1");
  await esperaCompra(page);
  await expect(page.getByText(NOME_DA_CATEGORIA, { exact: true })).toBeVisible();

  await botaoDaFila(page).click();
  await expect.poll(() => caminho(page)).toBe("/pix/e2e-px-f3");
  await esperaPix(page);
  await expect(page.getByText("1 de 1 para categorizar")).toBeVisible();
  await page.getByRole("button", { name: "Salvar e voltar para a fila" }).click();
  await expect.poll(() => caminho(page)).toBe("/para-categorizar");
});

test("N1: Pix sem contraparte e com categoria, em fila, salva e vai ao próximo", async ({ page }) => {
  const { hoje, atual } = ciclo();
  const agora = new Date().toISOString();
  // Sem nome nem documento: o cartão do Lembrar não aparece, e o Salvar não pode pedir regra.
  const semContraparte = `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, bill_id, movement, occurred_at, local_date, amount_cents, original_description, establishment_key, counterparty_name, counterparty_doc_masked, cycle_key, spend_type, spend_type_source, last_seen_at) VALUES ('e2e-px-n1', ${q(LAR)}, 'e2e-px-ext-n1', ${q(BANCO)}, ${q(CONTA)}, NULL, NULL, 'pix_enviado', ${q(`${hoje}T17:32:00.000Z`)}, ${q(hoje)}, -5000, 'TRANSF SEM NOME', NULL, NULL, NULL, ${q(atual.key)}, 'prazeres', 'padrao', ${q(agora)})`;
  preparar([semContraparte, pix("e2e-px-n2", -8000, "[TEST] DIARISTA", addDays(hoje, -1))]);

  await page.goto("/pix/e2e-px-n1?fila=1");
  await esperaPix(page);
  await escolheACategoria(page);
  await expect.poll(() => caminho(page)).toBe("/pix/e2e-px-n1");
  await esperaPix(page);
  await expect(page.getByText(NOME_DA_CATEGORIA, { exact: true })).toBeVisible();
  await expect(chaveDeLembrar(page)).toHaveCount(0);

  await botaoDaFila(page).click();
  await expect.poll(() => caminho(page)).toBe("/pix/e2e-px-n2");
  expect(busca(page)).toBe("?fila=1");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("cenário 13: Lembrar ligado na fila tira os Pix iguais, e o próximo item mostra '1 de 2'", async ({
  page,
}) => {
  const { hoje } = ciclo();
  preparar([
    pix("e2e-px-j1", -15000, "[TEST] JOAO P SILVA", hoje),
    pix("e2e-px-j2", -3000, "[TEST] JOAO P SILVA", addDays(hoje, -1)),
    compra("e2e-px-c1", -4500, addDays(hoje, -2)),
    pix("e2e-px-j3", -2000, "[TEST] JOAO P SILVA", addDays(hoje, -3)),
    pix("e2e-px-d1", -8000, "[TEST] DIARISTA", addDays(hoje, -4)),
  ]);

  await page.goto("/pix/e2e-px-j1?fila=1");
  await esperaPix(page);
  await expect(page.getByText("1 de 5 para categorizar")).toBeVisible();
  await escolheACategoria(page);
  await expect.poll(() => caminho(page)).toBe("/pix/e2e-px-j1");
  await esperaPix(page);
  await expect(chaveDeLembrar(page)).toHaveAttribute("aria-checked", "true");

  // Salvar e ir para o próximo: a regra sai (POST /api/rules) e os dois Pix iguais saem da fila junto.
  await botaoDaFila(page).click();
  await expect.poll(() => caminho(page)).toBe("/compras/e2e-px-c1");
  await esperaCompra(page);
  await expect(page.getByText("1 de 2 para categorizar")).toBeVisible();
  await expect
    .poll(() => JSON.stringify(consultaPendentes()))
    .toBe(JSON.stringify(["e2e-px-c1", "e2e-px-d1"]));
});

// Os ids da spec que seguem pendentes (sem categoria), do mais novo para o mais antigo.
function consultaPendentes(): string[] {
  return consultaSql(
    "pronta",
    "SELECT id FROM transactions WHERE id LIKE 'e2e-px-%' AND category_id IS NULL AND categorized_at IS NULL ORDER BY local_date DESC, id DESC",
  ).map((linha) => String(linha.id));
}

// Capturas da janela (TASK-0404): só quando MM_CAPTURAS_0404 aponta uma pasta. Sem fullPage, na largura do projeto.
const PASTA_DAS_CAPTURAS = process.env.MM_CAPTURAS_0404;
test("captura da janela", async ({ page }) => {
  test.skip(!PASTA_DAS_CAPTURAS, "sem MM_CAPTURAS_0404");
  const { hoje } = ciclo();
  preparar([...tresPix(), compra("e2e-px-c9", -4500, addDays(hoje, -3))]);
  const largura = page.viewportSize()?.width ?? 0;
  const tira = (nome: string) => page.screenshot({ path: `${PASTA_DAS_CAPTURAS}/${nome}-${largura}.png` });
  await page.goto("/pix/e2e-px-1?fila=1");
  await esperaPix(page);
  await expect(page.getByText("[TEST] JOAO P SILVA").first()).toBeVisible();
  await expect(page.getByText("1 de 4 para categorizar")).toBeVisible();
  await tira("pix-fila");

  await page.getByRole("switch", { name: "É pagamento de cartão" }).click();
  await expect(page.getByText("Pagamento de cartão · não conta como gasto")).toBeVisible();
  await tira("pix-pagamento-ligado");

  await page.goto("/compras/e2e-px-c9?fila=1");
  await esperaCompra(page);
  await expect(page.getByText(/\d de \d para categorizar/)).toBeVisible();
  await tira("compra-fila");
});
