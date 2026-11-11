import { needsCategory, needsIncome } from "../../shared/categorization";
import { COUNTERPARTY_KEY_SQL, chaveVazia, type RuleScope } from "../../shared/rule-match";
import { todayInSaoPaulo } from "../../shared/sao-paulo-date";
import type { Db } from "../db/client";
import { type CandidataDeEntrada, casamentosDoExtrato, type RendaDoExtrato } from "../income/casamento-puro";
import { escritasDosCasamentos, SQL_RENDAS_DO_EXTRATO } from "../income/statement-match";
import { applyRuleToTransactionStmt, type RegraParaAplicar } from "./apply";
import { enqueuePendingStmt, markBackfillStmt } from "./queue";

// Pipeline de regras na importação (TASK-0302). Chamado pelo afterIngest, depois da classificação e do ciclo, só com os
// ids inseridos. No máximo 2 idas ao D1: uma leitura (as linhas, os casamentos e o ciclo anterior, num lote) e uma
// escrita (as regras, a marca do histórico e a fila da categorização, TASK-0303).
// A decisão de fila e de histórico sai das linhas já lidas, com os predicados de src/shared/categorization.ts: a escrita
// só recebe os ids decididos (json_each), e não relê a tabela. Assim o custo não cresce com o lar nem com a regra.
// Escopo remetente fica de fora nesta task (a TASK-0903 o acrescenta). As TASK-0902 e 0903 acrescentam passos aqui.
// O casamento pelo extrato das entradas (TASK-0902) vem antes das regras: a entrada casada não entra em pendentes nem na
// fila, e a leitura das rendas com texto de extrato é uma consulta a mais, sem laço sobre o lote.

export type ResultadoDoPipeline = {
  // Ids que a regra categorizou nesta chamada.
  categorizedByRule: string[];
  // Ids (dos recebidos) que continuam sem categoria e não viraram pagamento de fatura.
  pending: string[];
};

type LinhaDaImportacao = {
  id: string;
  movement: string;
  amount_cents: number;
  card_id: string | null;
  category_id: string | null;
  income_kind: string | null;
  cycle_key: string | null;
  removed_at: string | null;
  description: string;
  received_on: string;
  hidden: number;
};

type CasamentoDeRegra = {
  transaction_id: string;
  card_id: string | null;
  rule_id: string;
  scope: string;
  match_value: string;
  set_custom_name: string | null;
  set_category_id: string | null;
  set_spend_type: string | null;
  set_movement: string | null;
  categoria_ativa: string | null;
};

// Escopo estabelecimento (compras e saídas de cartão e conta) e destinatário (Pix e TED enviados). Cada transação casa
// no máximo com uma regra: o escopo vem do movimento. Só regra ativa, só transação ainda sem categoria.
// A lista de ids entra por json_each como laço de fora (CROSS JOIN): cada transação é buscada pela chave primária e
// cada regra pelo índice rules_active_match. Sem o CROSS JOIN, o planejador usava o índice do lar e lia o lar inteiro
// para cada consulta (custo que cresce com a tabela). Leituras medidas: ~9 por transação, em lar de 400 e de 5.200.
const SQL_CASAMENTOS = `SELECT t.id AS transaction_id, t.card_id AS card_id, r.id AS rule_id, r.scope AS scope,
    r.match_value AS match_value, r.set_custom_name AS set_custom_name, r.set_category_id AS set_category_id,
    r.set_spend_type AS set_spend_type, r.set_movement AS set_movement, c.id AS categoria_ativa
  FROM json_each(?) AS j
  CROSS JOIN transactions AS t ON t.id = j.value AND t.household_id = ? AND t.category_id IS NULL
    AND t.movement IN ('compra', 'estorno', 'debito', 'boleto')
  JOIN rules AS r ON r.household_id = t.household_id AND r.disabled_at IS NULL
    AND r.scope = 'estabelecimento' AND r.match_value = t.establishment_key
  LEFT JOIN categories AS c ON c.id = r.set_category_id AND c.household_id = t.household_id AND c.archived_at IS NULL
  UNION ALL
  SELECT t.id AS transaction_id, t.card_id AS card_id, r.id AS rule_id, r.scope AS scope,
    r.match_value AS match_value, r.set_custom_name AS set_custom_name, r.set_category_id AS set_category_id,
    r.set_spend_type AS set_spend_type, r.set_movement AS set_movement, c.id AS categoria_ativa
  FROM json_each(?) AS j
  CROSS JOIN transactions AS t ON t.id = j.value AND t.household_id = ? AND t.category_id IS NULL
    AND t.movement IN ('pix_enviado', 'ted_enviada')
  JOIN rules AS r ON r.household_id = t.household_id AND r.disabled_at IS NULL
    AND r.scope = 'destinatario' AND r.match_value = ${COUNTERPARTY_KEY_SQL}
  LEFT JOIN categories AS c ON c.id = r.set_category_id AND c.household_id = t.household_id AND c.archived_at IS NULL
`;

// As linhas dos ids recebidos: a chave primária, uma vez. Traz o que a fila e o histórico decidem (movimento, valor,
// tipo de entrada, ciclo e remoção).
const SQL_LINHAS = `SELECT t.id, t.movement, t.amount_cents, t.card_id, t.category_id, t.income_kind, t.cycle_key,
    t.removed_at, t.original_description AS description, t.local_date AS received_on, t.hidden AS hidden
  FROM json_each(?) AS j
  CROSS JOIN transactions AS t ON t.id = j.value AND t.household_id = ?`;

