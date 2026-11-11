// Embrulho dos crons (TASK-0109): cada execução soma 1 em requests e as linhas das consultas que o handler faz pelo db
// medido. Nenhum cron existe ainda; as tasks de cron (TASK-0205 em diante) usam este embrulho.
import type { ExecutionContext, ScheduledController } from "@cloudflare/workers-types";
import { createDb, type Db } from "../db/client";
import { newMeter } from "../db/metered-d1";
import type { Env } from "../env";
import { flushUsage } from "./flush";

export type ScheduledHandler = (
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
  db: Db,
) => Promise<void>;

export function meteredScheduled(handler: ScheduledHandler) {
  return async (controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> => {
    const meter = newMeter();
    try {
      await handler(controller, env, ctx, createDb(env.DB, meter));
    } finally {
      ctx.waitUntil(flushUsage(env.DB, meter));
    }
  };
}
