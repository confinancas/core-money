import { describe, expect, it } from "vitest";
import { formatMoney, splitMoney } from "../../../src/shared/money";

describe("formatMoney", () => {
  it.each([
    [641000, undefined, "6.410,00"],
    [1076966, undefined, "10.769,66"],
    [-5097, undefined, "−50,97"],
    [150000, "always", "+1.500,00"],
    [0, "always", "0,00"],
    [123456789, undefined, "1.234.567,89"],
    [99, undefined, "0,99"],
  ] as const)("formata %s com sinal %s como %s", (centavos, sinal, esperado) => {
    expect(formatMoney(centavos, sinal)).toBe(esperado);
  });

  it("nunca põe R$", () => {
    expect(formatMoney(123456)).not.toContain("R$");
  });

  it("usa o menos U+2212, não o hífen", () => {
    expect(formatMoney(-100)).toBe("− 1,00".replace(" ", ""));
    expect(formatMoney(-100).charCodeAt(0)).toBe(0x2212);
  });

  it("não põe sinal no zero com always e trata -0 como zero", () => {
    expect(formatMoney(-0, "always")).toBe("0,00");
    expect(formatMoney(-0)).toBe("0,00");
  });

  it("sinal none mostra o valor absoluto", () => {
    expect(formatMoney(-5097, "none")).toBe("50,97");
  });

  it("aceita o maior inteiro seguro", () => {
    expect(formatMoney(Number.MAX_SAFE_INTEGER)).toBe("90.071.992.547.409,91");
  });

  it.each([[11.5], [Number.NaN], [Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY]])(
    "recusa o valor %s que não é inteiro seguro",
    (valor) => {
      expect(() => formatMoney(valor)).toThrow(TypeError);
      expect(() => formatMoney(valor)).toThrow("valor em centavos precisa ser inteiro");
    },
  );
});

describe("splitMoney", () => {
  it("separa sinal, parte inteira e centavos", () => {
    expect(splitMoney(-5097)).toEqual({ sign: "−", int: "50", cents: "97" });
    expect(splitMoney(150000, "always")).toEqual({ sign: "+", int: "1.500", cents: "00" });
  });
});