// Entrada que pode casar com uma renda pelo extrato: sem renda, visível, não removida e de entrada (TASK-0902). Lê as
// colunas da própria leitura de linhas, sem outra consulta ao lote.
const MOVIMENTOS_DE_ENTRADA = ["pix_recebido", "ted_recebida", "outro"];
const ehCandidataDeEntrada = (linha: LinhaDaImportacao): boolean =>
  linha.amount_cents > 0 &&
  linha.hidden === 0 &&
  linha.removed_at === null &&
  linha.income_kind === null &&
  MOVIMENTOS_DE_ENTRADA.includes(linha.movement);

// O ciclo anterior ao de hoje (em São Paulo): o último com ends_on antes de hoje. Uma linha, pela chave do lar.
const SQL_CICLO_ANTERIOR = `SELECT c.key AS key FROM cycles AS c WHERE c.household_id = ? AND c.ends_on < ?
  ORDER BY c.starts_on DESC LIMIT 1`;

const PAGAMENTO_DE_FATURA = "pagamento_fatura";

export async function processNewTransactions(
  db: Db,
  householdId: string,
  transactionIds: readonly string[],
  now: string,
): Promise<ResultadoDoPipeline> {
  const ids = [...new Set(transactionIds)];
  if (ids.length === 0) return { categorizedByRule: [], pending: [] };
  const json = JSON.stringify(ids);

  const [linhasLidas, casamentosLidos, cicloLido, rendasLidas] = await db.$client.batch([
    db.$client.prepare(SQL_LINHAS).bind(json, householdId),
    db.$client.prepare(SQL_CASAMENTOS).bind(json, householdId, json, householdId),
    db.$client.prepare(SQL_CICLO_ANTERIOR).bind(householdId, todayInSaoPaulo(now)),
    db.$client.prepare(SQL_RENDAS_DO_EXTRATO).bind(householdId),
  ]);
  const linhas = (linhasLidas?.results ?? []) as LinhaDaImportacao[];
  const casamentos = (casamentosLidos?.results ?? []) as CasamentoDeRegra[];
  const anterior = (cicloLido?.results?.[0] as { key: string } | undefined)?.key ?? null;
  const rendas = ((rendasLidas?.results ?? []) as { id: string; statement_text: string }[]).map(
    (renda): RendaDoExtrato => ({ id: renda.id, statementText: renda.statement_text }),
  );

  // Entradas casadas com uma renda pelo texto do extrato (TASK-0902): recebimento e marca, na escrita deste lote.
  const casadas = casamentosDoExtrato(
    linhas.filter(ehCandidataDeEntrada).map(
      (linha): CandidataDeEntrada => ({
        id: linha.id,
        description: linha.description,
        receivedOn: linha.received_on,
        cycleKey: linha.cycle_key,
        amountCents: linha.amount_cents,
      }),
    ),
    rendas,
  );
  const idsCasados = new Set(casadas.map((casamento) => casamento.transactionId));

  const escritas: D1PreparedStatement[] = escritasDosCasamentos(db, householdId, casadas, now);
  const categorizadas = new Set<string>();
  const viraramPagamento = new Set<string>();
  for (const casamento of casamentos) {
    const categoriaAtiva = casamento.categoria_ativa !== null && casamento.set_category_id !== null;
    const regra: RegraParaAplicar = {
      id: casamento.rule_id,
      scope: casamento.scope as RuleScope,
      matchValue: casamento.match_value,
      setCustomName: casamento.set_custom_name,
      setCategoryId: categoriaAtiva ? casamento.set_category_id : null,
      setSpendType: casamento.set_spend_type,
      setMovement: casamento.set_movement,
    };
    if (chaveVazia(regra.matchValue)) continue;
    const escrita = applyRuleToTransactionStmt(db, {
      householdId,
      transactionId: casamento.transaction_id,
      rule: regra,
      now,
    });
    if (escrita === null) continue;
    escritas.push(escrita);
    if (regra.setCategoryId !== null) categorizadas.add(casamento.transaction_id);
    if (regra.setMovement === PAGAMENTO_DE_FATURA) viraramPagamento.add(casamento.transaction_id);
  }

  const porId = new Map(linhas.map((linha) => [linha.id, linha]));
  const pending: string[] = [];
  const naFila: string[] = [];
  for (const id of ids) {
    const linha = porId.get(id);
    if (!linha || linha.category_id !== null) continue;
    if (linha.movement === PAGAMENTO_DE_FATURA || viraramPagamento.has(id) || categorizadas.has(id)) continue;
    if (idsCasados.has(id)) continue;
    pending.push(id);
    // Fila da categorização (TASK-0303): saída que pede categoria, ou entrada candidata sem tipo. Removida não entra.
    const pedeSugestao =
      linha.removed_at === null &&
      (needsCategory(linha) ||
        needsIncome({
          movement: linha.movement,
          amount_cents: linha.amount_cents,
          income_kind: linha.income_kind,
        }));
    if (pedeSugestao) naFila.push(id);
  }

  // Histórico (TASK-0303): o ciclo mais antigo que o anterior ao de hoje nasce com is_backfill = 1, e não muda depois.
  const historico = linhas
    .filter((linha) => anterior !== null && linha.cycle_key !== null && linha.cycle_key < anterior)
    .map((linha) => linha.id);
  // Fim do lote de escritas: a marca do histórico e a fila, depois das regras (a categoria e o tipo já gravados).
  if (historico.length > 0) escritas.push(markBackfillStmt(db, { householdId, transactionIds: historico }));
  if (naFila.length > 0) escritas.push(enqueuePendingStmt(db, { transactionIds: naFila, now }));
  if (escritas.length > 0) await db.$client.batch(escritas);

  return { categorizedByRule: [...categorizadas], pending };
}
