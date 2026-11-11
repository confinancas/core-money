// Estado da importação para as telas: o que está em andamento e o que terminou nas últimas 24 horas (uma consulta).
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";

const JANELA_DO_RECENTE_MS = 24 * 60 * 60 * 1000;

type LinhaDoStatus = {
  run_id: string;
  bank_item_id: string;
  institution_name: string;
  kind: string;
  progress_pct: number;
  started_at: string;
  finished_at: string | null;
  status: string | null;
};

export function syncRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  rotas.get("/status", async (c) => {
    const { householdId } = getSession(c);
    const desde = new Date(agora().getTime() - JANELA_DO_RECENTE_MS).toISOString();
    const resultado = await c.var.db.$client
      .prepare(
        `SELECT r.id AS run_id, r.bank_item_id, b.institution_name, r.kind, r.progress_pct, r.started_at,
           r.finished_at, r.status
         FROM sync_runs r
         JOIN bank_items b ON b.id = r.bank_item_id
         JOIN pluggy_connections p ON p.id = b.connection_id
         WHERE p.household_id = ? AND r.kind = 'historico' AND (r.finished_at IS NULL OR r.finished_at >= ?)
         ORDER BY r.started_at`,
      )
      .bind(householdId, desde)
      .all<LinhaDoStatus>();
    const linhas = resultado.results ?? [];
    return c.json(
      {
        importing: linhas
          .filter((linha) => linha.finished_at === null)
          .map((linha) => ({
            bankItemId: linha.bank_item_id,
            institutionName: linha.institution_name,
            progressPct: linha.progress_pct,
            startedAt: linha.started_at,
          })),
        recentlyFinished: linhas
          .filter((linha) => linha.finished_at !== null)
          .map((linha) => ({
            runId: linha.run_id,
            bankItemId: linha.bank_item_id,
            institutionName: linha.institution_name,
            kind: linha.kind,
            status: linha.status,
            finishedAt: linha.finished_at,
          })),
      },
      200,
    );
  });

  return rotas;
}
