import { describe, expect, it } from "vitest";
import {
  allowedSpendTypes,
  investmentsPct,
  limitPct,
  SAVINGS_GROUP_LABEL,
  SPEND_TYPE_DEFS,
  SPEND_TYPES,
  sumPlanned,
} from "../../../src/shared/spend-types";

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

describe("percentuais e tipos permitidos (TASK-0802)", () => {
  const P = { fixos: 35, conforto: 10, educacao: 5, extras: 5, prazeres: 10, metas: 10 };

  it("investmentsPct é a sobra de 100; limitPct soma os cinco que entram no limite", () => {
    expect(investmentsPct(P)).toBe(25);
    expect(limitPct(P)).toBe(65);
    expect(sumPlanned(P)).toBe(75);
  });

  it("soma acima de 100 deixa Investimentos negativo (a tela avisa)", () => {
    expect(investmentsPct({ ...P, metas: 40, fixos: 40 })).toBe(-10);
  });

  it("allowedSpendTypes tira Metas e Investimentos no cartão e mantém os outros cinco", () => {
    expect(allowedSpendTypes({ isCard: true })).toEqual([
      "fixos",
      "conforto",
      "educacao",
      "extras",
      "prazeres",
    ]);
    expect(allowedSpendTypes({ isCard: false })).toHaveLength(7);
  });

  it("cada tipo com percentual aponta para o campo do lar; Investimentos não tem campo", () => {
    expect(SPEND_TYPE_DEFS.filter((tipo) => tipo.pctField === null).map((tipo) => tipo.id)).toEqual([
      "investimentos",
    ]);
    expect(SPEND_TYPE_DEFS.find((tipo) => tipo.id === "fixos")?.pctField).toBe("pct_fixed");
  });
});
