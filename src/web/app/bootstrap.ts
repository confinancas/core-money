import type { HealthResponse } from "../../shared/api";
import { apiFetch } from "../lib/api";

// Uma verificação da partida: devolve a rota para onde ir, ou null para seguir. Lança se a verificação falhar.
export type StartCheck = () => Promise<string | null>;

async function checkApi(): Promise<string | null> {
  await apiFetch<HealthResponse>("/api/health");
  return null;
}

// As TASK-0102 e TASK-0104 acrescentam as verificações delas antes do /inicio.
export const START_CHECKS: StartCheck[] = [checkApi];

export async function resolveStartRoute(): Promise<string> {
  for (const verificar of START_CHECKS) {
    const rota = await verificar();
    if (rota !== null) return rota;
  }
  return "/inicio";
}
