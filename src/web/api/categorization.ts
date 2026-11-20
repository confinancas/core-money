import type { FiltroDaFila, TipoDaLinha } from "../../shared/para-categorizar";
import { apiFetch } from "../lib/api";

// Fila Para categorizar (TASK-0304). O cliente manda ids e categorias escolhidas; a chave e a regra saem do servidor.

export type SugestaoDaLinha =
  | {
      categoryId: string | null;
      categoryName: string | null;
      categoryColor: string | null;
      confidence: string | null;
      reason: string | null;
    }
  | {
      option: string | null;
      fixedIncomeName: string | null;
      incomeSubtype: string | null;
      confidence: string | null;
      reason: string | null;
    };

export type LinhaDaFila = {
  transactionId: string;
  kind: TipoDaLinha;
  movement: string;
  title: string;
  localDate: string;
  institutionName: string | null;
  amountCents: number;
  suggestion: SugestaoDaLinha | null;
  detailPath: string;
};

export type RespostaDaFila = {
  counts: Record<FiltroDaFila, number>;
  suggested: Record<FiltroDaFila, number>;
  items: LinhaDaFila[];
  nextCursor: string | null;
  hoje: string;
};

export type RespostaDoAceite = {
  accepted: { transactionId: string; categoryId: string | null; ruleId: string | null }[];
  alsoResolved: { transactionId: string; categoryId: string; ruleId: string | null }[];
  skipped: string[];
};

export type RespostaDoDesfazer = { undone: string[]; skipped: string[] };

const JSON_HEADERS = { "content-type": "application/json" };

export function fetchQueue(filtro: FiltroDaFila, cursor?: string): Promise<RespostaDaFila> {
  const params = new URLSearchParams({ filtro });
  if (cursor) params.set("cursor", cursor);
  return apiFetch<RespostaDaFila>(`/api/categorization/queue?${params.toString()}`);
}

export function acceptSuggestions(transactionIds: string[]): Promise<RespostaDoAceite> {
  return apiFetch<RespostaDoAceite>("/api/categorization/accept", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ transactionIds }),
  });
}

export function undoCategorization(
  items: { transactionId: string; categoryId: string }[],
): Promise<RespostaDoDesfazer> {
  return apiFetch<RespostaDoDesfazer>("/api/categorization/undo", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ items }),
  });
}
