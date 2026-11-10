import { describe, expect, it } from "vitest";
import { formatMoneyInput, parseMoneyInput } from "../../src/shared/money-input";

// Valor digitado (TASK-0901): centavos inteiros, sem parseFloat; recusa o que é ambíguo.

describe("parseMoneyInput", () => {
  it.each([
    ["2.000,00", 200000],
    ["2000", 200000],
    ["2000,5", 200050],
    ["0,99", 99],
    ["0,5", 50],
    ["0", 0],
    ["12.345.678,90", 1234567890],
    ["100.000.000,00", 10000000000],
    ["  2.000,00  ", 200000],
  ])("aceita %j como %i centavos", (texto, centavos) => {
    expect(parseMoneyInput(texto)).toBe(centavos);
  });

  it.each([
    ["vazio", ""],
    ["só espaços", "   "],
    ["negativo", "-5"],
    ["letras", "abc"],
    ["letras no meio", "2a00"],
    ["mais de 2 casas", "2.000,000"],
    ["separadores trocados", "2,000.00"],
    ["milhar com vírgula", "1,234"],
    ["ponto decimal", "1.5"],
    ["vírgula sem casas", "2.000,"],
    ["símbolo de moeda", "R$ 2.000,00"],
  ])("recusa (null) %s", (_, texto) => {
    expect(parseMoneyInput(texto)).toBe(null);
  });

  it("recusa o que não cabe num inteiro seguro", () => {
    expect(parseMoneyInput("99999999999999999,00")).toBe(null);
  });
});

describe("formatMoneyInput", () => {
  it.each([
    [200000, "2.000,00"],
    [200050, "2.000,50"],
    [0, "0,00"],
    [99, "0,99"],
    [1234567890, "12.345.678,90"],
  ])("formata %i centavos como %j", (centavos, texto) => {
    expect(formatMoneyInput(centavos)).toBe(texto);
  });

  it("vai e volta: o que se formata se lê de volta igual", () => {
    for (const centavos of [0, 1, 99, 100, 200050, 1234567890, 10000000000]) {
      expect(parseMoneyInput(formatMoneyInput(centavos))).toBe(centavos);
    }
  });
});
