// Despachante do cron (forma combinada com a TASK-0303). Um Cron Trigger só, a cada 5 minutos (plano gratuito). Cada
// execução roda as tarefas na ordem de prioridade: as leves sempre; das pesadas, só até a primeira que trabalhou, porque a
// CPU não se mede dentro do Worker e uma pesada por vez cabe no limite. Importação e sincronização vêm antes da categorização.
import type { Env } from "../env";
import { atribuirCiclos, retomarImportacoes } from "./tarefas";

export type TarefaDoCron = {
  nome: string;
  pesada: boolean;
  // Devolve verdadeiro quando a tarefa trabalhou. Uma pesada que trabalhou encerra as pesadas desta execução.
  executar: (env: Env, agora: Date) => Promise<unknown>;
};

// Ordem de prioridade. A categorização (TASK-0303) acrescenta a sua depois destas.
export const TAREFAS_DO_CRON: readonly TarefaDoCron[] = [retomarImportacoes, atribuirCiclos];

// Devolve os nomes das tarefas que trabalharam. Falha de uma tarefa não para as outras; só o nome do erro vai para o log,
// porque a mensagem pode trazer pedaços de dado.
export async function despachar(
  env: Env,
  agora: Date,
  tarefas: readonly TarefaDoCron[] = TAREFAS_DO_CRON,
): Promise<string[]> {
  const trabalharam: string[] = [];
  let pesadaJaTrabalhou = false;
  for (const tarefa of tarefas) {
    if (tarefa.pesada && pesadaJaTrabalhou) continue;
    try {
      const trabalhou = Boolean(await tarefa.executar(env, agora));
      if (trabalhou) {
        trabalharam.push(tarefa.nome);
        if (tarefa.pesada) pesadaJaTrabalhou = true;
      }
    } catch (erro) {
      console.error(`cron ${tarefa.nome}: falhou`, erro instanceof Error ? erro.name : "erro");
    }
  }
  return trabalharam;
}
