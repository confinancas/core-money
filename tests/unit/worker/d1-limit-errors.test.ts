import { describe, expect, it } from "vitest";
import { D1_LIMIT_PATTERNS, isD1DailyLimitError } from "../../../src/worker/usage/d1-limit-errors";

// Erro de limite diário do D1 (TASK-0109, cenário 9): os padrões ficam em um arquivo, e a cadeia de causas é lida.
describe("isD1DailyLimitError", () => {
  it("reconhece os textos de limite diário dos padrões", () => {
    expect(D1_LIMIT_PATTERNS.length).toBe(3);
    expect(isD1DailyLimitError(new Error("D1_ERROR: daily write limit reached"))).toBe(true);
    expect(isD1DailyLimitError(new Error("exceeded the daily read limit"))).toBe(true);
    expect(isD1DailyLimitError(new Error("account quota exceeded"))).toBe(true);
  });

  it("lê a causa de um erro embrulhado (o Drizzle guarda o erro do D1 em cause)", () => {
    const original = new Error("D1_ERROR: exceeded daily limit");
    const embrulhado = new Error("Failed query: select 1", { cause: original });
    expect(isD1DailyLimitError(embrulhado)).toBe(true);
  });

  it("outros erros não são de limite", () => {
    expect(isD1DailyLimitError(new Error("UNIQUE constraint failed: members.id"))).toBe(false);
    expect(isD1DailyLimitError(new Error("Failed query: select * from transactions limit 5"))).toBe(false);
    expect(isD1DailyLimitError("texto solto")).toBe(false);
    expect(isD1DailyLimitError(undefined)).toBe(false);
  });
});
