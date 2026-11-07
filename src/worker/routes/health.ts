import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { HealthResponse } from "../../shared/api";
import type { AppEnv } from "../env";

export const healthRoute = new Hono<AppEnv>();

healthRoute.get("/health", async (c) => {
  await c.var.db.all(sql`select 1`);
  const corpo: HealthResponse = { ok: true, version: c.var.versao, at: new Date().toISOString() };
  return c.json(corpo, 200);
});
