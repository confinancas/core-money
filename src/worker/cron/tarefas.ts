// Tarefas do despachante que são da importação: retomar as execuções paradas (TASK-0204) e atribuir o ciclo às transações
// que ainda não têm (TASK-0801). Cada uma tem a forma de TarefaDoCron, de despachante.ts. O db chega medido (TASK-0109).
import { assignCycleKeys } from "../cycle/calendar";
import type { Db } from "../db/client";
import type { Env } from "../env";
import { enqueueSlice } from "../sync/enqueue";

// Execução aberta sem mensagem há mais de 15 min (heartbeat antigo): reenfileira a fatia atual. O heartbeat é encostado
// antes, para a execução seguinte não reenfileirar de novo.
export const LIMITE_DO_HEARTBEAT_MS = 15 * 60 * 1000;
const EXECUCOES_POR_RODADA = 10;

// As consultas ficam aqui para o teste de plano (EXPLAIN QUERY PLAN) ler o mesmo SQL que o cron roda. O índice parcial
// sync_runs_open_heartbeat_idx só serve a consulta que repete o `finished_at IS NULL` do índice.
export const SQL_PARADAS = `SELECT id, cursor_json FROM sync_runs
  WHERE finished_at IS NULL AND heartbeat_at < ? ORDER BY heartbeat_at LIMIT ?`;

// Lançamentos sem ciclo, do mais novo para o mais antigo. O índice parcial transactions_no_cycle_local_date_idx guarda só
// os que faltam: com todos atribuídos, a consulta não lê a tabela (TASK-0204, R1).
export const SQL_SEM_CICLO = `SELECT id, household_id FROM transactions
  WHERE cycle_key IS NULL AND removed_at IS NULL ORDER BY local_date DESC LIMIT 200`;

export const retomarImportacoes = {
  nome: "retomar-importacoes",
  pesada: false,
  async executar(env: Env, agora: Date, db: Db): Promise<boolean> {
    const agoraIso = agora.toISOString();
    const limite = new Date(agora.getTime() - LIMITE_DO_HEARTBEAT_MS).toISOString();
    const paradas = await db.$client
      .prepare(SQL_PARADAS)
      .bind(limite, EXECUCOES_POR_RODADA)
      .all<{ id: string; cursor_json: string | null }>();
    let retomadas = 0;
    for (const linha of paradas.results ?? []) {
      const seq = linha.cursor_json ? ((JSON.parse(linha.cursor_json) as { seq?: number }).seq ?? 0) : 0;
      const marcou = await db.$client
        .prepare(
          "UPDATE sync_runs SET heartbeat_at = ? WHERE id = ? AND finished_at IS NULL AND heartbeat_at < ?",
        )
        .bind(agoraIso, linha.id, limite)
        .run();
      if (marcou.meta.changes === 0) continue;
      await enqueueSlice(env, { runId: linha.id, seq });
      retomadas += 1;
    }
    return retomadas > 0;
  },
};

// Pesada: atribui o ciclo às transações sem ciclo, em lotes de 200 (TASK-0801).
export const atribuirCiclos = {
  nome: "atribuir-ciclos",
  pesada: true,
  async executar(_env: Env, _agora: Date, db: Db): Promise<boolean> {
    const linhas = await db.$client.prepare(SQL_SEM_CICLO).all<{ id: string; household_id: string }>();
    const porLar = new Map<string, string[]>();
    for (const linha of linhas.results ?? []) {
      porLar.set(linha.household_id, [...(porLar.get(linha.household_id) ?? []), linha.id]);
    }
    for (const [householdId, ids] of porLar) {
      await assignCycleKeys(db, householdId, ids);
    }
    return porLar.size > 0;
  },
};
