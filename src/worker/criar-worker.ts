import type { ExportedHandler, MessageBatch } from "@cloudflare/workers-types";
import type { BrandConfig } from "../shared/brand/types";
import { type AppOptions, createApp } from "./app";
import { runScheduled } from "./cron/dispatch";
import type { Env } from "./env";
import type { SyncMessage } from "./sync/plan";
import { handleSyncBatch, type LoteDaFila } from "./sync/queue";

export type CriarWorkerOptions = {
  marca: BrandConfig;
  versao: string;
  rotasDoApp?: AppOptions["rotasDoApp"];
};

// fetch: o app. queue: a fila da importação (uma fatia por vez). scheduled: o despachante do cron (*/5 * * * *).
export function criarWorker({ marca, versao, rotasDoApp }: CriarWorkerOptions) {
  const app = createApp({ marca, versao, rotasDoApp });
  return {
    fetch: app.fetch,
    queue(lote: MessageBatch<SyncMessage>, env: Env) {
      return handleSyncBatch(lote as unknown as LoteDaFila, env);
    },
    scheduled(evento: ScheduledController, env: Env, ctx: ExecutionContext) {
      ctx.waitUntil(runScheduled(env, new Date(evento.scheduledTime)));
    },
  } satisfies ExportedHandler<Env, SyncMessage>;
}
