// Execuções da importação e da sincronização (sync_runs). O estado fica aqui, não na mensagem da fila.
import type { Db } from "../db/client";
import { CURSOR_INICIAL, type SyncCursor } from "./plan";

export type KindDeExecucao = "historico" | "diaria" | "manual";

export type LinhaDaExecucao = {
  id: string;
  kind: string;
  finished_at: string | null;
  cursor_json: string | null;
  slices_total: number;
  slices_done: number;
  retried: number;
  new_transactions: number;
  bank_item_id: string;
  connection_id: string;
  household_id: string;
  consent_expires_at: string | null;
  institution_name: string;
};

// Abre a execução de um banco. Devolve o id, ou null se o banco já tem uma execução aberta. O INSERT é condicionado
// ao NOT EXISTS, numa única instrução: duas aberturas ao mesmo tempo não criam duas execuções.
export async function startRun(
  db: Db,
  bankItemId: string,
  kind: KindDeExecucao,
  now: string,
): Promise<string | null> {
  const id = crypto.randomUUID();
  const resultado = await db.$client
    .prepare(
      `INSERT INTO sync_runs (id, bank_item_id, kind, started_at, finished_at, status, new_transactions, progress_pct,
         slices_total, slices_done, retried, cursor_json, heartbeat_at)
       SELECT ?, ?, ?, ?, NULL, NULL, 0, 0, 0, 0, 0, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM sync_runs WHERE bank_item_id = ? AND finished_at IS NULL)`,
    )
    .bind(id, bankItemId, kind, now, JSON.stringify(CURSOR_INICIAL), now, bankItemId)
    .run();
  return resultado.meta.changes > 0 ? id : null;
}

export async function lerExecucao(db: Db, runId: string): Promise<LinhaDaExecucao | null> {
  const linha = await db.$client
    .prepare(
      `SELECT r.id, r.kind, r.finished_at, r.cursor_json, r.slices_total, r.slices_done, r.retried,
         r.new_transactions, r.bank_item_id, b.connection_id, c.household_id, b.consent_expires_at,
         b.institution_name
       FROM sync_runs r
       JOIN bank_items b ON b.id = r.bank_item_id
       JOIN pluggy_connections c ON c.id = b.connection_id
       WHERE r.id = ?`,
    )
    .bind(runId)
    .first<LinhaDaExecucao>();
  return linha ?? null;
}

// Grava o cursor novo só se o seq guardado ainda é o esperado. Sem linha alterada, o chamador não enfileira a próxima.
export function saveCursorStmt(
  db: Db,
  entrada: {
    runId: string;
    seqEsperado: number;
    cursor: SyncCursor;
    slicesTotal: number;
    slicesDone: number;
    progressPct: number;
    heartbeatAt: string;
  },
): D1PreparedStatement {
  return db.$client
    .prepare(
      `UPDATE sync_runs SET cursor_json = ?, slices_total = ?, slices_done = ?, progress_pct = ?, heartbeat_at = ?
       WHERE id = ? AND finished_at IS NULL AND json_extract(cursor_json, '$.seq') = ?`,
    )
    .bind(
      JSON.stringify(entrada.cursor),
      entrada.slicesTotal,
      entrada.slicesDone,
      entrada.progressPct,
      entrada.heartbeatAt,
      entrada.runId,
      entrada.seqEsperado,
    );
}

// Marca a repetição: retried = 1 e o heartbeat no futuro (a mensagem está retida até lá; o cron não a reenfileira).
export function marcarRepeticaoStmt(db: Db, runId: string, heartbeatAt: string): D1PreparedStatement {
  return db.$client
    .prepare("UPDATE sync_runs SET retried = 1, heartbeat_at = ? WHERE id = ? AND finished_at IS NULL")
    .bind(heartbeatAt, runId);
}

export type FimDaExecucao = {
  runId: string;
  bankItemId: string;
  status: "ok" | "repetiu" | "instavel" | "erro";
  errorCode: string | null;
  newTransactions: number;
  now: string;
  // Banco fica com o status indicado; null mantém o que está.
  statusDoBanco: "instavel" | "acao_necessaria" | null;
  // Só a conclusão ok ou repetiu grava a última sincronização.
  atualizaUltimaSincronizacao: boolean;
};

// Encerra a execução (uma vez só) e atualiza o banco, no mesmo lote.
export function finishRunStmts(db: Db, fim: FimDaExecucao): D1PreparedStatement[] {
  // Só ok e repetiu chegam a 100%; erro e instável mantêm o percentual que a execução tinha.
  const comandos: D1PreparedStatement[] = [
    db.$client
      .prepare(
        `UPDATE sync_runs SET finished_at = ?, status = ?, error_code = ?, new_transactions = ?,
           progress_pct = CASE WHEN ? IN ('ok', 'repetiu') THEN 100 ELSE progress_pct END
         WHERE id = ? AND finished_at IS NULL`,
      )
      .bind(fim.now, fim.status, fim.errorCode, fim.newTransactions, fim.status, fim.runId),
  ];
  if (fim.statusDoBanco !== null) {
    comandos.push(
      db.$client
        .prepare("UPDATE bank_items SET status = ? WHERE id = ?")
        .bind(fim.statusDoBanco, fim.bankItemId),
    );
  }
  if (fim.atualizaUltimaSincronizacao) {
    comandos.push(
      db.$client.prepare("UPDATE bank_items SET last_sync_at = ? WHERE id = ?").bind(fim.now, fim.bankItemId),
    );
  }
  return comandos;
}
