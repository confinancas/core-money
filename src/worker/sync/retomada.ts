// Retomada das importações pausadas pelo teto diário quando o lar liga o plano pago (TASK-0209). A fatia pausada não tem
// mensagem na fila (a fila confirma o "pulou"), então quem retoma envia a próxima fatia: seq = o do cursor, que a pausa
// não anda. O heartbeat vai para agora, e não para a virada, para a execução sair da pausa já.
import type { Db } from "../db/client";
import type { Env } from "../env";
import { enqueueSlice } from "./enqueue";

// Execuções pausadas pelo teto do lar: o heartbeat é a virada (?2, resetsAt), que é o que a fatia grava ao pausar. Uma
// espera de nova tentativa tem outro heartbeat e fica de fora. O lar vem da sessão, pela conexão do banco; uma consulta.
export const SQL_PAUSADAS_DO_LAR = `SELECT r.id, r.cursor_json FROM sync_runs r
  JOIN bank_items b ON b.id = r.bank_item_id
  JOIN pluggy_connections p ON p.id = b.connection_id
  WHERE p.household_id = ?1 AND b.disconnected_at IS NULL AND r.finished_at IS NULL AND r.heartbeat_at = ?2`;

// Põe o heartbeat em agora (?1) só nas execuções que a consulta acima viu pausadas (?2 = ids, ?3 = a virada); a guarda
// repete a condição da consulta.
export const SQL_RETOMA_PAUSADAS = `UPDATE sync_runs SET heartbeat_at = ?1
  WHERE id IN (SELECT value FROM json_each(?2)) AND finished_at IS NULL AND heartbeat_at = ?3`;

export type PausadaDoLar = { id: string; seq: number };

export async function pausadasDoLar(db: Db, householdId: string, viradaIso: string): Promise<PausadaDoLar[]> {
  const linhas = await db.$client
    .prepare(SQL_PAUSADAS_DO_LAR)
    .bind(householdId, viradaIso)
    .all<{ id: string; cursor_json: string | null }>();
  return (linhas.results ?? []).map((linha) => ({
    id: linha.id,
    seq: linha.cursor_json ? ((JSON.parse(linha.cursor_json) as { seq?: number }).seq ?? 0) : 0,
  }));
}

// Envia a próxima fatia de cada execução retomada. Falha da fila não derruba o pedido: o cron (retomar-importacoes)
// reenfileira depois do limite do heartbeat.
export async function enviaRetomadas(env: Env, pausadas: readonly PausadaDoLar[]): Promise<void> {
  for (const pausada of pausadas) {
    try {
      await enqueueSlice(env, { runId: pausada.id, seq: pausada.seq });
    } catch (erro) {
      console.error(`retomada: ${erro instanceof Error ? erro.name : "erro"}`);
    }
  }
}
