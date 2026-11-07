import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

// Convenção de erro da API: { error, message?, fields? }, com o código em snake_case.
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message?: string,
  extra?: { fields?: Record<string, string> },
) {
  return c.json(
    {
      error: code,
      ...(message !== undefined ? { message } : {}),
      ...(extra?.fields !== undefined ? { fields: extra.fields } : {}),
    },
    status,
  );
}
