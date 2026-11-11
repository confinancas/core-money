// Categorização pela IA (TASK-0303). Constantes e predicados compartilhados entre o servidor (fila, pipeline e cron)
// e a tela (TASK-0304 e 0403). As SQLs usam a tabela `transactions` com o alias t: quem as junta com outra tabela
// confere se as colunas não ficaram ambíguas.

export const AI_CONFIDENCES = ["pouca", "media", "alta"] as const;
export type AiConfidence = (typeof AI_CONFIDENCES)[number];

// Movimentos que pedem categoria (saída de conta ou cartão). Saída "outro" entra quando o valor é negativo.
export const CATEGORY_MOVEMENTS = [
  "compra",
  "estorno",
  "pix_enviado",
  "ted_enviada",
  "debito",
  "boleto",
] as const;

// Movimentos que podem ser entrada com tipo e renda fixa. Só valem com amount_cents > 0.
export const INCOME_CANDIDATE_MOVEMENTS = ["pix_recebido", "ted_recebida", "outro"] as const;

const lista = (valores: readonly string[]): string => valores.map((valor) => `'${valor}'`).join(", ");

// Quem precisa de categoria (sem olhar category_id, que é o chamador que confere).
export const NEEDS_CATEGORY_SQL = `(t.movement IN (${lista(CATEGORY_MOVEMENTS)}) OR (t.movement = 'outro' AND t.amount_cents < 0))`;

// Quem é entrada a classificar: candidata, com valor positivo e sem income_kind.
export const NEEDS_INCOME_SQL = `(t.movement IN (${lista(INCOME_CANDIDATE_MOVEMENTS)}) AND t.amount_cents > 0 AND t.income_kind IS NULL)`;

export type TransacaoParaPredicado = { movement: string; amount_cents: number; income_kind?: string | null };

export function needsCategory(tx: Pick<TransacaoParaPredicado, "movement" | "amount_cents">): boolean {
  if (CATEGORY_MOVEMENTS.includes(tx.movement as (typeof CATEGORY_MOVEMENTS)[number])) return true;
  return tx.movement === "outro" && tx.amount_cents < 0;
}

export function needsIncome(tx: TransacaoParaPredicado): boolean {
  const candidata = INCOME_CANDIDATE_MOVEMENTS.includes(
    tx.movement as (typeof INCOME_CANDIDATE_MOVEMENTS)[number],
  );
  return candidata && tx.amount_cents > 0 && (tx.income_kind ?? null) === null;
}

// Entrada a classificar pela IA (o mesmo critério de needsIncome, sem olhar income_kind: a fila já o filtrou).
export const ehEntradaParaClassificar = (
  tx: Pick<TransacaoParaPredicado, "movement" | "amount_cents">,
): boolean => needsIncome({ movement: tx.movement, amount_cents: tx.amount_cents, income_kind: null });

const ROTULO_DA_CERTEZA: Record<AiConfidence, string> = {
  pouca: "pouca certeza",
  media: "certeza média",
  alta: "certeza alta",
};

// Texto curto da sugestão para a fila e a tela: "CNPJ de restaurante · certeza alta". Sem certeza, não há sugestão.
export function suggestionText(confidence: AiConfidence | null, reason: string | null): string | null {
  if (confidence === null) return null;
  const rotulo = ROTULO_DA_CERTEZA[confidence];
  return reason === null || reason === "" ? rotulo : `${reason} · ${rotulo}`;
}
