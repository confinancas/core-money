import { todayInSaoPaulo } from "../../shared/sao-paulo-date";
import type { Db } from "../db/client";
import { type Casamento, casamentosDoExtrato, casaRendaPeloExtrato } from "./casamento-puro";
import { addTransactionReceiptStmts, removeTransactionReceiptStmt } from "./receipts";

// Casamento de entradas com as rendas pelo texto do extrato (TASK-0902). Só rendas ativas em "automático" ou "em partes"
// com texto. Casa quando o texto da renda aparece no texto do extrato (sem acento e sem caixa). Mais de uma casando: vence
// o texto mais longo; empate, nenhuma (a entrada fica para classificar).

// Consultas do pipeline e do recasamento. A lista de ids entra por json_each, como laço de fora (CROSS JOIN).
export const SQL_RENDAS_DO_EXTRATO = `SELECT id, statement_text FROM fixed_incomes
  WHERE household_id = ? AND archived_at IS NULL AND arrival IN ('auto', 'partes') AND statement_text IS NOT NULL`;

// Passo do pipeline: as escritas de cada casamento (recebimento e marca), com o id novo do recebimento.
export function escritasDosCasamentos(
  db: Db,
  householdId: string,
  casamentos: readonly Casamento[],
  agora: string,
): D1PreparedStatement[] {
  return casamentos.flatMap((casamento) =>
    addTransactionReceiptStmts(db, householdId, {
      receiptId: crypto.randomUUID(),
      fixedIncomeId: casamento.fixedIncomeId,
      cycleKey: casamento.cycleKey,
      transactionId: casamento.transactionId,
      receivedOn: casamento.receivedOn,
      amountCents: casamento.amountCents,
      confirmedBy: "extrato",
      categorizedBy: "regra",
      agora,
    }),
  );
}

const SQL_CICLOS = "SELECT key, starts_on, ends_on FROM cycles WHERE household_id = ? ORDER BY starts_on";
const SQL_EXTRATO_DA_RENDA = `SELECT r.transaction_id AS transaction_id, r.cycle_key AS cycle_key,
    t.original_description AS description, t.local_date AS received_on, t.amount_cents AS amount_cents
  FROM fixed_income_receipts AS r
  JOIN transactions AS t ON t.id = r.transaction_id AND t.household_id = ?
  WHERE r.fixed_income_id = ? AND r.transaction_id IS NOT NULL`;
// Só o que pode mudar de renda: sem renda, ainda, nos últimos 120 dias (o ciclo atual e o anterior cabem nisso).
const SQL_NAO_CLASSIFICADAS = `SELECT id, original_description AS description, local_date AS received_on, cycle_key,
    amount_cents FROM transactions
  WHERE household_id = ? AND hidden = 0 AND removed_at IS NULL AND income_kind IS NULL AND amount_cents > 0
    AND movement IN ('pix_recebido', 'ted_recebida', 'outro') AND local_date >= date(?, '-120 days')`;

type LinhaDeCiclo = { key: string; starts_on: string; ends_on: string };
type LinhaDoRecebimento = {
  transaction_id: string;
  cycle_key: string;
  description: string;
  received_on: string;
  amount_cents: number;
};
type LinhaDeCandidata = {
  id: string;
  description: string;
  received_on: string;
  cycle_key: string | null;
  amount_cents: number;
};

// Recasamento de uma renda (salvar texto ou forma, ou excluir): só o ciclo atual e o anterior. O extrato dessa renda
// que não casa mais volta à fila, e as entradas sem renda desses ciclos são recasadas. Uma leitura e uma escrita.
export async function rematchFixedIncome(
  db: Db,
  householdId: string,
  fixedIncomeId: string,
  agora: Date,
): Promise<void> {
  const hoje = todayInSaoPaulo(agora);
  const [ciclosLidos, rendasLidas, extratoLido, candidatasLidas] = await db.$client.batch([
    db.$client.prepare(SQL_CICLOS).bind(householdId),
    db.$client.prepare(SQL_RENDAS_DO_EXTRATO).bind(householdId),
    db.$client.prepare(SQL_EXTRATO_DA_RENDA).bind(householdId, fixedIncomeId),
    db.$client.prepare(SQL_NAO_CLASSIFICADAS).bind(householdId, hoje),
  ]);

  const ciclos = (ciclosLidos?.results ?? []) as LinhaDeCiclo[];
  const atual = ciclos.find((ciclo) => ciclo.starts_on <= hoje && hoje <= ciclo.ends_on);
  if (!atual) return;
  const posicao = ciclos.indexOf(atual);
  const anterior = posicao > 0 ? ciclos[posicao - 1] : undefined;
  const chaves = new Set<string>([atual.key, ...(anterior ? [anterior.key] : [])]);

  const rendas = ((rendasLidas?.results ?? []) as { id: string; statement_text: string }[]).map((renda) => ({
    id: renda.id,
    statementText: renda.statement_text,
  }));

  // Os recebimentos desta renda nos dois ciclos: se o texto ainda casa com ela, ficam; senão, voltam à fila.
  const doExtrato = ((extratoLido?.results ?? []) as LinhaDoRecebimento[]).filter((linha) =>
    chaves.has(linha.cycle_key),
  );
  const voltam = doExtrato.filter(
    (linha) => casaRendaPeloExtrato(linha.description, rendas) !== fixedIncomeId,
  );

  const escritas: D1PreparedStatement[] = [];
  for (const linha of voltam) {
    escritas.push(...removeTransactionReceiptStmt(db, householdId, fixedIncomeId, linha.transaction_id));
  }

  // Candidatas: as sem renda dos dois ciclos, mais as que acabaram de voltar à fila.
  const candidatas = [
    ...((candidatasLidas?.results ?? []) as LinhaDeCandidata[]).filter(
      (linha) => linha.cycle_key !== null && chaves.has(linha.cycle_key),
    ),
    ...voltam.map((linha) => ({
      id: linha.transaction_id,
      description: linha.description,
      received_on: linha.received_on,
      cycle_key: linha.cycle_key,
      amount_cents: linha.amount_cents,
    })),
  ];
  const casamentos = casamentosDoExtrato(
    candidatas.map((linha) => ({
      id: linha.id,
      description: linha.description,
      receivedOn: linha.received_on,
      cycleKey: linha.cycle_key,
      amountCents: linha.amount_cents,
    })),
    rendas,
  );
  escritas.push(...escritasDosCasamentos(db, householdId, casamentos, agora.toISOString()));

  if (escritas.length > 0) await db.$client.batch(escritas);
}
