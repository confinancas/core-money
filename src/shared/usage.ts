// Aviso de uso do plano gratuito da Cloudflare (TASK-0109, ADR-008). Os limites, as faixas e as contas são os mesmos
// no Worker (GET /api/usage) e no app. Dia UTC: os limites zeram às 00:00 UTC (21h em Brasília).

// Limites diários, exceto o tamanho (total do banco). 500 MB = 524.288.000 bytes.
export const FREE_LIMITS = {
  requests: 100_000,
  rows_read: 5_000_000,
  rows_written: 100_000,
  size_bytes: 524_288_000,
} as const;

export type ResourceId = keyof typeof FREE_LIMITS;
export type UsageBand = "normal" | "atencao" | "critico";

export const RESOURCE_LABELS: Record<ResourceId, string> = {
  requests: "Requisições",
  rows_read: "Leituras do banco",
  rows_written: "Escritas do banco",
  size_bytes: "Tamanho do banco",
};

// Faixas: 70% (atenção) e 90% (crítico) de qualquer recurso.
export const BAND_ATENCAO_PCT = 70;
export const BAND_CRITICO_PCT = 90;

// Piso de used × 100 ÷ limit: 69,9% vira 69, e a faixa de 70% só aparece em 70 inteiro.
export function usagePct(used: number, limit: number): number {
  return Math.floor((used * 100) / limit);
}

// Pela maior porcentagem dos recursos: 90 ou mais é crítico; 70 ou mais, atenção; o resto, normal.
export function usageBand(pct: number): UsageBand {
  if (pct >= BAND_CRITICO_PCT) return "critico";
  if (pct >= BAND_ATENCAO_PCT) return "atencao";
  return "normal";
}

// Próxima 00:00 UTC depois de `now` (quando os limites diários zeram), em ISO.
export function resetsAt(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

// O dia de uso: AAAA-MM-DD em UTC.
export function usageDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export type UsageResource = {
  id: ResourceId;
  used: number;
  limit: number;
  pct: number;
  estimated?: true;
};

export type UsageResponse = {
  day: string;
  paidPlan: boolean;
  band: UsageBand;
  resetsAt: string;
  resources: UsageResource[];
};

// Monta um recurso com a porcentagem já calculada. Só leituras do banco são estimativas (rows_read por raw()).
export function recurso(id: ResourceId, used: number): UsageResource {
  const limit = FREE_LIMITS[id];
  const pct = usagePct(used, limit);
  return id === "rows_read" ? { id, used, limit, pct, estimated: true } : { id, used, limit, pct };
}

// Faixa do conjunto: o plano pago não tem faixa; o resto segue a maior porcentagem.
export function bandaDoUso(recursos: readonly UsageResource[], paidPlan: boolean): UsageBand {
  if (paidPlan) return "normal";
  const maior = Math.max(0, ...recursos.map((item) => item.pct));
  return usageBand(maior);
}

// Número com milhar com ponto: 1234567 vira "1.234.567".
export function formataMilhar(valor: number): string {
  return String(Math.trunc(valor)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Tamanho em MB com uma casa decimal e vírgula: 168000 bytes vira "0,2 MB".
export function formataMegabytes(bytes: number): string {
  const mb = Math.round((bytes / 1_048_576) * 10) / 10;
  return `${String(mb).replace(".", ",")} MB`;
}
