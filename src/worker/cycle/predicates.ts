// Predicados de "conta nos cálculos" e "é gasto" (TASK-0801). Este arquivo é o único lugar desses predicados:
// TASK-0401, 0802, 0804 e 1001 importam daqui. As strings SQL usam o alias t da tabela transactions.
// O espelho em TypeScript (countsInCalculations, isCycleOutflow, isSpentInLimit) é o mesmo predicado, linha a linha.

export const COUNTS_SQL = "t.hidden = 0 AND t.removed_at IS NULL";

// Saídas que contam no ciclo, de todos os tipos de gasto. Entradas, pagamento de fatura, transferência interna e
// rendimento ficam de fora. O estorno abate, e por isso entra pelo movement, qualquer que seja o sinal.
const SAIDAS_DO_CICLO = ["compra", "pix_enviado", "ted_enviada", "debito", "boleto", "outro"] as const;
const TIPOS_FORA_DO_LIMITE = ["metas", "investimentos"] as const;

const listaSql = (valores: readonly string[]): string => valores.map((valor) => `'${valor}'`).join(", ");

export const CYCLE_OUTFLOW_SQL = `(${COUNTS_SQL}) AND ((t.amount_cents < 0 AND t.movement IN (${listaSql(SAIDAS_DO_CICLO)})) OR t.movement = 'estorno')`;

// O gasto do anel: Metas e Investimentos são dinheiro guardado. Tipo nulo conta como prazeres.
export const SPENT_IN_LIMIT_SQL = `(${CYCLE_OUTFLOW_SQL}) AND COALESCE(t.spend_type, 'prazeres') NOT IN (${listaSql(TIPOS_FORA_DO_LIMITE)})`;

export type LinhaDeGasto = {
  movement: string;
  amount_cents: number;
  hidden: number;
  removed_at: string | null;
  spend_type: string | null;
};

const SAIDAS = new Set<string>(SAIDAS_DO_CICLO);
const FORA_DO_LIMITE = new Set<string>(TIPOS_FORA_DO_LIMITE);

export function countsInCalculations(linha: LinhaDeGasto): boolean {
  return linha.hidden === 0 && linha.removed_at === null;
}

export function isCycleOutflow(linha: LinhaDeGasto): boolean {
  if (!countsInCalculations(linha)) return false;
  return (linha.amount_cents < 0 && SAIDAS.has(linha.movement)) || linha.movement === "estorno";
}

export function isSpentInLimit(linha: LinhaDeGasto): boolean {
  return isCycleOutflow(linha) && !FORA_DO_LIMITE.has(linha.spend_type ?? "prazeres");
}
