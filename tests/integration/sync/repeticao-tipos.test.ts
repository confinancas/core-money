import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import { startRun } from "../../../src/worker/sync/runs";
import { AMBIENTE, type Banco, rodar, semearBanco } from "./importacao-helpers";
import { pluggyFalsoComTransacoes } from "./pluggy-com-transacoes";

// Repetição e releitura (TASK-0205, N9 e A3): o que completa regras e tipo numa fatia repetida é só o que nasceu na
// própria execução. A releitura diária de linhas de dias antes (mesmo com a tentativa 2 da fila) não volta à fila da IA.

const DIA_1 = "2026-11-10T12:00:00.000Z";
const DIA_2 = "2026-11-10T13:00:00.000Z";

const filaDaIA = async (): Promise<number> =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM categorization_queue").first<{ n: number }>())?.n ?? 0;

// Duas transações [TEST] na conta do banco, sem categoria: a regra e a IA não as pegam.
const duas = (banco: Banco) => {
  const conta = `${banco.itemId}-corrente`;
  return pluggyFalsoComTransacoes((c) =>
    c === conta
      ? [
          { id: "[TEST]-a1", conta, data: "2026-11-05", valor: -21 },
          { id: "[TEST]-a2", conta, data: "2026-11-06", valor: -22 },
        ]
      : [],
  );
};

describe("releitura diária com a tentativa 2 da fila (A3)", () => {
  it("linhas de dias antes, relidas numa tentativa 2, não voltam à fila da IA", async () => {
    const banco = await semearBanco();
    const fetch = duas(banco);
    const primeira = (await startRun(createDb(env.DB, newMeter()), banco.itemId, "diaria", DIA_1)) as string;
    await rodar(primeira, fetch, 0, 1, DIA_1);
    await env.DB.prepare("DELETE FROM categorization_queue").run();
    expect(await filaDaIA()).toBe(0);

    const segunda = (await startRun(createDb(env.DB, newMeter()), banco.itemId, "diaria", DIA_2)) as string;
    await rodar(segunda, fetch, 0, 2, DIA_2);
    expect(await filaDaIA()).toBe(0);
  });
});

describe("repetição de uma fatia da própria execução (N9)", () => {
  it("a fatia repetida pela fila completa as linhas que ela mesma gravou antes da falha", async () => {
    const banco = await semearBanco();
    const fetch = duas(banco);
    const runId = (await startRun(createDb(env.DB, newMeter()), banco.itemId, "diaria", DIA_2)) as string;
    const { runSyncSlice } = await import("../../../src/worker/sync/slice");

    // Anda as fatias até a primeira de transações, e a repete depois de restaurar o cursor (a reentrega da fila).
    let seq = 0;
    for (let i = 0; i < 20; i++) {
      const cursorAntes = (
        await env.DB.prepare("SELECT cursor_json FROM sync_runs WHERE id = ?")
          .bind(runId)
          .first<{ cursor_json: string }>()
      )?.cursor_json as string;
      const fase = (JSON.parse(cursorAntes) as { phase: string }).phase;
      const resultado = await runSyncSlice(
        AMBIENTE,
        { db: createDb(env.DB, newMeter()), fetch },
        { runId, seq, tentativa: 1 },
        DIA_2,
      );
      if (fase === "transacoes" && resultado.tipo === "continua") {
        await env.DB.prepare("DELETE FROM categorization_queue").run();
        await env.DB.prepare("UPDATE sync_runs SET cursor_json = ? WHERE id = ?")
          .bind(cursorAntes, runId)
          .run();
        const repetida = await runSyncSlice(
          AMBIENTE,
          { db: createDb(env.DB, newMeter()), fetch },
          { runId, seq, tentativa: 2 },
          DIA_2,
        );
        expect(repetida.tipo).toBe("continua");
        expect(await filaDaIA()).toBeGreaterThan(0);
        return;
      }
      if (resultado.tipo !== "continua") break;
      seq += 1;
    }
    throw new Error("a fatia de transações não apareceu");
  });
});
