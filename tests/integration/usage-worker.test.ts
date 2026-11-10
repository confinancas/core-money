import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import dadosDaMarca from "../../dev/marca.json";
import type { BrandConfig } from "../../src/shared/brand/types";
import { usageDay } from "../../src/shared/usage";
import { criarWorker } from "../../src/worker/criar-worker";
import { COOKIE_DO_TITULAR, criaLarDeDuas } from "./helpers/aparelhos";
import { semearPronto } from "./helpers/app";

// O Worker de produção (criarWorker, usado por src/worker/index.ts e pelos apps finos) mede o próprio uso: cada
// requisição de /api grava o contador do dia em waitUntil (TASK-0109). Este teste passa pelo fetch do Worker de verdade.
beforeEach(async () => {
  await semearPronto(env.DB);
});

describe("Worker de produção: o contador do dia", () => {
  it("uma requisição de /api pelo fetch do Worker grava 1 requisição no dia UTC", async () => {
    await criaLarDeDuas();
    const worker = criarWorker({ marca: dadosDaMarca as BrandConfig, versao: "teste" });
    const ctx = createExecutionContext();

    const resposta = await worker.fetch(
      new Request("http://matrimoney.test/api/usage", { headers: { cookie: COOKIE_DO_TITULAR } }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(resposta.status).toBe(200);
    const linha = await env.DB.prepare("SELECT requests, rows_read FROM usage_daily WHERE day = ?")
      .bind(usageDay(new Date()))
      .first<{ requests: number; rows_read: number }>();
    expect(linha?.requests).toBe(1);
    expect(linha?.rows_read).toBeGreaterThan(0);
  });
});
