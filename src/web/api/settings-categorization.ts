import type { CategorizationStatus } from "../../shared/categorization";
import type { RegraDaLista } from "../../shared/rule-match";
import { ApiError, apiEnviar, apiFetch } from "../lib/api";

// Cliente das telas Configurações › Categorias e IA (TASK-0305). Nada aqui recebe ou mostra a chave da IA: o estado vem
// mascarado de /api/categorization/status.

export type PaginaDeRegras = { total: number; items: RegraDaLista[]; nextCursor: string | null };
export type EscopoDaLista = "todos" | "estabelecimento" | "destinatario" | "remetente";
export type DocumentoDaIA = { text: string; updatedAt: string | null };

export function fetchRules(opcoes: {
  escopo: EscopoDaLista;
  busca: string;
  cursor?: string | null;
}): Promise<PaginaDeRegras> {
  const partes = [`escopo=${opcoes.escopo}`];
  if (opcoes.busca.trim() !== "") partes.push(`busca=${encodeURIComponent(opcoes.busca.trim())}`);
  if (opcoes.cursor) partes.push(`cursor=${encodeURIComponent(opcoes.cursor)}`);
  return apiFetch<PaginaDeRegras>(`/api/rules?${partes.join("&")}`);
}

export function deleteRule(id: string): Promise<unknown> {
  return apiFetch<unknown>(`/api/rules/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function fetchCategorizationStatus(): Promise<CategorizationStatus> {
  return apiFetch<CategorizationStatus>("/api/categorization/status");
}

export function fetchAiDocument(): Promise<DocumentoDaIA> {
  return apiFetch<DocumentoDaIA>("/api/ai-rules-document");
}

export type ResultadoDaGravacao =
  | { ok: true; documento: DocumentoDaIA }
  | { ok: false; conflito: true; atual: DocumentoDaIA };

// PUT do documento. Um 409 devolve a versão salva (current), e o texto que a pessoa digitou fica com quem chamou.
export async function saveAiDocument(
  texto: string,
  baseUpdatedAt: string | null,
): Promise<ResultadoDaGravacao> {
  try {
    const documento = await apiEnviar<DocumentoDaIA>("/api/ai-rules-document", "PUT", {
      text: texto,
      baseUpdatedAt,
    });
    return { ok: true, documento };
  } catch (erro) {
    if (erro instanceof ApiError && erro.status === 409) {
      const atual = erro.corpo?.current as DocumentoDaIA | undefined;
      if (atual) return { ok: false, conflito: true, atual };
      return { ok: false, conflito: true, atual: await fetchAiDocument() };
    }
    throw erro;
  }
}
