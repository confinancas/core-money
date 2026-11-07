import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { Hono } from "hono";
import type { AppEnv } from "../../../src/worker/env";

// Chama a API pelo app montado com createApp(), com o D1 de teste (sem SELF).
export async function callApi(
  app: Hono<AppEnv>,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const ctx = createExecutionContext();
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const resposta = await app.fetch(new Request(`http://matrimoney.test${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return resposta;
}
