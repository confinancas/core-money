import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import { startRun } from "../../../src/worker/sync/runs";
import { rodar, semearBanco } from "./importacao-helpers";
import { pluggyFalsoComTransacoes } from "./pluggy-com-transacoes";

// Banco parado 90 dias (consentimento vencido e renovado): a diária volta com os movimentos do intervalo, a partir da última
// sincronização com sucesso (TASK-0205, N2). Antes, a janela parava em 60 dias e a compra de agosto ficava de fora.
// Dados [TEST]; sem rede.
const ULTIMA_SINCRONIZACAO = "2026-08-12T12:00:00.000Z";
const HOJE = "2026-11-10T13:00:00.000Z";

describe("janela da diária com banco parado (N2)", () => {
  it("a última sincronização foi há 90 dias: a compra de 5 de agosto entra na diária", async () => {
    const banco = await semearBanco();
    await env.DB.prepare("UPDATE bank_items SET last_sync_at = ? WHERE id = ?")
      .bind(ULTIMA_SINCRONIZACAO, banco.itemId)
      .run();
    const conta = `${banco.itemId}-corrente`;
    const fetch = pluggyFalsoComTransacoes((c) =>
      c === conta ? [{ id: "[TEST]-agosto", conta, data: "2026-08-05", valor: -60 }] : [],
    );
    const runId = (await startRun(createDb(env.DB, newMeter()), banco.itemId, "diaria", HOJE)) as string;
    await rodar(runId, fetch, 0, 1, HOJE);
    const linha = await env.DB.prepare("SELECT removed_at FROM transactions WHERE external_id = ?")
      .bind("[TEST]-agosto")
      .first<{ removed_at: string | null }>();
    expect(linha).not.toBeNull();
    expect(linha?.removed_at).toBeNull();
  });
});
