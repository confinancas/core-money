// Estado da importação para as telas: o que está em andamento e o que terminou nas últimas 24 horas (uma consulta).
import { Hono } from "hono";
import { resetsAt } from "../../shared/usage";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { estaPausada } from "./orcamento";

const JANELA_DO_RECENTE_MS = 24 * 60 * 60 * 1000;

// A consulta do status fica exportada para o teste de plano ler o mesmo SQL. Duas metades em UNION ALL, cada uma pelo
// índice sync_runs_open_idx (banco, término): as execuções abertas (término nulo) e as encerradas desde a janela. Os
// bancos do lar entram pela conexão (bank_items_connection_idx). Um OR entre as duas condições impedia o índice de cortar
// pela data e lia todo o histórico do banco (TASK-0204, A2).
export const SQL_DO_STATUS = `SELECT r.id AS run_id, r.bank_item_id, b.institution_name, r.kind, r.progress_pct, r.started_at,
    r.finished_at, r.status, r.heartbeat_at
  FROM sync_runs r
  JOIN bank_items b ON b.id = r.bank_item_id
  JOIN pluggy_connections p ON p.id = b.connection_id
  WHERE p.household_id = ? AND r.kind = 'historico' AND r.finished_at IS NULL
UNION ALL
SELECT r.id AS run_id, r.bank_item_id, b.institution_name, r.kind, r.progress_pct, r.started_at,
    r.finished_at, r.status, r.heartbeat_at
  FROM sync_runs r
  JOIN bank_items b ON b.id = r.bank_item_id
  JOIN pluggy_connections p ON p.id = b.connection_id
  WHERE p.household_id = ? AND r.kind = 'historico' AND r.finished_at >= ?
ORDER BY started_at`;

type LinhaDoStatus = {
  run_id: string;
  bank_item_id: string;
  institution_name: string;
  kind: string;
  progress_pct: number;
  started_at: string;
  finished_at: string | null;
  status: string | null;
  heartbeat_at: string | null;
};

export function syncRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  rotas.get("/status", async (c) => {
    const { householdId } = getSession(c);
    const instante = agora();
    const desde = new Date(instante.getTime() - JANELA_DO_RECENTE_MS).toISOString();
    const resultado = await c.var.db.$client
      .prepare(SQL_DO_STATUS)
      .bind(householdId, householdId, desde)
      .all<LinhaDoStatus>();
    const linhas = resultado.results ?? [];
    return c.json(
      {
        // Pausada pelo teto diário (orcamento.ts): a fatia encostou o heartbeat na virada, e a retomada é a virada.
        importing: linhas
          .filter((linha) => linha.finished_at === null)
          .map((linha) => {
            const pausada = estaPausada(linha.heartbeat_at, instante);
            return {
              bankItemId: linha.bank_item_id,
              institutionName: linha.institution_name,
              progressPct: linha.progress_pct,
              startedAt: linha.started_at,
              pausada,
              pausadaAte: pausada ? resetsAt(instante) : null,
            };
          }),
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
