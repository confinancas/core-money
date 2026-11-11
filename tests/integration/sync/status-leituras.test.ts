import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import { SQL_DO_STATUS } from "../../../src/worker/sync/routes";
import { startRun } from "../../../src/worker/sync/runs";
import { semearPronto } from "../helpers/app";
import { semearLar } from "../helpers/sessao";

// Leituras do status da importação (TASK-0204, R5 e A2 da reconferência): a consulta do status lê perto do que devolve,
// mesmo com muito histórico encerrado no lar. Um lar com um banco e 1.500 execuções diárias encerradas (fora da janela
// de 24 horas), mais algumas execuções do histórico recentes. A consulta tem de cortar pelo índice de banco e estado.
const AGORA = "2026-11-10T12:00:00.000Z";
const DESDE = "2026-11-09T12:00:00.000Z";
const TETO_DE_LINHAS_LIDAS = 20;

async function semeiaLarComUmBanco(): Promise<{ householdId: string; bankItemId: string }> {
  const lar = await semearLar(env.DB, {
    memberId: crypto.randomUUID(),
    passkeyId: `cred-TEST-0205-${crypto.randomUUID()}`,
    email: `${crypto.randomUUID()}@example.com`,
  });
  const connectionId = crypto.randomUUID();
  const bankItemId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO pluggy_connections (id, household_id, label, cpf_masked, client_id_enc, iv, client_secret_enc,
         client_secret_iv, created_at) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)`,
    ).bind(connectionId, lar.householdId, `[TEST] Conexão ${connectionId.slice(0, 6)}`, AGORA),
    env.DB.prepare(
      `INSERT INTO bank_items (id, connection_id, institution_name, institution_color, consent_expires_at, last_sync_at,
         status, disconnected_at, created_at) VALUES (?, ?, '[TEST] Banco', NULL, NULL, NULL, 'ativo', NULL, ?)`,
    ).bind(bankItemId, connectionId, AGORA),
  ]);
  return { householdId: lar.householdId, bankItemId };
}

describe("leituras do status da importação: um lar com 1.500 execuções diárias encerradas", () => {
  it("o status lê perto do que devolve: as diárias encerradas e o histórico antigo não entram na leitura", async () => {
    await semearPronto(env.DB);
    const lar = await semeiaLarComUmBanco();
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1500)
       INSERT INTO sync_runs (id, bank_item_id, kind, started_at, finished_at, status, new_transactions, progress_pct,
         slices_total, slices_done, retried, cursor_json, heartbeat_at)
       SELECT 'diaria-' || i, ?1, 'diaria', '2026-11-01T00:00:00.000Z', '2026-11-01T01:00:00.000Z', 'ok', 0, 100,
         1, 1, 0, NULL, '2026-11-01T01:00:00.000Z'
       FROM n`,
    )
      .bind(lar.bankItemId)
      .run();
    // Histórico: um término dentro da janela de 24 horas, um do dia 1 (fora da janela) e a execução aberta.
    await env.DB.prepare(
      `INSERT INTO sync_runs (id, bank_item_id, kind, started_at, finished_at, status, new_transactions, progress_pct,
         slices_total, slices_done, retried, cursor_json, heartbeat_at)
       VALUES ('historico-recente', ?1, 'historico', '2026-11-10T09:00:00.000Z', '2026-11-10T10:00:00.000Z', 'ok', 0,
         100, 1, 1, 0, NULL, '2026-11-10T10:00:00.000Z'),
              ('historico-antigo', ?1, 'historico', '2026-11-01T00:00:00.000Z', '2026-11-01T01:00:00.000Z', 'ok', 0,
         100, 1, 1, 0, NULL, '2026-11-01T01:00:00.000Z')`,
    )
      .bind(lar.bankItemId)
      .run();
    const abertaId = (await startRun(
      createDb(env.DB, newMeter()),
      lar.bankItemId,
      "historico",
      AGORA,
    )) as string;

    const resultado = await env.DB.prepare(SQL_DO_STATUS)
      .bind(lar.householdId, lar.householdId, DESDE)
      .all<{ run_id: string }>();

    expect(resultado.results.map((linha) => linha.run_id)).toEqual(["historico-recente", abertaId]);
    expect(resultado.meta.rows_read).toBeLessThanOrEqual(TETO_DE_LINHAS_LIDAS);
  });
});
