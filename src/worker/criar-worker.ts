import type { ExportedHandler, MessageBatch } from "@cloudflare/workers-types";
import type { BrandConfig } from "../shared/brand/types";
import { type AppOptions, createApp } from "./app";
import { despachar } from "./cron/despachante";
import type { Env } from "./env";
import type { SyncMessage } from "./sync/plan";
import { handleSyncBatch, type LoteDaFila } from "./sync/queue";
import { flushUsage } from "./usage/flush";
import { meteredScheduled } from "./usage/scheduled";

export type CriarWorkerOptions = {
  marca: BrandConfig;
  versao: string;
  rotasDoApp?: AppOptions["rotasDoApp"];
};

// fetch: o app. queue: a fila da importação (uma fatia por vez). scheduled: o despachante do cron (*/5 * * * *).
// Todo Worker do núcleo (a entrada de dev e os apps finos) mede o próprio uso: cada requisição de /api grava o
// contador do dia em waitUntil (TASK-0109). O flush fica aqui, e não no createApp, para os testes montarem o app sem ele.
// O cron mede o D1 que recebe (meteredScheduled, em waitUntil). A fila mede dentro do handleSyncBatch.
export function criarWorker({ marca, versao, rotasDoApp }: CriarWorkerOptions) {
  const app = createApp({
    marca,
    versao,
    rotasDoApp,
    onMeter: (meter, c) => {
      c.executionCtx.waitUntil(flushUsage(c.env.DB, meter));
    },
  });
  return {
    fetch: app.fetch,
    // A medição da fila fica no handleSyncBatch: cada mensagem tem o próprio medidor e grava o contador do dia (TASK-0109).
    queue(lote: MessageBatch<SyncMessage>, env: Env) {
      return handleSyncBatch(lote as unknown as LoteDaFila, env);
    },
    scheduled: meteredScheduled(async (evento, env, _ctx, db) => {
      await despachar(env, new Date(evento.scheduledTime), db);
    }),
  } satisfies ExportedHandler<Env, SyncMessage>;
}
