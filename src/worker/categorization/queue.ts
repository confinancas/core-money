// Fila da categorização (TASK-0303): o que entra, o que sai e o que o cron lê e grava. Todas as instruções desta fila
// são de categorization/, e só applyAiSuggestionStmt (apply.ts) grava category_id a partir da sugestão. Os textos de
// SQL usam o alias t da tabela transactions e o alias q da categorization_queue.
import type { Db } from "../db/client";
import { applyAiSuggestionStmt } from "./apply";
import type { LinhaParaIA } from "./context";
import type { GravavelDaIA } from "./output-schema";

// Depois de três tentativas, a transação sai da fila e fica sem sugestão (aparece como "Sem sugestão" na fila do casal).
export const TENTATIVAS_MAXIMAS = 3;

// Entra na fila o que é saída sem categoria e precisa de uma, ou entrada candidata sem tipo. As ocultas entram (a fila
// do casal as esconde). Removidas não entram. O INSERT OR IGNORE não reabre uma linha que já está na fila.
// Os ids já vêm decididos pelo pipeline (que aplica NEEDS_CATEGORY_SQL / NEEDS_INCOME_SQL e os mesmos predicados sobre
// as linhas já lidas): a escrita só insere, sem reler a tabela. NEEDS_* ficam em shared/categorization.ts, para a
// migração e os testes que conferem a decisão contra o SQL.
export function enqueuePendingStmt(
  db: Db,
  entrada: { transactionIds: readonly string[]; now: string },
): D1PreparedStatement {
  return db.$client
    .prepare(
      `INSERT OR IGNORE INTO categorization_queue (transaction_id, enqueued_at, attempts, last_error)
        SELECT value, ?, 0, NULL FROM json_each(?)`,
    )
    .bind(entrada.now, JSON.stringify(entrada.transactionIds));
}

// Histórico (TASK-0303): a transação de um ciclo mais antigo que o anterior ao de hoje nasce com is_backfill = 1, e a
// marca não muda depois. O anterior é o último ciclo com ends_on antes de hoje (em São Paulo).
// O pipeline decide quais ids são do histórico (ciclo anterior ao de hoje), com o ciclo lido na mesma ida.
export function markBackfillStmt(
  db: Db,
  entrada: { householdId: string; transactionIds: readonly string[] },
): D1PreparedStatement {
  return db.$client
    .prepare(
      `UPDATE transactions SET is_backfill = 1
        WHERE household_id = ? AND id IN (SELECT value FROM json_each(?))`,
    )
    .bind(entrada.householdId, JSON.stringify(entrada.transactionIds));
}

// Linha da fila com os campos da transação, lida pelo cron.
export type LinhaDaFila = LinhaParaIA & { household_id: string; is_backfill: number; attempts: number };

const SELECT_DA_FILA = `SELECT t.id AS id, t.household_id AS household_id, t.movement AS movement,
    t.amount_cents AS amount_cents, t.card_id AS card_id, t.original_description AS original_description,
    t.custom_name AS custom_name, t.counterparty_name AS counterparty_name,
    t.counterparty_doc_masked AS counterparty_doc_masked, t.installment_number AS installment_number,
    t.installment_total AS installment_total, t.local_date AS local_date, t.is_backfill AS is_backfill,
    q.attempts AS attempts
  FROM categorization_queue AS q
  JOIN transactions AS t ON t.id = q.transaction_id
  WHERE t.removed_at IS NULL AND t.category_id IS NULL AND t.income_kind IS NULL`;

// Tira da fila o que já foi resolvido (casal, regra), o que sumiu e o que foi removido.
export function limparFilaStmt(db: Db): D1PreparedStatement {
  return db.$client.prepare(
    `DELETE FROM categorization_queue WHERE transaction_id IN (
        SELECT q.transaction_id FROM categorization_queue AS q LEFT JOIN transactions AS t ON t.id = q.transaction_id
        WHERE t.id IS NULL OR t.removed_at IS NOT NULL OR t.category_id IS NOT NULL OR t.income_kind IS NOT NULL)`,
  );
}

