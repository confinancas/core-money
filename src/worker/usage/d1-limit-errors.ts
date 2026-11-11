// Erro de limite diário do D1 (TASK-0109). Só a causa conta: o erro do Drizzle embrulha o do D1 e leva o SQL e os
// parâmetros da consulta, e um parâmetro de texto (um nome, por exemplo) não pode disparar o limite. Os padrões ficam
// aqui, para ajuste quando o caso real aparecer; "exceeded its CPU time limit" e a memória não são limite diário.
export const D1_LIMIT_PATTERNS: readonly RegExp[] = [/daily .*limit/i, /exceeded (the )?daily/i, /quota/i];

// A causa é o erro mais fundo da cadeia (até 4 níveis); sem cadeia, é o próprio erro.
export function causaDoErro(erro: unknown): unknown {
  let atual: unknown = erro;
  for (let nivel = 0; nivel < 4; nivel++) {
    const proximo = typeof atual === "object" && atual !== null && "cause" in atual ? atual.cause : undefined;
    if (proximo === undefined || proximo === null) break;
    atual = proximo;
  }
  return atual;
}

export function isD1DailyLimitError(erro: unknown): boolean {
  const causa = causaDoErro(erro);
  const mensagem =
    typeof causa === "object" && causa !== null && "message" in causa ? String(causa.message) : String(causa);
  return D1_LIMIT_PATTERNS.some((padrao) => padrao.test(mensagem));
}
