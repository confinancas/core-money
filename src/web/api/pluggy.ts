import type {
  ConnectionsResponse,
  CreatedConnectionResponse,
  ItemDoPedido,
  PreviewItemsResponse,
} from "../../shared/pluggy-api";
import { apiEnviar, apiFetch } from "../lib/api";

// Contas do Meu Pluggy (TASK-0203): as chamadas de /api/pluggy-connections. As chaves vão no corpo, uma vez, e a
// resposta nunca as traz de volta. Quem chama guarda as chaves só na memória da tela até o passo 3.

export type ParDeChavesDaTela = { clientId: string; clientSecret: string };

export const listarConexoes = (): Promise<ConnectionsResponse> =>
  apiFetch<ConnectionsResponse>("/api/pluggy-connections");

export const testarChaves = (chaves: ParDeChavesDaTela): Promise<{ ok: true }> =>
  apiEnviar<{ ok: true }>("/api/pluggy-connections/test-keys", "POST", chaves);

// Prévia de ids: com as chaves digitadas (conexão nova) ou pelo id da conexão (outro banco da mesma conta).
export function previewBancos(
  origem: { chaves: ParDeChavesDaTela } | { connectionId: string },
  itemIds: string[],
): Promise<PreviewItemsResponse> {
  const corpo =
    "chaves" in origem ? { ...origem.chaves, itemIds } : { connectionId: origem.connectionId, itemIds };
  return apiEnviar<PreviewItemsResponse>("/api/pluggy-connections/preview-items", "POST", corpo);
}

export function criarConexao(dados: {
  label: string;
  chaves: ParDeChavesDaTela;
  items: ItemDoPedido[];
}): Promise<CreatedConnectionResponse> {
  return apiEnviar<CreatedConnectionResponse>("/api/pluggy-connections", "POST", {
    label: dados.label,
    clientId: dados.chaves.clientId,
    clientSecret: dados.chaves.clientSecret,
    items: dados.items,
  });
}

export function adicionarBancos(
  connectionId: string,
  items: ItemDoPedido[],
): Promise<{ bankItems: { id: string; institutionName: string }[] }> {
  return apiEnviar(`/api/pluggy-connections/${encodeURIComponent(connectionId)}/bank-items`, "POST", {
    items,
  });
}

export function trocarChaves(connectionId: string, chaves: ParDeChavesDaTela): Promise<{ ok: true }> {
  return apiEnviar<{ ok: true }>(
    `/api/pluggy-connections/${encodeURIComponent(connectionId)}/keys`,
    "PUT",
    chaves,
  );
}
