import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import { startRun } from "../../../src/worker/sync/runs";
import { rodar, semearBanco } from "./importacao-helpers";
import { pluggyFalsoComTransacoes } from "./pluggy-com-transacoes";

// O afterRun roda no fim da diária e da manual, e não no histórico (TASK-0205, A4, F13 e N4). Espião no módulo do
// afterRun: a chamada aparece com o tipo da execução. Dados [TEST]; Pluggy falso.
const depois = vi.hoisted(() => ({ chamadas: [] as { kind: string; householdId: string }[] }));

vi.mock("../../../src/worker/sync/after-run", async (original) => {
  const real = await original<typeof import("../../../src/worker/sync/after-run")>();
  return {
    ...real,
    afterRun: async (
      db: Parameters<typeof real.afterRun>[0],
      entrada: Parameters<typeof real.afterRun>[1],
    ) => {
      depois.chamadas.push({ kind: entrada.kind, householdId: entrada.householdId });
      return real.afterRun(db, entrada);
    },
  };
});

const DIA_1 = "2026-11-10T12:00:00.000Z";
const DIA_2 = "2026-11-10T13:00:00.000Z";

describe("afterRun no fim de cada execução (A4, F13)", () => {
  it("a diária chama o afterRun no fim, com o tipo 'diaria' e o lar da execução", async () => {
    const banco = await semearBanco();
    depois.chamadas.length = 0;
    const runId = (await startRun(createDb(env.DB, newMeter()), banco.itemId, "diaria", DIA_1)) as string;
    await rodar(
      runId,
      pluggyFalsoComTransacoes(() => []),
      0,
      1,
      DIA_1,
    );
    expect(depois.chamadas).toEqual([{ kind: "diaria", householdId: banco.householdId }]);
  });

  it("a importação (historico) também passa pelo afterRun, que nela não concilia de novo (o kind chega como historico)", async () => {
    const banco = await semearBanco();
    depois.chamadas.length = 0;
    const runId = (await startRun(createDb(env.DB, newMeter()), banco.itemId, "historico", DIA_2)) as string;
    await rodar(
      runId,
      pluggyFalsoComTransacoes(() => []),
      0,
      1,
      DIA_2,
    );
    expect(depois.chamadas.map((c) => c.kind)).toEqual(["historico"]);
  });
});
