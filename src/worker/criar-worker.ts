import type { ExportedHandler, MessageBatch } from "@cloudflare/workers-types";
import type { BrandConfig } from "../shared/brand/types";
import { type AppOptions, createApp } from "./app";
import { despachar } from "./cron/despachante";
import type { Env } from "./env";
import type { SyncMessage } from "./sync/plan";
import { handleSyncBatch, type LoteDaFila } from "./sync/queue";
import { flushUsage } from "./usage/flush";

export type CriarWorkerOptions = {
  marca: BrandConfig;
  versao: string;
  rotasDoApp?: AppOptions["rotasDoApp"];
};

// fetch: o app. queue: a fila da importação (uma fatia por vez). scheduled: o despachante do cron (*/5 * * * *).
// Todo Worker do núcleo (a entrada de dev e os apps finos) mede o próprio uso: cada requisição de /api grava o
// contador do dia em waitUntil (TASK-0109). O flush fica aqui, e não no createApp, para os testes montarem o app sem ele.
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
    queue(lote: MessageBatch<SyncMessage>, env: Env) {
      return handleSyncBatch(lote as unknown as LoteDaFila, env);
    },
    scheduled(evento: ScheduledController, env: Env, ctx: ExecutionContext) {
      ctx.waitUntil(despachar(env, new Date(evento.scheduledTime)));
    },
  } satisfies ExportedHandler<Env, SyncMessage>;
}
