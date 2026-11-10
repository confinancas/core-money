// Erro de limite diário do D1 (TASK-0109). O texto exato do D1 não tem documentação estável: os padrões ficam
// isolados aqui, para ajuste quando o caso real aparecer.
export const D1_LIMIT_PATTERNS: readonly RegExp[] = [/daily .*limit/i, /exceeded .*limit/i, /quota/i];

// Drizzle embrulha o erro do D1 e guarda a causa original: lê a mensagem de cada um da cadeia (até 4 níveis).
export function isD1DailyLimitError(erro: unknown): boolean {
  let atual: unknown = erro;
  for (let nivel = 0; nivel < 4 && atual !== undefined && atual !== null; nivel++) {
    const mensagem = typeof atual === "object" && "message" in atual ? String(atual.message) : String(atual);
    if (D1_LIMIT_PATTERNS.some((padrao) => padrao.test(mensagem))) return true;
    atual = typeof atual === "object" && "cause" in atual ? atual.cause : undefined;
  }
  return false;
}
