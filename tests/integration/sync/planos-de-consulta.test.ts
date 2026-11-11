import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { SQL_PARADAS, SQL_SEM_CICLO } from "../../../src/worker/cron/tarefas";
import { SQL_DO_STATUS } from "../../../src/worker/sync/routes";
import { semearLar } from "../helpers/sessao";

// Planos de consulta da importação (TASK-0204, R1 e R5). As consultas são as mesmas constantes que o código roda; o
// EXPLAIN QUERY PLAN tem de mostrar SEARCH pelo índice e nenhum SCAN de sync_runs (nem de transactions, fora o índice
// parcial). O cenário tem 1.500 execuções encerradas e um lar com 4 bancos, como na spec.
const AGORA = "2026-11-10T12:00:00.000Z";
const DESDE = "2026-11-09T12:00:00.000Z";

async function plano(sql: string, ...valores: unknown[]): Promise<string[]> {
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...valores)
    .all<{ detail: string }>();
  return results.map((linha) => linha.detail);
}

type LarComBancos = { householdId: string; connectionId: string; bancos: string[] };

// Lar com uma conexão e `quantos` bancos [TEST]. Sem execuções.
async function semeiaLarComBancos(quantos: number): Promise<LarComBancos> {
  const lar = await semearLar(env.DB, {
    memberId: crypto.randomUUID(),
    passkeyId: `cred-TEST-0205-${crypto.randomUUID()}`,
    email: `${crypto.randomUUID()}@example.com`,
  });
  const connectionId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO pluggy_connections (id, household_id, label, cpf_masked, client_id_enc, iv, client_secret_enc,
       client_secret_iv, created_at) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)`,
  )
    .bind(connectionId, lar.householdId, `[TEST] Conexão ${connectionId.slice(0, 6)}`, AGORA)
    .run();
  const bancos: string[] = [];
  for (let i = 0; i < quantos; i++) {
    const id = crypto.randomUUID();
    bancos.push(id);
    await env.DB.prepare(
      `INSERT INTO bank_items (id, connection_id, institution_name, institution_color, consent_expires_at, last_sync_at,
         status, disconnected_at, created_at) VALUES (?, ?, ?, NULL, NULL, NULL, 'ativo', NULL, ?)`,
    )
      .bind(id, connectionId, `[TEST] Banco ${i}`, AGORA)
      .run();
  }
  return { householdId: lar.householdId, connectionId, bancos };
}

// Execuções encerradas, distribuídas entre os bancos dados (uma instrução).
async function semeiaExecucoesEncerradas(bancos: string[], total: number): Promise<void> {
  const [a, b, c, d] = [bancos[0], bancos[1], bancos[2], bancos[3]];
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
     INSERT INTO sync_runs (id, bank_item_id, kind, started_at, finished_at, status, new_transactions, progress_pct,
       slices_total, slices_done, retried, cursor_json, heartbeat_at)
     SELECT 'run-' || ?2 || '-' || i,
       CASE i % 4 WHEN 0 THEN ?3 WHEN 1 THEN ?4 WHEN 2 THEN ?5 ELSE ?6 END,
       'historico', '2026-11-01T00:00:00.000Z', '2026-11-01T01:00:00.000Z', 'ok', 0, 100, 1, 1, 0, NULL,
       '2026-11-01T01:00:00.000Z'
     FROM n`,
  )
    .bind(total, crypto.randomUUID().slice(0, 8), a, b, c, d)
    .run();
}

describe("planos de consulta da importação (1.500 execuções encerradas, lar com 4 bancos)", () => {
  it("o cron de retomada busca pelo índice parcial de execuções abertas, sem SCAN de sync_runs", async () => {
    const lar = await semeiaLarComBancos(4);
    await semeiaExecucoesEncerradas(lar.bancos, 1500);

    const detalhes = await plano(SQL_PARADAS, "2026-11-10T11:45:00.000Z", 10);

    expect(detalhes).toEqual(["SEARCH sync_runs USING INDEX sync_runs_open_heartbeat_idx (heartbeat_at<?)"]);
    expect(detalhes.some((linha) => linha.startsWith("SCAN"))).toBe(false);
  });

  it("o status busca pelos bancos do lar e pelas execuções deles, sem SCAN de sync_runs", async () => {
    const lar = await semeiaLarComBancos(4);
    await semeiaExecucoesEncerradas(lar.bancos, 1500);

    const detalhes = await plano(SQL_DO_STATUS, lar.householdId, lar.householdId, DESDE);

    expect(detalhes.some((linha) => linha.startsWith("SCAN"))).toBe(false);
    expect(detalhes).toContain("SEARCH b USING INDEX bank_items_connection_idx (connection_id=?)");
    // As duas metades do UNION ALL cortam pelo índice de banco e término: as abertas (término nulo) e as recentes (TASK-0204, A2).
    expect(detalhes).toContain("SEARCH r USING INDEX sync_runs_open_idx (bank_item_id=? AND finished_at=?)");
    expect(detalhes).toContain("SEARCH r USING INDEX sync_runs_open_idx (bank_item_id=? AND finished_at>?)");
  });

  it("o limite de bancos conta pelo índice de bank_items por conexão", async () => {
    const lar = await semeiaLarComBancos(4);

    const detalhes = await plano(
      "SELECT COUNT(*) FROM bank_items WHERE connection_id = ? AND disconnected_at IS NULL",
      lar.connectionId,
    );

    expect(detalhes).toEqual(["SEARCH bank_items USING INDEX bank_items_connection_idx (connection_id=?)"]);
  });

  it("a atribuição de ciclos usa só o índice parcial de lançamentos sem ciclo, sem SCAN da tabela", async () => {
    const detalhes = await plano(SQL_SEM_CICLO);

    expect(detalhes.filter((linha) => linha.startsWith("SCAN"))).toEqual([
      "SCAN transactions USING INDEX transactions_no_cycle_local_date_idx",
    ]);
  });

  it("a execução aberta do banco continua pelo índice de abertura (startRun)", async () => {
    const lar = await semeiaLarComBancos(4);
    await semeiaExecucoesEncerradas(lar.bancos, 1500);

    const detalhes = await plano(
      "SELECT 1 FROM sync_runs WHERE bank_item_id = ? AND finished_at IS NULL",
      lar.bancos[0],
    );

    expect(detalhes).toEqual([
      "SEARCH sync_runs USING COVERING INDEX sync_runs_open_idx (bank_item_id=? AND finished_at=?)",
    ]);
  });

  it("o cron lê pouco com o índice: as execuções encerradas não entram na leitura da retomada", async () => {
    const lar = await semeiaLarComBancos(4);
    await semeiaExecucoesEncerradas(lar.bancos, 1500);

    const { meta } = await env.DB.prepare(SQL_PARADAS).bind("2026-11-10T11:45:00.000Z", 10).all();

    // Medido: 1 linha lida. Antes desta task: 1.501 (a tabela inteira, SCAN sync_runs).
    expect(meta.rows_read).toBeLessThanOrEqual(5);
  });
});
