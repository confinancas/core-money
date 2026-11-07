import { describe, expect, it } from "vitest";
import { SAVINGS_GROUP_LABEL, SPEND_TYPES } from "../../../src/shared/spend-types";

describe("SPEND_TYPES", () => {
  it("tem os sete tipos na ordem do manual", () => {
    expect(SPEND_TYPES.map((tipo) => tipo.id)).toEqual([
      "fixos",
      "conforto",
      "educacao",
      "extras",
      "prazeres",
      "metas",
      "investimentos",
    ]);
  });

  it("tem os rótulos do manual", () => {
    expect(SPEND_TYPES.map((tipo) => tipo.label)).toEqual([
      "Custos fixos",
      "Conforto",
      "Educação",
      "Custos extras",
      "Prazeres",
      "Metas",
      "Investimentos",
    ]);
  });

  it("tem as cores do manual", () => {
    expect(SPEND_TYPES.map((tipo) => tipo.color)).toEqual([
      "#3D7BF7",
      "#13B5A6",
      "#A35BF0",
      "#C4995B",
      "#F0559A",
      "#F7931E",
      "#1E9E63",
    ]);
  });

  it("entra no limite só nos cinco primeiros", () => {
    expect(SPEND_TYPES.map((tipo) => tipo.inLimit)).toEqual([true, true, true, true, true, false, false]);
  });

  it("é dinheiro guardado só em Metas e Investimentos", () => {
    expect(SPEND_TYPES.filter((tipo) => tipo.savings).map((tipo) => tipo.id)).toEqual([
      "metas",
      "investimentos",
    ]);
    expect(SAVINGS_GROUP_LABEL).toBe("Dinheiro guardado");
  });
});
