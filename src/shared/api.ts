export type ApiErrorBody = { error: string; message?: string; fields?: Record<string, string> };

export function isApiErrorBody(x: unknown): x is ApiErrorBody {
  return typeof x === "object" && x !== null && typeof (x as { error?: unknown }).error === "string";
}

export type HealthResponse = { ok: true; version: string; at: string };
