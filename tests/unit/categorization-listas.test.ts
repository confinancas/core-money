import { describe, expect, it } from "vitest";
import { type CodigosDoContexto, parseSuggestions } from "../../src/worker/categorization/output-schema";

// Listas da saída (rodada 1): entrada e subtipo só valem dentro da lista. Um valor fora dela, inclusive o nome de uma
// propriedade herdada de objeto ("constructor"), é saída inválida e conta tentativa.
const codigos: CodigosDoContexto = {
  categorias: new Map([["c1", "cat-1"]]),
  rendas: new Map([["r1", "renda-1"]]),
};
const entrada = [{ ref: "t1", entrada: true }];
const saida = [{ ref: "t1", entrada: false }];

const resposta = (campos: Record<string, unknown>) =>
  JSON.stringify({
    sugestoes: [
      {
        ref: "t1",
        categoria: null,
        entrada: null,
        renda: null,
        subtipo: null,
        certeza: "alta",
        motivo: "x",
        ...campos,
      },
    ],
  });

describe("parseSuggestions: entrada e subtipo na lista", () => {
  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "entrada %s (propriedade herdada) é saída inválida",
    (valor) => {
      expect(parseSuggestions(resposta({ entrada: valor }), entrada, codigos)).toEqual({
        ok: false,
        erro: "saida_invalida",
      });
    },
  );

  it("subtipo fora da lista é saída inválida, inclusive numa entrada variável", () => {
    expect(
      parseSuggestions(resposta({ entrada: "variavel", subtipo: "constructor" }), entrada, codigos),
    ).toEqual({ ok: false, erro: "saida_invalida" });
  });

  it("subtipo dentro da lista e entrada nula são aceitos", () => {
    const ok = parseSuggestions(resposta({ entrada: "variavel", subtipo: "venda" }), entrada, codigos);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.porRef.get("t1")?.aiIncomeSubtype).toBe("venda");
    expect(parseSuggestions(resposta({ entrada: null, subtipo: null }), saida, codigos).ok).toBe(true);
  });

  it('código de categoria herdado ("constructor") não vira id: sem sugestão, e conta codigo_invalido', () => {
    const r = parseSuggestions(resposta({ categoria: "constructor" }), saida, codigos);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.porRef.get("t1")?.aiCategoryId).toBeNull();
    expect(r.codigoInvalido).toBe(1);
  });
});
