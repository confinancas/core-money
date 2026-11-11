import { describe, expect, it } from "vitest";
import { portasDoE2E } from "../../../scripts/dev/e2e-portas.mjs";

describe("portasDoE2E", () => {
  it("sem a variável, a base é 8788 e as portas de serviço são as de sempre", () => {
    expect(portasDoE2E(undefined)).toEqual({
      base: 8788,
      instalacaoPronta: 8788,
      stub: 8789,
      configuracao: 8790,
      pluggy: 8791,
      inspecaoInstalacaoPronta: 8792,
      inspecaoConfiguracao: 8793,
    });
  });

  it("com a base informada, o bloco inteiro anda junto", () => {
    expect(portasDoE2E("20080")).toEqual({
      base: 20080,
      instalacaoPronta: 20080,
      stub: 20081,
      configuracao: 20082,
      pluggy: 20083,
      inspecaoInstalacaoPronta: 20084,
      inspecaoConfiguracao: 20085,
    });
    expect(portasDoE2E("33080")).toMatchObject({
      instalacaoPronta: 33080,
      stub: 33081,
      configuracao: 33082,
      pluggy: 33083,
    });
  });

  it("aceita 1024 e 49142, e a maior base deixa o bloco inteiro abaixo de 49152", () => {
    expect(portasDoE2E("1024").instalacaoPronta).toBe(1024);
    expect(portasDoE2E("49142")).toMatchObject({
      instalacaoPronta: 49142,
      pluggy: 49145,
      inspecaoConfiguracao: 49147,
    });
    expect(49142 + 9).toBeLessThan(49152);
  });

  it.each([
    ["vazio", ""],
    ["espaço", " 8788"],
    ["sinal", "+8788"],
    ["negativo", "-8788"],
    ["zero à esquerda", "08788"],
    ["fração", "8788.5"],
    ["fração com zero", "8788.0"],
    ["letras", "abc"],
    ["hexadecimal", "0x2000"],
    ["notação científica", "1e4"],
    ["infinito", "Infinity"],
    ["NaN", "NaN"],
    ["abaixo do mínimo", "1023"],
    ["zero", "0"],
    ["porta de sistema", "80"],
    ["acima do máximo", "49143"],
  ])("recusa %s (%j)", (_nome, valor) => {
    expect(() => portasDoE2E(valor)).toThrow(/^MM_E2E_PORTA_BASE inválida/);
  });

  it("a mensagem nomeia a variável, o valor e a faixa aceita", () => {
    expect(() => portasDoE2E("49143")).toThrow(
      'MM_E2E_PORTA_BASE inválida ("49143"): use um inteiro de 1024 a 49142, ou tire a variável para usar 8788.',
    );
  });
});
