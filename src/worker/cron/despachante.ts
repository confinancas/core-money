// Despachante do cron (forma combinada com a TASK-0303). Um Cron Trigger só, a cada 5 minutos (plano gratuito). Cada
// execução roda as tarefas na ordem de prioridade: as leves sempre; das pesadas, só até a primeira que trabalhou ou falhou,
// porque a CPU não se mede dentro do Worker e uma pesada por vez cabe no limite (a que falha já gastou a CPU dela). A
// importação e a sincronização vêm antes da categorização. O db chega medido pelo meteredScheduled (TASK-0109).
import type { Db } from "../db/client";
import type { Env } from "../env";
import { atribuirCiclos, retomarImportacoes } from "./tarefas";

export type TarefaDoCron = {
  nome: string;
  pesada: boolean;
  // Devolve verdadeiro quando a tarefa trabalhou. Uma pesada que trabalhou ou falhou encerra as pesadas desta execução.
  executar: (env: Env, agora: Date, db: Db) => Promise<unknown>;
};

// Ordem de prioridade. A categorização (TASK-0303) acrescenta a sua depois destas.
export const TAREFAS_DO_CRON: readonly TarefaDoCron[] = [retomarImportacoes, atribuirCiclos];

// Devolve os nomes das tarefas que trabalharam. Falha de uma tarefa não para as outras; só o nome do erro vai para o log,
// porque a mensagem pode trazer pedaços de dado.
export async function despachar(
  env: Env,
  agora: Date,
  db: Db,
  tarefas: readonly TarefaDoCron[] = TAREFAS_DO_CRON,
): Promise<string[]> {
  const trabalharam: string[] = [];
  let pesadaEncerrou = false;
  for (const tarefa of tarefas) {
    if (tarefa.pesada && pesadaEncerrou) continue;
    try {
      const trabalhou = Boolean(await tarefa.executar(env, agora, db));
      if (trabalhou) trabalharam.push(tarefa.nome);
      if (tarefa.pesada && trabalhou) pesadaEncerrou = true;
    } catch (erro) {
      console.error(`cron ${tarefa.nome}: falhou`, erro instanceof Error ? erro.name : "erro");
      if (tarefa.pesada) pesadaEncerrou = true;
    }
  }
  return trabalharam;
}
