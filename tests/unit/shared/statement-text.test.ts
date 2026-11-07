import { describe, expect, it } from "vitest";
import { normalizeStatementText } from "../../../src/shared/statement-text";

describe("normalizeStatementText", () => {
  it("põe em maiúsculas, tira acento e colapsa espaços", () => {
    expect(normalizeStatementText("  pagamento   da  Fatura  ")).toBe("PAGAMENTO DA FATURA");
    expect(normalizeStatementText("Açaí do Zé")).toBe("ACAI DO ZE");
    expect(normalizeStatementText("PAG FATURA CARTÃO")).toBe("PAG FATURA CARTAO");
    expect(normalizeStatementText("Crédito\tbancário\n")).toBe("CREDITO BANCARIO");
  });

  it("texto vazio ou só de espaços vira vazio", () => {
    expect(normalizeStatementText("   ")).toBe("");
  });
});
