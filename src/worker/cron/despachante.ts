// Despachante do cron (TASK-0303). Um Cron Trigger só, a cada 5 minutos (plano gratuito). Cada execução roda as tarefas
// na ordem de prioridade e para na primeira tarefa pesada: a CPU não se mede dentro do Worker, então uma por vez.
// Hoje a única tarefa é a categorização; a importação e a sincronização acrescentam as suas aqui, antes dela.

import { runCategorizationSlice } from "../categorization/cron";
import type { Db } from "../db/client";
import type { Env } from "../env";

export type TarefaDoCron = {
  nome: string;
  pesada: boolean;
  executar: (env: Env, agora: Date, db?: Db) => Promise<unknown>;
};

export const TAREFAS_DO_CRON: readonly TarefaDoCron[] = [
  {
    nome: "categorizacao",
    pesada: true,
    executar: (env, agora, db) => runCategorizationSlice(env, { now: () => agora, db }),
  },
];

// db: o do embrulho de medição de uso (meteredScheduled, TASK-0109); sem ele, cada tarefa mede por conta própria.
export async function despachar(
  env: Env,
  agora: Date,
  db?: Db,
  tarefas: readonly TarefaDoCron[] = TAREFAS_DO_CRON,
): Promise<void> {
  for (const tarefa of tarefas) {
    try {
      await tarefa.executar(env, agora, db);
    } catch (erro) {
      // Só o nome do erro: a mensagem pode trazer pedaços de dado.
      console.error(`cron ${tarefa.nome}: falhou`, erro instanceof Error ? erro.name : "erro");
    }
    if (tarefa.pesada) break;
  }
}
