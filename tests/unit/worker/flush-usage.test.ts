import { describe, expect, it } from "vitest";
import { type ContadorD1, flushUsage, SQL_CONTADOR } from "../../../src/worker/usage/flush";

// Gravação do contador do dia (TASK-0109): o SQL do upsert, a virada do dia e a falha engolida. O D1 é falso aqui:
// o real é a integração (tests/integration/usage.test.ts).
type Gravacao = { sql: string; valores: unknown[] };

function d1Falso(falha = false) {
  const gravacoes: Gravacao[] = [];
  const d1: ContadorD1 = {
    prepare(sql) {
      return {
        bind(...valores) {
          return {
            async run() {
              gravacoes.push({ sql, valores });
              if (falha) throw new Error("D1 recusou a escrita");
              return {};
            },
          };
        },
      };
    },
  };
  return { d1, gravacoes };
}

describe("flushUsage", () => {
  it("faz o upsert por dia, somando 1 requisição e o custo do próprio contador", async () => {
    const { d1, gravacoes } = d1Falso();
    const medidor = { rowsRead: 40, rowsWritten: 2, sizeBytes: 168_000 };

    await flushUsage(d1, medidor, new Date("2026-11-02T12:00:00.000Z"));

    expect(gravacoes).toHaveLength(1);
    expect(gravacoes[0].sql).toBe(SQL_CONTADOR);
    expect(SQL_CONTADOR).toContain("ON CONFLICT(day) DO UPDATE");
    expect(SQL_CONTADOR).toContain("requests = requests + 1");
    expect(SQL_CONTADOR).toContain("CASE WHEN excluded.size_bytes > 0");
    // dia, linhas lidas (+1 do contador), escritas (+1 do contador), tamanho do último medido.
    expect(gravacoes[0].valores).toEqual(["2026-11-02", 41, 3, 168_000]);
  });

  it("a virada do dia: 23:59 UTC e 00:01 UTC gravam em dias diferentes", async () => {
    const { d1, gravacoes } = d1Falso();
    const medidor = { rowsRead: 0, rowsWritten: 0, sizeBytes: 0 };

    await flushUsage(d1, medidor, new Date("2026-11-02T23:59:00.000Z"));
    await flushUsage(d1, medidor, new Date("2026-11-03T00:01:00.000Z"));

    expect(gravacoes.map((g) => g.valores[0])).toEqual(["2026-11-02", "2026-11-03"]);
  });

  it("falha do D1 é engolida: a resposta segue, sem erro para quem chamou", async () => {
    const { d1 } = d1Falso(true);
    const medidor = { rowsRead: 1, rowsWritten: 0, sizeBytes: 0 };

    await expect(flushUsage(d1, medidor, new Date("2026-11-02T12:00:00.000Z"))).resolves.toBeUndefined();
  });
});
