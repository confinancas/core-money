import type { ConferenciaDoConsentimento, DetalheDoBancoDto } from "../../shared/bank-item-view";
import { apiEnviar, apiFetch } from "../lib/api";

// Banco conectado (TASK-0206): as chamadas de /api/bank-items. Nenhuma delas leva chave; o corpo vai vazio.
const caminhoDoBanco = (id: string) => `/api/bank-items/${encodeURIComponent(id)}`;

export const buscarBanco = (id: string): Promise<DetalheDoBancoDto> =>
  apiFetch<DetalheDoBancoDto>(caminhoDoBanco(id));

export const conferirConsentimento = (id: string): Promise<ConferenciaDoConsentimento> =>
  apiEnviar<ConferenciaDoConsentimento>(`${caminhoDoBanco(id)}/consent-check`, "POST", {});

export const desconectarBanco = (id: string): Promise<{ disconnectedAt: string }> =>
  apiEnviar<{ disconnectedAt: string }>(`${caminhoDoBanco(id)}/disconnect`, "POST", {});

export const conectarDeNovo = (id: string): Promise<{ runId: string }> =>
  apiEnviar<{ runId: string }>(`${caminhoDoBanco(id)}/reconnect`, "POST", {});

// "Baixar agora" (TASK-0205): só aparece quando a atualização falhou e repetir pode resolver.
export const baixarAgora = (id: string): Promise<{ runId: string }> =>
  apiEnviar<{ runId: string }>(`${caminhoDoBanco(id)}/sync`, "POST", {});
