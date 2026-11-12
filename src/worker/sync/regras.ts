// Regras puras da sincronização diária e do sumiço (TASK-0205). Sem D1 e sem rede: o teste de unidade importa daqui, e o
// tsconfig de unidade não tem os tipos do D1 (CLAUDE.md, tipos do Worker no teste de unidade).

// São Paulo não tem horário de verão desde 2019: a meia-noite local é 03:00 UTC.
export const INICIO_DO_DIA_EM_SAO_PAULO = (hoje: string): string => `${hoje}T03:00:00.000Z`;

// Agenda quando não rodou hoje e não há execução aberta. Quatro combinações, uma resposta.
export function shouldSchedule(ranToday: boolean, open: boolean): boolean {
  return !ranToday && !open;
}

export const LIMITE_DO_SUMICO_EM_PERCENTUAL = 30;
export const MINIMO_DE_SUMICOS_PARA_CONFERIR = 5;

export type DecisaoDeSumico = { marcar: boolean; conferir: boolean };

// As guardas: lidas é o número de linhas que a leitura da janela devolveu (todas as páginas).
export function decidirSumicos(entrada: {
  lidas: number;
  locais: number;
  candidatas: number;
}): DecisaoDeSumico {
  if (entrada.lidas === 0 || entrada.candidatas === 0) return { marcar: false, conferir: false };
  const grande =
    entrada.candidatas >= MINIMO_DE_SUMICOS_PARA_CONFERIR &&
    entrada.candidatas * 100 > entrada.locais * LIMITE_DO_SUMICO_EM_PERCENTUAL;
  return grande ? { marcar: false, conferir: true } : { marcar: true, conferir: false };
}
