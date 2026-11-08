import { describe, expect, it } from "vitest";
import { memberEmailSchema } from "../../../src/shared/household";

describe("memberEmailSchema", () => {
  it("vazio, ausente ou nulo vira null", () => {
    expect(memberEmailSchema.parse("")).toBeNull();
    expect(memberEmailSchema.parse("   ")).toBeNull();
    expect(memberEmailSchema.parse(null)).toBeNull();
    expect(memberEmailSchema.parse(undefined)).toBeNull();
  });

  it("tira os espaços das pontas e põe em minúsculas", () => {
    expect(memberEmailSchema.parse("  Pessoa.A@Example.COM ")).toBe("pessoa.a@example.com");
  });

  it("recusa formato sem arroba, sem domínio ou com espaço no meio", () => {
    for (const ruim of ["pessoa", "pessoa@", "@example.com", "pessoa@example", "pes soa@example.com"]) {
      const resultado = memberEmailSchema.safeParse(ruim);
      expect(resultado.success, ruim).toBe(false);
      if (!resultado.success) expect(resultado.error.issues[0]?.message).toBe("Confira o e-mail.");
    }
  });

  it("aceita até 120 caracteres e recusa mais", () => {
    const local = "a".repeat(100);
    expect(memberEmailSchema.safeParse(`${local}@example.com`).success).toBe(true);
    expect(memberEmailSchema.safeParse(`${"a".repeat(115)}@example.com`).success).toBe(false);
  });
});
