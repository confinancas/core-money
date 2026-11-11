// Despachante do cron (*/5 * * * *). Roda as tarefas leves e, das pesadas, só a primeira que tiver trabalho: o cron tem
// 10 ms de CPU. Importação e sincronização rodam na fila (sync/queue.ts), não aqui.
import { assignCycleKeys } from "../cycle/calendar";
import { createDb } from "../db/client";
import { newMeter } from "../db/metered-d1";
import type { Env } from "../env";
import { enqueueSlice } from "../sync/enqueue";
import { type ContextoDoCron, executarCron, registrarTarefa, type TarefaDoCron } from "./registro";

export type { ContextoDoCron };
export type TarefaDeCron = TarefaDoCron<Env>;

export const CRON_TASKS: TarefaDeCron[] = [];

// Registra uma tarefa do cron (cada task que a traz chama isto no próprio módulo, e o registro mantém a ordem).
export function registerCronTask(tarefa: TarefaDeCron): void {
  registrarTarefa(CRON_TASKS, tarefa);
}

// Execução agendada: devolve os nomes das tarefas que trabalharam.
export function runScheduled(env: Env, agora: Date): Promise<string[]> {
  return executarCron(CRON_TASKS, env, agora);
}

// Execução aberta sem mensagem há mais de 15 min (heartbeat antigo e sem repetição marcada para depois): reenfileira a
// fatia atual. O heartbeat é encostado antes, para que a execução seguinte não reenfileire de novo.
export const LIMITE_DO_HEARTBEAT_MS = 15 * 60 * 1000;
const EXECUCOES_POR_RODADA = 10;

const retomarImportacoes: TarefaDeCron = {
  name: "retomar-importacoes",
  heavy: false,
  async run(env, ctx) {
    const db = createDb(env.DB, newMeter());
    const agora = ctx.agora.toISOString();
    const limite = new Date(ctx.agora.getTime() - LIMITE_DO_HEARTBEAT_MS).toISOString();
    const paradas = await db.$client
      .prepare(
        `SELECT id, cursor_json FROM sync_runs
         WHERE finished_at IS NULL AND heartbeat_at < ? ORDER BY heartbeat_at LIMIT ?`,
      )
      .bind(limite, EXECUCOES_POR_RODADA)
      .all<{ id: string; cursor_json: string | null }>();
    let retomadas = 0;
    for (const linha of paradas.results ?? []) {
      const seq = linha.cursor_json ? ((JSON.parse(linha.cursor_json) as { seq?: number }).seq ?? 0) : 0;
      const marcou = await db.$client
        .prepare(
          "UPDATE sync_runs SET heartbeat_at = ? WHERE id = ? AND finished_at IS NULL AND heartbeat_at < ?",
        )
        .bind(agora, linha.id, limite)
        .run();
      if (marcou.meta.changes === 0) continue;
      await enqueueSlice(env, { runId: linha.id, seq });
      retomadas += 1;
    }
    return retomadas > 0;
  },
};

// Tarefa pesada: assigna o ciclo às transações que ainda não têm, em lotes de 200 (TASK-0801, item 8 da TASK-0801).
const atribuirCiclos: TarefaDeCron = {
  name: "atribuir-ciclos",
  heavy: true,
  async run(env) {
    const db = createDb(env.DB, newMeter());
    const linhas = await db.$client
      .prepare(
        `SELECT id, household_id FROM transactions WHERE cycle_key IS NULL AND removed_at IS NULL
         ORDER BY local_date DESC LIMIT 200`,
      )
      .all<{ id: string; household_id: string }>();
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

registerCronTask(retomarImportacoes);
registerCronTask(atribuirCiclos);
