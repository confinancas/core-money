import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb } from "../../../src/worker/db/client";
import { type Meter, newMeter } from "../../../src/worker/db/metered-d1";
import { pluggyFalsoEmMemoria } from "../../../src/worker/dev/pluggy-fake-fetch";
import { startRun } from "../../../src/worker/sync/runs";
import { runSyncSlice } from "../../../src/worker/sync/slice";
import { AMBIENTE, semearBanco, urlDe } from "./importacao-helpers";

// Releitura sem mudança (TASK-0205, A1): a sincronização diária que relê o que já está gravado não pode regravar a linha
// inteira. Um banco com 100 movimentos (50 na conta, 50 no cartão), relido com o mesmo Pluggy no dia seguinte: a conta de
// escritas da releitura cabe em uma escrita por transação (o last_seen_at) mais o que a execução grava por si.

const DIA_1 = "2026-11-10T12:00:00.000Z";
const DIA_2 = "2026-11-10T13:00:00.000Z";
const MEIA_NOITE_SP_DIA_1 = "2026-11-10T03:00:00.000Z";

// 50 movimentos por conta, na data 2026-11-05 (dentro da janela diária). A mesma lista nas duas leituras.
function pluggyCinquentaPorConta(): typeof fetch {
  const base = pluggyFalsoEmMemoria(0);
  return async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlDe(entrada);
    if (url.pathname !== "/v2/transactions") return base(entrada, init);
    const conta = url.searchParams.get("accountId") ?? "";
    const results = Array.from({ length: 50 }, (_, i) => ({
      id: `${conta}-r${i}`,
      accountId: conta,
      date: "2026-11-05T15:00:00.000Z",
      description: `[TEST] RELEITURA ${i}`,
      descriptionRaw: `[TEST] RELEITURA ${i}`,
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

// Roda a execução inteira e devolve as escritas somadas das fatias (o medidor de cada fatia).
async function rodaMedido(runId: string, agora: string): Promise<Meter> {
  const total = newMeter();
  const fetch = pluggyCinquentaPorConta();
  let seq = 0;
  for (let i = 0; i < 400; i++) {
    const medidor = newMeter();
    const resultado = await runSyncSlice(AMBIENTE, { db: createDb(env.DB, medidor), fetch }, { runId, seq, tentativa: 1 }, agora);
    total.rowsWritten += medidor.rowsWritten;
    total.rowsRead += medidor.rowsRead;
    if (resultado.tipo !== "continua") break;
    seq += 1;
  }
  return total;
}

describe("releitura diária sem mudança: escritas (A1)", () => {
  it("relê 100 movimentos já gravados: escritas no máximo uma por transação, mais o que a execução grava", async () => {
    const banco = await semearBanco();
    const primeira = (await startRun(createDb(env.DB, newMeter()), banco.itemId, "diaria", MEIA_NOITE_SP_DIA_1)) as string;
    await rodaMedido(primeira, MEIA_NOITE_SP_DIA_1);
    const contagem = await env.DB.prepare("SELECT COUNT(*) AS n FROM transactions WHERE bank_item_id = ?")
      .bind(banco.itemId)
      .first<{ n: number }>();
    expect(contagem?.n).toBe(100);

    const segunda = (await startRun(createDb(env.DB, newMeter()), banco.itemId, "diaria", DIA_2)) as string;
    const medido = await rodaMedido(segunda, DIA_2);

    // Cada janela lida gravou uma escrita por linha (o last_seen_at): são três janelas de 50 linhas (conta, cartão e
    // parcelas futuras, que o Pluggy falso repete), 150 escritas. Mais 16 da estrutura da execução (contas, cartões,
    // faturas, cursor). Antes da correção, cada linha lida regravava as 7 entradas de índice: cerca de 1.050 escritas.
    console.info(`MEDICAO-0205 releitura de 100 movimentos: rows_written=${medido.rowsWritten} rows_read=${medido.rowsRead}`);
    expect(medido.rowsWritten).toBeLessThanOrEqual(150 + 40);
  });
});
