import { describe, expect, it } from "vitest";
import {
  CATEGORY_MOVEMENTS,
  INCOME_CANDIDATE_MOVEMENTS,
  needsCategory,
  needsIncome,
  suggestionText,
} from "../../src/shared/categorization";

describe("needsCategory: quem precisa de categoria", () => {
  const movimentos = [
    "compra",
    "estorno",
    "pix_enviado",
    "ted_enviada",
    "debito",
    "boleto",
    "pix_recebido",
    "ted_recebida",
    "pagamento_fatura",
    "transferencia",
    "rendimento",
  ];
  it.each(movimentos)("%s, em saída e entrada", (movement) => {
    const esperado = (CATEGORY_MOVEMENTS as readonly string[]).includes(movement);
    expect(needsCategory({ movement, amount_cents: -100 })).toBe(esperado);
    expect(needsCategory({ movement, amount_cents: 100 })).toBe(esperado);
  });

  it("outro só quando o valor é negativo", () => {
    expect(needsCategory({ movement: "outro", amount_cents: -100 })).toBe(true);
    expect(needsCategory({ movement: "outro", amount_cents: 100 })).toBe(false);
  });
});

describe("needsIncome: quem é entrada a classificar", () => {
  it("candidata, positiva e sem income_kind", () => {
    for (const movement of INCOME_CANDIDATE_MOVEMENTS) {
      expect(needsIncome({ movement, amount_cents: 100, income_kind: null })).toBe(true);
    }
    expect(needsIncome({ movement: "pix_recebido", amount_cents: 100, income_kind: "transferencia" })).toBe(
      false,
    );
    expect(needsIncome({ movement: "pix_recebido", amount_cents: -100, income_kind: null })).toBe(false);
    expect(needsIncome({ movement: "compra", amount_cents: 100, income_kind: null })).toBe(false);
  });
});

describe("suggestionText", () => {
  it("junta o motivo e a certeza; sem certeza, nada", () => {
    expect(suggestionText("alta", "CNPJ de restaurante")).toBe("CNPJ de restaurante · certeza alta");
    expect(suggestionText("pouca", null)).toBe("pouca certeza");
    expect(suggestionText(null, "CNPJ de restaurante")).toBeNull();
  });
});
