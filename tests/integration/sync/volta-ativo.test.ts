import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import { startRun } from "../../../src/worker/sync/runs";
import { rodar, semearBanco } from "./importacao-helpers";
import { pluggyFalsoComTransacoes } from "./pluggy-com-transacoes";

// Uma sincronização boa devolve a ativo o banco em acao_necessaria, como faz com o instável (TASK-0205, N1 decidido pelo
// Opus). Dados [TEST]; sem rede.
const DIA_2 = "2026-11-10T13:00:00.000Z";

describe("volta a ativo numa sincronização boa (N1)", () => {
  it("banco em acao_necessaria + diária boa: vira ativo", async () => {
    const banco = await semearBanco();
    await env.DB.prepare("UPDATE bank_items SET status = 'acao_necessaria' WHERE id = ?")
      .bind(banco.itemId)
      .run();
    const runId = (await startRun(createDb(env.DB, newMeter()), banco.itemId, "diaria", DIA_2)) as string;
    await rodar(
      runId,
      pluggyFalsoComTransacoes(() => []),
      0,
      1,
      DIA_2,
    );
    const linha = await env.DB.prepare("SELECT status FROM bank_items WHERE id = ?")
      .bind(banco.itemId)
      .first<{ status: string }>();
    expect(linha?.status).toBe("ativo");
  });
});

describe("só a sincronização diária e a manual devolvem a ativo (A4, F5)", () => {
  it("uma importação boa não devolve a ativo o banco instável", async () => {
    const banco = await semearBanco();
    await env.DB.prepare("UPDATE bank_items SET status = 'instavel' WHERE id = ?").bind(banco.itemId).run();
    const runId = (await startRun(createDb(env.DB, newMeter()), banco.itemId, "historico", DIA_2)) as string;
    await rodar(
      runId,
      pluggyFalsoComTransacoes(() => []),
      0,
      1,
      DIA_2,
    );
    const linha = await env.DB.prepare("SELECT status FROM bank_items WHERE id = ?")
      .bind(banco.itemId)
      .first<{ status: string }>();
    expect(linha?.status).toBe("instavel");
  });
});
