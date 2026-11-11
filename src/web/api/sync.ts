import type { SyncStatusResponse } from "../../shared/sync-api";
import { apiFetch } from "../lib/api";

// Estado da importação do histórico (TASK-0204): o passo 4 e a faixa da moldura consultam esta rota.
export const lerEstadoDaImportacao = (): Promise<SyncStatusResponse> =>
  apiFetch<SyncStatusResponse>("/api/sync/status");
