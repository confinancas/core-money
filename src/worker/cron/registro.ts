// Registro e execução das tarefas do cron, sem tipos do Worker (testável em unidade). O despachante real está em
// dispatch.ts e usa estas funções com o Env da Cloudflare.

// Ordem combinada entre as tasks que registram tarefas: leves primeiro, com a cotação logo depois da categorização
// (rodam juntas), e o resumo do mês por último. Nome fora desta lista entra no fim, na ordem de registro.
export const ORDEM_DO_CRON = [
  "retomar-importacoes",
  "agendar-sincronizacao",
  "fotografia-do-ciclo",
  "geradores-de-notificacao",
  "atribuir-ciclos",
  "categorizacao",
  "cotacao-do-dolar",
  "resumo-do-mes",
] as const;

export type ContextoDoCron = { agora: Date };

// Devolve true se a tarefa trabalhou. Uma pesada que trabalhou encerra a rodada das pesadas.
export type TarefaDoCron<Env> = {
  name: string;
  heavy: boolean;
  run(env: Env, ctx: ContextoDoCron): Promise<boolean>;
};

const posicao = (nome: string): number => {
  const indice = (ORDEM_DO_CRON as readonly string[]).indexOf(nome);
  return indice === -1 ? ORDEM_DO_CRON.length : indice;
};

// Registra uma tarefa mantendo a lista na ordem combinada. Nome repetido é erro.
export function registrarTarefa<Env>(lista: TarefaDoCron<Env>[], tarefa: TarefaDoCron<Env>): void {
  if (lista.some((existente) => existente.name === tarefa.name)) {
    throw new Error(`tarefa do cron já registrada: ${tarefa.name}`);
  }
  lista.push(tarefa);
  lista.sort((a, b) => posicao(a.name) - posicao(b.name));
}

// Leves sempre, na ordem. Pesadas só até a primeira que trabalhou. Falha de uma tarefa não para as outras; só o nome
// da tarefa e o tipo do erro vão para o log.
export async function executarCron<Env>(
  lista: readonly TarefaDoCron<Env>[],
  env: Env,
  agora: Date,
  registrarErro: (mensagem: string) => void = (mensagem) => console.error(mensagem),
): Promise<string[]> {
  const trabalharam: string[] = [];
  let pesadaJaTrabalhou = false;
  for (const tarefa of lista) {
    if (tarefa.heavy && pesadaJaTrabalhou) continue;
    try {
      const trabalhou = await tarefa.run(env, { agora });
      if (trabalhou) {
        trabalharam.push(tarefa.name);
        if (tarefa.heavy) pesadaJaTrabalhou = true;
      }
    } catch (erro) {
      registrarErro(`cron ${tarefa.name}: ${erro instanceof Error ? erro.name : "erro"}`);
    }
  }
  return trabalharam;
}
