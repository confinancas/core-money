import { describe, expect, it } from "vitest";
import {
  assertSpendTypeAllowed,
  type EntradaDeResolucao,
  resolveSpendType,
} from "../../../../src/worker/spend-types/resolve";

// Matriz do espelho (origem atual × cartão × tipo da categoria × tipo da mãe). O SQL de tipoDaCategoriaSql faz o mesmo:
// a comparação linha a linha está na integração (tests/integration/spend-types), que grava as duas pontas.

const ORIGENS: (string | null)[] = ["escolhido", "regra", "categoria", "padrao", null];
const TIPOS: (string | null)[] = [null, "fixos", "conforto", "metas", "investimentos"];

describe("resolveSpendType (espelho do SQL)", () => {
  it("escolhido e regra não mudam, qualquer que seja a categoria", () => {
    for (const origem of ["escolhido", "regra"] as const) {
      for (const cartao of [true, false]) {
        for (const tipoCategoria of TIPOS) {
          for (const tipoMae of TIPOS) {
            expect(
              resolveSpendType({
                atual: { spendType: "conforto", source: origem },
                cartao,
                tipoCategoria,
                tipoMae,
              }),
            ).toEqual({ spendType: "conforto", source: origem });
          }
        }
      }
    }
  });

  it("para categoria/padrao, a própria categoria vem antes da mãe, e a mãe antes do padrão", () => {
    for (const origem of ["categoria", "padrao", null]) {
      for (const cartao of [true, false]) {
        for (const tipoCategoria of TIPOS) {
          for (const tipoMae of TIPOS) {
            const resultado = resolveSpendType({
              atual: { spendType: null, source: origem },
              cartao,
              tipoCategoria,
              tipoMae,
            });
            const proprio =
              tipoCategoria !== null &&
              !(cartao && (tipoCategoria === "metas" || tipoCategoria === "investimentos"));
            const mae = tipoMae !== null && !(cartao && (tipoMae === "metas" || tipoMae === "investimentos"));
            if (proprio) expect(resultado).toEqual({ spendType: tipoCategoria, source: "categoria" });
            else if (mae) expect(resultado).toEqual({ spendType: tipoMae, source: "categoria" });
            else expect(resultado).toEqual({ spendType: "prazeres", source: "padrao" });
          }
        }
      }
    }
  });

  it("cenário 4: no cartão, Metas e Investimentos nunca saem; a conta aceita", () => {
    const base: Omit<EntradaDeResolucao, "cartao" | "tipoCategoria"> = {
      atual: { spendType: null, source: null },
      tipoMae: null,
    };
    expect(resolveSpendType({ ...base, cartao: true, tipoCategoria: "metas" })).toEqual({
      spendType: "prazeres",
      source: "padrao",
    });
    expect(resolveSpendType({ ...base, cartao: true, tipoCategoria: "investimentos" })).toEqual({
      spendType: "prazeres",
      source: "padrao",
    });
    expect(resolveSpendType({ ...base, cartao: false, tipoCategoria: "metas" })).toEqual({
      spendType: "metas",
      source: "categoria",
    });
  });

  it("mesmo sem origem atual (null), o tipo sempre fica definido", () => {
    for (const cartao of [true, false]) {
      for (const tipoCategoria of TIPOS) {
        for (const tipoMae of TIPOS) {
          expect(
            resolveSpendType({ atual: { spendType: null, source: null }, cartao, tipoCategoria, tipoMae })
              .spendType,
          ).not.toBeNull();
        }
      }
    }
  });

  it("matriz completa tem origem válida em todo caso", () => {
    for (const origem of ORIGENS) {
      for (const cartao of [true, false]) {
        for (const tipoCategoria of TIPOS) {
          for (const tipoMae of TIPOS) {
            expect(["escolhido", "regra", "categoria", "padrao"]).toContain(
              resolveSpendType({
                atual: { spendType: "fixos", source: origem },
                cartao,
                tipoCategoria,
                tipoMae,
              }).source,
            );
          }
        }
      }
    }
  });
});

describe("assertSpendTypeAllowed", () => {
  it("recusa Metas e Investimentos no cartão, com a mensagem da spec", () => {
    expect(() => assertSpendTypeAllowed({ cardId: "c-1" }, "metas")).toThrow(
      "Compra no cartão nunca é Metas nem Investimentos.",
    );
    expect(() => assertSpendTypeAllowed({ cardId: "c-1" }, "investimentos")).toThrow();
  });

  it("aceita Metas e Investimentos em conta; recusa tipo fora da lista", () => {
    expect(() => assertSpendTypeAllowed({ cardId: null }, "investimentos")).not.toThrow();
    expect(() => assertSpendTypeAllowed({ cardId: null }, "metas")).not.toThrow();
    expect(() => assertSpendTypeAllowed({ cardId: null }, "inventado")).toThrow("Tipo de gasto inválido.");
  });
});
