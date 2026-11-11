import type { ExportedHandler } from "@cloudflare/workers-types";
import type { BrandConfig } from "../shared/brand/types";
import { type AppOptions, createApp } from "./app";
import { despachar } from "./cron/despachante";
import type { Env } from "./env";

export type CriarWorkerOptions = {
  marca: BrandConfig;
  versao: string;
  rotasDoApp?: AppOptions["rotasDoApp"];
};

export function criarWorker({ marca, versao, rotasDoApp }: CriarWorkerOptions) {
  const app = createApp({ marca, versao, rotasDoApp });
  return {
    fetch: app.fetch,
    // Um Cron Trigger só: o despachante decide o que roda nesta execução (TASK-0303).
    scheduled: (evento, env, ctx) => {
      ctx.waitUntil(despachar(env, new Date(evento.scheduledTime)));
    },
  } satisfies ExportedHandler<Env>;
}
