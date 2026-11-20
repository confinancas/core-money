import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb } from "../../../src/worker/db/client";
import { type Meter, newMeter } from "../../../src/worker/db/metered-d1";
import { pluggyFalsoEmMemoria } from "../../../src/worker/dev/pluggy-fake-fetch";
import type { Env } from "../../../src/worker/env";
import { scheduleDailySync } from "../../../src/worker/sync/daily";
import { runSyncSlice } from "../../../src/worker/sync/slice";
import { AGORA, AMBIENTE, semearBanco, urlDe } from "./importacao-helpers";

// Custo da sincronização diária no D1 local (TASK-0205, passo 5): um lar com quatro bancos, cada um com 50 movimentos
// na janela da leitura diária. Mede rows_read e rows_written de cada fatia (o medidor do D1) e põe um teto. O teto tem
// folga sobre o medido; a tabela das Evidências vem daqui.

const MEIA_NOITE = "2026-11-10T03:00:00.000Z";
const AMBIENTE_COM_FILA = Object.assign({}, AMBIENTE, {
  SYNC_QUEUE: { send: async () => undefined },
}) as unknown as Env;

// Pluggy falso: 50 movimentos por conta, na data 2026-11-05 (dentro da janela da primeira diária de cada banco).
function pluggyCinquentaPorConta(): typeof fetch {
  const base = pluggyFalsoEmMemoria(0);
  return async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlDe(entrada);
    if (url.pathname !== "/v2/transactions") return base(entrada, init);
    const conta = url.searchParams.get("accountId") ?? "";
    const results = Array.from({ length: 50 }, (_, i) => ({
      id: `${conta}-m${i}`,
      accountId: conta,
      date: "2026-11-05T15:00:00.000Z",
      description: `[TEST] COMPRA ${i}`,
      descriptionRaw: `[TEST] COMPRA ${i}`,
      amount: -(10 + i),
      type: "DEBIT",
      category: "Groceries",
      operationType: "CARTAO",
      paymentData: null,
      creditCardMetadata: null,
      status: "POSTED",
    }));
    return new Response(JSON.stringify({ results, next: null }), {
      headers: { "content-type": "application/json" },
    });
  };
}

// Um lar com quatro bancos: os três primeiros entram na mesma conexão do primeiro.
async function larComQuatroBancos(): Promise<{ householdId: string; bancos: string[] }> {
  const primeiro = await semearBanco();
  const bancos = [primeiro.itemId];
  for (let i = 0; i < 3; i++) {
    const itemId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO bank_items (id, connection_id, institution_name, institution_color, consent_expires_at, last_sync_at,
         status, disconnected_at, created_at) VALUES (?, ?, '[TEST] Banco extra', NULL, NULL, NULL, 'ativo', NULL, ?)`,
    )
      .bind(itemId, primeiro.connectionId, AGORA)
      .run();
    bancos.push(itemId);
  }
  for (const itemId of bancos) {
    await env.DB.prepare(
      "INSERT INTO sync_runs (id, bank_item_id, kind, started_at, finished_at, status, cursor_json, heartbeat_at) VALUES (?, ?, 'historico', '2026-10-01T12:00:00.000Z', '2026-10-01T12:30:00.000Z', 'ok', '{\"seq\":0,\"phase\":\"fim\"}', NULL)",
    )
      .bind(crypto.randomUUID(), itemId)
      .run();
  }
  return { householdId: primeiro.householdId, bancos };
}

describe("sincronização diária, lar com quatro bancos: custo no D1 local (teto)", () => {
  it("agenda, roda as fatias de cada banco e fica abaixo do teto de leituras e escritas", async () => {
    const { bancos } = await larComQuatroBancos();
    const medidorAgendamento: Meter = newMeter();
    const agendados = await scheduleDailySync(AMBIENTE_COM_FILA, {
      agora: new Date(MEIA_NOITE),
      db: createDb(env.DB, medidorAgendamento),
    });
    expect(agendados).toBe(4);

    const fetch = pluggyCinquentaPorConta();
    let lidas = medidorAgendamento.rowsRead;
    let escritas = medidorAgendamento.rowsWritten;
    let fatias = 0;
    for (const itemId of bancos) {
      const execucao = await env.DB.prepare(
        "SELECT id FROM sync_runs WHERE bank_item_id = ? AND kind = 'diaria' AND finished_at IS NULL",
      )
        .bind(itemId)
        .first<{ id: string }>();
      expect(execucao?.id).toBeDefined();
      let seq = 0;
      for (let i = 0; i < 400; i++) {
        const medidor = newMeter();
        const resultado = await runSyncSlice(
          AMBIENTE,
          { db: createDb(env.DB, medidor), fetch },
          { runId: execucao?.id ?? "", seq, tentativa: 1 },
          MEIA_NOITE,
        );
        lidas += medidor.rowsRead;
        escritas += medidor.rowsWritten;
        fatias += 1;
        if (resultado.tipo !== "continua") break;
        seq += 1;
      }
    }

    // Teto com folga sobre o medido na rodada de 2026-11-11: rows_read 25.720 e rows_written 7.964 (24 fatias). O teto
    // de leituras (40.000) e o de escritas (12.000) ficam acima dele; a escrita diária do lar cabe no teto de 60% do D1.
    console.info(
      `MEDICAO-0205 agendamento+4 bancos: rows_read=${lidas} rows_written=${escritas} fatias=${fatias}`,
    );
    expect(lidas).toBeLessThanOrEqual(40_000);
    expect(escritas).toBeLessThanOrEqual(12_000);
    expect(fatias).toBeGreaterThan(0);
  });
});