// Os itens da primeira tentativa, os mais recentes primeiro (até o limite da execução).
export function frescosStmt(db: Db, limite: number): D1PreparedStatement {
  return db.$client
    .prepare(`${SELECT_DA_FILA} AND q.attempts = 0 ORDER BY t.local_date DESC, t.id LIMIT ?`)
    .bind(limite);
}

// Um item em retentativa (1 ou 2 tentativas), o mais antigo na fila. Vai sozinho num lote.
export function retentativaStmt(db: Db): D1PreparedStatement {
  return db.$client.prepare(
    `${SELECT_DA_FILA} AND q.attempts BETWEEN 1 AND 2 ORDER BY q.enqueued_at LIMIT 1`,
  );
}

const LIMPEZA_DAS_TENTATIVAS = `DELETE FROM categorization_queue WHERE attempts >= ${TENTATIVAS_MAXIMAS}
  AND transaction_id IN (SELECT value FROM json_each(?))`;

// Resposta recebida: grava ai_* (nulos quando não há sugestão), aplica no histórico quando cabe, e sai da fila. Quem não
// veio na resposta ganha uma tentativa com sem_resposta e fica na fila. No fim, quem chegou a 3 tentativas sai.
export function gravarRespostaStmts(
  db: Db,
  entrada: {
    householdId: string;
    now: string;
    respondidos: readonly { id: string; gravavel: GravavelDaIA }[];
    semResposta: readonly string[];
    idsDoLote: readonly string[];
  },
): D1PreparedStatement[] {
  const comandos: D1PreparedStatement[] = [];
  for (const item of entrada.respondidos) {
    const g = item.gravavel;
    comandos.push(
      db.$client
        .prepare(
          `UPDATE transactions AS t SET ai_category_id = ?, ai_income_kind = ?, ai_income_subtype = ?,
            ai_fixed_income_id = ?, ai_confidence = ?, ai_reason = ?
          WHERE t.id = ? AND t.household_id = ?`,
        )
        .bind(
          g.aiCategoryId,
          g.aiIncomeKind,
          g.aiIncomeSubtype,
          g.aiFixedIncomeId,
          g.aiConfidence,
          g.aiReason,
          item.id,
          entrada.householdId,
        ),
    );
    if (g.aiCategoryId !== null) {
      comandos.push(
        applyAiSuggestionStmt(db, {
          householdId: entrada.householdId,
          transactionId: item.id,
          now: entrada.now,
        }),
      );
    }
    comandos.push(
      db.$client.prepare("DELETE FROM categorization_queue WHERE transaction_id = ?").bind(item.id),
    );
  }
  for (const id of entrada.semResposta) {
    comandos.push(
      db.$client
        .prepare(
          "UPDATE categorization_queue SET attempts = attempts + 1, last_error = 'sem_resposta' WHERE transaction_id = ?",
        )
        .bind(id),
    );
  }
  comandos.push(db.$client.prepare(LIMPEZA_DAS_TENTATIVAS).bind(JSON.stringify(entrada.idsDoLote)));
  return comandos;
}

// Falha do lote. Recusa, corte, saída inválida e requisição inválida contam uma tentativa. API fora e chave inválida só
// gravam o motivo: a execução para e a próxima tenta de novo, sem perder nada.
export function registrarFalhaStmts(
  db: Db,
  entrada: { ids: readonly string[]; erro: string; contaTentativa: boolean },
): D1PreparedStatement[] {
  const sets = entrada.contaTentativa ? "attempts = attempts + 1, last_error = ?" : "last_error = ?";
  return [
    db.$client
      .prepare(
        `UPDATE categorization_queue SET ${sets} WHERE transaction_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(entrada.erro, JSON.stringify(entrada.ids)),
    db.$client.prepare(LIMPEZA_DAS_TENTATIVAS).bind(JSON.stringify(entrada.ids)),
  ];
}
