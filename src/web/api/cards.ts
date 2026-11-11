import {
  type RespostaDeCartao,
  RespostaDeCartaoSchema,
  type RespostaDeCartoes,
  RespostaDeCartoesSchema,
} from "../../shared/api/cards";
import { apiFetch } from "../lib/api";

// Cartões (TASK-0402): as duas leituras da API. A resposta é conferida com o schema compartilhado, então um contrato
// quebrado vira erro na tela (o estado de erro), e não um valor torto.

export function fetchCards(): Promise<RespostaDeCartoes> {
  return apiFetch<unknown>("/api/cards").then((corpo) => RespostaDeCartoesSchema.parse(corpo));
}

export function fetchCard(cardId: string): Promise<RespostaDeCartao> {
  return apiFetch<unknown>(`/api/cards/${encodeURIComponent(cardId)}`).then((corpo) =>
    RespostaDeCartaoSchema.parse(corpo),
  );
}
