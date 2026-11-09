import type { PlannedPercentages, SpendType } from "../../shared/spend-types";
import { apiFetch } from "../lib/api";

// Tipos de gasto (TASK-0802): a tela TiposGasto e a seção de Configurações. Os contratos são os da spec; a regra
// (herança, precedência, cartão) mora no servidor.

export type CategoriaDeTipo = {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  defaultSpendType: SpendType | null;
  effectiveSpendType: SpendType;
  origin: "categoria" | "mae" | "padrao";
};

export type RegraAutomatica = { id: string; kind: "corretora" | "caixinha"; matchValue: string };

export type TiposDeGastoResposta = {
  percentages: PlannedPercentages;
  investmentsPct: number;
  limitPct: number;
  base: { cycleKey: string; label: string; prevIncomeCents: number } | null;
  currentLimit: { cycleKey: string; spendLimitCents: number; pct: number } | null;
  categories: CategoriaDeTipo[];
  automaticRules: RegraAutomatica[];
  recentDestinations: { name: string; bank: string | null }[];
};

const JSON_HEADERS = { "content-type": "application/json" };

export function fetchSpendTypes(): Promise<TiposDeGastoResposta> {
  return apiFetch<TiposDeGastoResposta>("/api/spend-types");
}

// Os percentuais são do lar (PATCH /api/household, TASK-0006): só os seis tipos com coluna.
export function savePercentages(percentages: PlannedPercentages): Promise<unknown> {
  return apiFetch("/api/household", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ percentages }),
  });
}

export function saveCategoryDefaultType(categoriaId: string, tipo: SpendType | null): Promise<unknown> {
  return apiFetch(`/api/categories/${encodeURIComponent(categoriaId)}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ defaultSpendType: tipo }),
  });
}

export function createAutomaticRule(
  kind: RegraAutomatica["kind"],
  matchValue: string,
): Promise<{ rule: RegraAutomatica; applied: number }> {
  return apiFetch("/api/automatic-rules", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ kind, matchValue }),
  });
}

export function deleteAutomaticRule(id: string): Promise<{ reverted: number }> {
  return apiFetch(`/api/automatic-rules/${encodeURIComponent(id)}`, { method: "DELETE" });
}
