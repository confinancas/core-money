// Situação de um banco para "Baixar agora" e para o status (TASK-0205). Função pura: a rota e o status usam a mesma regra.
// Falhou = a última execução terminada do banco ficou instável ou com erro. Dá para repetir = falhou com um erro que uma
// nova tentativa pode resolver (banco instável ou erro inesperado), e não há execução aberta.
export type SituacaoDoBanco = { failed: boolean; canRetry: boolean };

export const ERROS_QUE_REPETIR_RESOLVE = new Set(["banco_instavel", "erro_inesperado"]);

export function situacaoDoBanco(entrada: {
  ultimoStatus: string | null;
  ultimoErro: string | null;
  aberta: boolean;
}): SituacaoDoBanco {
  const failed = entrada.ultimoStatus === "instavel" || entrada.ultimoStatus === "erro";
  const canRetry =
    failed &&
    !entrada.aberta &&
    entrada.ultimoErro !== null &&
    ERROS_QUE_REPETIR_RESOLVE.has(entrada.ultimoErro);
  return { failed, canRetry };
}
