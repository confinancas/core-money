import type { Db } from "../db/client";

// Recebimentos de uma renda fixa (TASK-0902). Cada escrita é uma instrução com a checagem junto do INSERT, para que duas
// requisições ao mesmo tempo não contem duas vezes: o índice único parcial (transaction_id) e o WHERE NOT EXISTS decidem.
// O valor de um recebimento é sempre em reais (o que entrou na conta), também numa renda em dólar.

// Recebimento de uma transação casada com a renda (extrato ou classificação). Insere o recebimento e marca a transação,
// nesta ordem: a marca só entra se a transação ainda não tem renda, e o recebimento só entra se ela não tem outro.
export function addTransactionReceiptStmts(
  db: Db,
  householdId: string,
  recebimento: {
    receiptId: string;
    fixedIncomeId: string;
    cycleKey: string;
    transactionId: string;
    receivedOn: string;
    amountCents: number;
    confirmedBy: string;
    categorizedBy: string;
    agora: string;
  },
): D1PreparedStatement[] {
  const { fixedIncomeId, cycleKey, transactionId } = recebimento;
  const insert = db.$client
    .prepare(
      `INSERT INTO fixed_income_receipts (id, fixed_income_id, cycle_key, transaction_id, amount_cents, received_on,
         fx_rate, fx_date, confirmed_by)
       SELECT ?, ?, ?, ?, ?, ?,
         (SELECT r.fx_rate FROM fixed_income_receipts AS r WHERE r.fixed_income_id = ? AND r.cycle_key = ?
           AND r.fx_rate IS NOT NULL LIMIT 1),
         (SELECT r.fx_date FROM fixed_income_receipts AS r WHERE r.fixed_income_id = ? AND r.cycle_key = ?
           AND r.fx_rate IS NOT NULL LIMIT 1),
         ?
       WHERE EXISTS (SELECT 1 FROM transactions AS t WHERE t.id = ? AND t.household_id = ? AND t.income_kind IS NULL)
         AND NOT EXISTS (SELECT 1 FROM fixed_income_receipts AS x WHERE x.transaction_id = ?)`,
    )
    .bind(
      recebimento.receiptId,
      fixedIncomeId,
      cycleKey,
      transactionId,
      recebimento.amountCents,
      recebimento.receivedOn,
      fixedIncomeId,
      cycleKey,
      fixedIncomeId,
      cycleKey,
      recebimento.confirmedBy,
      transactionId,
      householdId,
      transactionId,
    );
  const marca = db.$client
    .prepare(
      `UPDATE transactions SET income_kind = 'parte_salario', fixed_income_id = ?, categorized_at = ?, categorized_by = ?
       WHERE id = ? AND household_id = ? AND income_kind IS NULL`,
    )
    .bind(fixedIncomeId, recebimento.agora, recebimento.categorizedBy, transactionId, householdId);
  return [insert, marca];
}

// Desfaz um recebimento do extrato: apaga o recebimento e, se a transação ainda é desta renda, devolve a transação à
// fila de classificação (sem renda, sem marca).
export function removeTransactionReceiptStmt(
  db: Db,
  householdId: string,
  fixedIncomeId: string,
  transactionId: string,
): D1PreparedStatement[] {
  return [
    db.$client
      .prepare("DELETE FROM fixed_income_receipts WHERE transaction_id = ? AND fixed_income_id = ?")
      .bind(transactionId, fixedIncomeId),
    db.$client
      .prepare(
        `UPDATE transactions SET income_kind = NULL, fixed_income_id = NULL, categorized_at = NULL, categorized_by = NULL
         WHERE id = ? AND household_id = ? AND fixed_income_id = ? AND income_kind = 'parte_salario'`,
      )
      .bind(transactionId, householdId, fixedIncomeId),
  ];
}

export type ResultadoDoLancamento = "criado" | "ja_confirmada" | "nao_encontrada";

// Recebimento lançado à mão. Numa renda "manual", ou num recebimento de 0,00 ("Ficou tudo em dólar"), não se confirma
// de novo no mesmo ciclo: a checagem e o INSERT são uma instrução só (WHERE NOT EXISTS), e a segunda vez dá 409.
export async function addManualReceipt(
  db: Db,
  householdId: string,
  valores: {
    id: string;
    fixedIncomeId: string;
    cycleKey: string;
    receivedOn: string;
    amountCents: number;
    confirmedBy: string;
  },
): Promise<ResultadoDoLancamento> {
  const { id, fixedIncomeId, cycleKey } = valores;
  const zero = valores.amountCents === 0 ? 1 : 0;
  const resultado = await db.$client
    .prepare(
      `INSERT INTO fixed_income_receipts (id, fixed_income_id, cycle_key, transaction_id, amount_cents, received_on,
         fx_rate, fx_date, confirmed_by)
       SELECT ?, f.id, ?, NULL, ?, ?,
         (SELECT r.fx_rate FROM fixed_income_receipts AS r WHERE r.fixed_income_id = f.id AND r.cycle_key = ?
           AND r.fx_rate IS NOT NULL LIMIT 1),
         (SELECT r.fx_date FROM fixed_income_receipts AS r WHERE r.fixed_income_id = f.id AND r.cycle_key = ?
           AND r.fx_rate IS NOT NULL LIMIT 1),
         ?
       FROM fixed_incomes AS f
       WHERE f.id = ? AND f.household_id = ? AND f.archived_at IS NULL
         AND NOT ((f.arrival = 'manual' OR ? = 1)
           AND EXISTS (SELECT 1 FROM fixed_income_receipts AS e WHERE e.fixed_income_id = f.id AND e.cycle_key = ?))`,
    )
    .bind(
      id,
      cycleKey,
      valores.amountCents,
      valores.receivedOn,
      cycleKey,
      cycleKey,
      valores.confirmedBy,
      fixedIncomeId,
      householdId,
      zero,
      cycleKey,
    )
    .run();
  if ((resultado.meta?.changes ?? 0) === 1) return "criado";
  return "ja_confirmada";
}

export type ResultadoDaRemocao = "removido" | "extrato" | "nao_encontrada";

// Apaga um recebimento lançado à mão, da renda ativa do lar. O do extrato não se apaga por aqui (muda-se pelo Pix).
export async function removeManualReceipt(
  db: Db,
  householdId: string,
  fixedIncomeId: string,
  receiptId: string,
): Promise<ResultadoDaRemocao> {
  const linha = await db.$client
    .prepare(
      `SELECT r.transaction_id AS transaction_id FROM fixed_income_receipts AS r
         JOIN fixed_incomes AS f ON f.id = r.fixed_income_id
       WHERE r.id = ? AND r.fixed_income_id = ? AND f.household_id = ? AND f.archived_at IS NULL`,
    )
    .bind(receiptId, fixedIncomeId, householdId)
    .first<{ transaction_id: string | null }>();
  if (!linha) return "nao_encontrada";
  if (linha.transaction_id !== null) return "extrato";

  const apagada = await db.$client
    .prepare(
      "DELETE FROM fixed_income_receipts WHERE id = ? AND fixed_income_id = ? AND transaction_id IS NULL",
    )
    .bind(receiptId, fixedIncomeId)
    .run();
  return (apagada.meta?.changes ?? 0) === 1 ? "removido" : "nao_encontrada";
}
