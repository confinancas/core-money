// Despachante do cron (TASK-0303, com as tarefas da importação (TASK-0204), a cotação do dólar (TASK-0902) e a
// sincronização diária (TASK-0205)). Um Cron Trigger só, a cada 5 minutos (plano gratuito). As tarefas leves rodam em toda
// execução. As pesadas: uma por execução, porque a CPU não se mede dentro do Worker. Quem não tem trabalho cede a vez à
// seguinte (TASK-0205, N10); o ponto de partida gira a cada execução do cron (um passo de cinco minutos).
import { runCategorizationSlice } from "../categorization/cron";
import type { Db } from "../db/client";
import type { Env } from "../env";
import { fillPendingFxRates } from "../income/fx";
import { agendarSincronizacao } from "../sync/daily";
import { atribuirCiclos, retomarImportacoes } from "./tarefas";

export type TarefaDoCron = {
  nome: string;
  pesada: boolean;
  // A pesada devolve true quando trabalhou (encerra a rodada das pesadas). As leves ignoram o retorno.
  executar: (env: Env, agora: Date, db?: Db) => Promise<unknown>;
};

// Ordem de prioridade: as leves antes (retomada da importação, atribuição de ciclos, cotação do dólar, agendamento da
// sincronização diária) e a categorização, a única pesada.
export const TAREFAS_DO_CRON: readonly TarefaDoCron[] = [
  retomarImportacoes,
  atribuirCiclos,
  {
    // Leve (TASK-0902): busca a cotação do dólar pendente, no máximo 2 chamadas ao Banco Central por execução.
    nome: "cotacao-dolar",
    pesada: false,
    executar: (env, agora, db) =>
      fillPendingFxRates(env, { now: agora, fetch: (...args) => globalThis.fetch(...args), db }),
  },
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
      if (trabalhou === true) break;
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
