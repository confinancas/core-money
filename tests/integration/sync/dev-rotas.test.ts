import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/worker/app";
import type { Env } from "../../../src/worker/env";
import { callApi, semearPronto } from "../helpers/app";

// Rotas de medição (TASK-0204, R13): DEV_ROUTES só liga com "1", exatamente. Qualquer outro valor responde 404 antes de
// qualquer regra e não grava nada. O controle com "1" prova que a rota existe (sem sessão, 401, e não 404).
const VALORES_QUE_NAO_LIGAM = ["0", "true", "", " 1", "01"] as const;

async function contagens(): Promise<Record<string, number>> {
  const contar = async (tabela: string) =>
    (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).first<{ n: number }>())?.n ?? 0;
  return {
    pluggy_connections: await contar("pluggy_connections"),
    bank_items: await contar("bank_items"),
    sync_runs: await contar("sync_runs"),
  };
}

describe('POST /api/dev/sync-slice: DEV_ROUTES só liga com "1"', () => {
  it.each(VALORES_QUE_NAO_LIGAM)("DEV_ROUTES = %j: responde 404 e não grava nada", async (valor) => {
    await semearPronto(env.DB);
    const antes = await contagens();
    const ambiente = { ...env, DEV_ROUTES: valor } as unknown as Env;

    const resposta = await callApi(createApp(), "POST", "/api/dev/sync-slice", { rows: 200 }, {}, ambiente);

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toMatchObject({ error: "rota_inexistente" });
    expect(await contagens()).toEqual(antes);
  });

  it('controle: com DEV_ROUTES = "1", a rota existe (sem sessão responde 401, não 404)', async () => {
    await semearPronto(env.DB);
    const ambiente = { ...env, DEV_ROUTES: "1" } as unknown as Env;

    const resposta = await callApi(createApp(), "POST", "/api/dev/sync-slice", { rows: 200 }, {}, ambiente);

    expect(resposta.status).toBe(401);
  });
});
