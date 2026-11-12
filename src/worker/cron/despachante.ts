// Despachante do cron (TASK-0303, com as tarefas da importação e da sincronização). Um Cron Trigger só, a cada 5 minutos
// (plano gratuito). As tarefas leves rodam sempre. As pesadas: uma por execução. A CPU não se mede dentro do Worker, então
// a rodada das pesadas para na primeira que trabalhou. Quem não tem trabalho cede a vez à seguinte (TASK-0205, N10); o
// ponto de partida gira a cada execução do cron (um passo de cinco minutos), para que as que têm trabalho se revezem.
import { runCategorizationSlice } from "../categorization/cron";
import type { Db } from "../db/client";
import type { Env } from "../env";
import { agendarSincronizacao } from "../sync/daily";
import { atribuirCiclos, retomarImportacoes } from "./tarefas";

export type TarefaDoCron = {
  nome: string;
  pesada: boolean;
  // Devolve se a tarefa trabalhou (a pesada que trabalha encerra a rodada das pesadas).
  executar: (env: Env, agora: Date, db?: Db) => Promise<boolean>;
};

// Ordem de prioridade das leves: retomada da importação, atribuição de ciclos (lê zero linhas sem trabalho) e o
// agendamento da sincronização diária. A categorização é a única pesada.
export const TAREFAS_DO_CRON: readonly TarefaDoCron[] = [
  retomarImportacoes,
  atribuirCiclos,
  agendarSincronizacao,
  {
    nome: "categorizacao",
    pesada: true,
    async executar(env, agora, db) {
      const resultado = await runCategorizationSlice(env, { now: () => agora, db });
      return resultado.lotes > 0;
    },
  },
];

// Passo do giro das pesadas: um passo de cinco minutos, o intervalo do cron.
export const PASSO_DO_CRON_MS = 5 * 60 * 1000;

// db: o do embrulho de medição de uso (meteredScheduled, TASK-0109); sem ele, cada tarefa mede por conta própria.
export async function despachar(
  env: Env,
  agora: Date,
  db?: Db,
  tarefas: readonly TarefaDoCron[] = TAREFAS_DO_CRON,
): Promise<void> {
  for (const tarefa of tarefas.filter((t) => !t.pesada)) {
    await executarSeguro(tarefa, env, agora, db);
  }
  const pesadas = tarefas.filter((t) => t.pesada);
  if (pesadas.length === 0) return;
  const inicio = Math.floor(agora.getTime() / PASSO_DO_CRON_MS) % pesadas.length;
  for (let k = 0; k < pesadas.length; k++) {
    const tarefa = pesadas[(inicio + k) % pesadas.length];
    if (tarefa === undefined) break;
    try {
      const trabalhou = await tarefa.executar(env, agora, db);
      if (trabalhou) break;
    } catch (erro) {
      // Só o nome do erro: a mensagem pode trazer pedaços de dado. A CPU da pesada que falhou já foi gasta: para aqui.
      console.error(`cron ${tarefa.nome}: falhou`, erro instanceof Error ? erro.name : "erro");
      break;
    }
  }
}

async function executarSeguro(tarefa: TarefaDoCron, env: Env, agora: Date, db?: Db): Promise<void> {
  try {
    await tarefa.executar(env, agora, db);
  } catch (erro) {
    console.error(`cron ${tarefa.nome}: falhou`, erro instanceof Error ? erro.name : "erro");
  }
}
