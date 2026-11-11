import type { ExportedHandler } from "@cloudflare/workers-types";
import type { BrandConfig } from "../shared/brand/types";
import { type AppOptions, createApp } from "./app";
import { despachar } from "./cron/despachante";
import type { Env } from "./env";
import { flushUsage } from "./usage/flush";
import { meteredScheduled } from "./usage/scheduled";

export type CriarWorkerOptions = {
  marca: BrandConfig;
  versao: string;
  rotasDoApp?: AppOptions["rotasDoApp"];
};

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
    // Um Cron Trigger só: o despachante decide o que roda nesta execução (TASK-0303). O embrulho de medição de uso
    // (TASK-0109) espera o handler e grava a linha do dia com o db medido.
    scheduled: meteredScheduled(async (evento, env, _ctx, db) => {
      await despachar(env, new Date(evento.scheduledTime), db);
    }),
  } satisfies ExportedHandler<Env>;
}
