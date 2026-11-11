import { describe, expect, it } from "vitest";
import {
  motivoDaSugestao,
  parseSuggestions,
  SEM_SUGESTAO,
  temSugestao,
} from "../../src/worker/categorization/output-schema";

// Códigos do contexto de teste: c1..c3 (categorias) e r1..r2 (rendas), já mapeados para ids.
const codigos = {
  categorias: new Map([
    ["c1", "cat-1"],
    ["c2", "cat-2"],
    ["c3", "cat-3"],
  ]),
  rendas: new Map([
    ["r1", "renda-1"],
    ["r2", "renda-2"],
  ]),
};

const saida = (ref: string) => ({ ref: ref, entrada: false });
const entrada = (ref: string) => ({ ref: ref, entrada: true });

const sugestao = (campos: Record<string, unknown>) => ({
  ref: "t1",
  categoria: null,
  entrada: null,
  renda: null,
  subtipo: null,
  certeza: "alta",
  motivo: "CNPJ de restaurante",
  ...campos,
});

const json = (sugestoes: unknown[]): string => JSON.stringify({ sugestoes });

describe("parseSuggestions: saídas", () => {
  it("grava a categoria do código, a certeza e o motivo", () => {
    const r = parseSuggestions(
      json([sugestao({ categoria: "c1", certeza: "media" })]),
      [saida("t1")],
      codigos,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.porRef.get("t1")).toEqual({
      ...SEM_SUGESTAO,
      aiCategoryId: "cat-1",
      aiConfidence: "media",
      aiReason: "CNPJ de restaurante",
    });
  });

  it("categoria nula não tem sugestão", () => {
    const r = parseSuggestions(json([sugestao({ categoria: null })]), [saida("t1")], codigos);
    if (!r.ok) throw new Error("devia ler");
    expect(r.porRef.get("t1")).toEqual(SEM_SUGESTAO);
    expect(r.codigoInvalido).toBe(0);
  });

  it('categoria fora dos códigos ("c99") não tem sugestão e conta codigo_invalido', () => {
    const r = parseSuggestions(json([sugestao({ categoria: "c99" })]), [saida("t1")], codigos);
    if (!r.ok) throw new Error("devia ler");
    expect(r.porRef.get("t1")).toEqual(SEM_SUGESTAO);
    expect(r.codigoInvalido).toBe(1);
  });

  it("os campos de entrada numa saída são ignorados", () => {
    const r = parseSuggestions(
      json([sugestao({ categoria: "c2", entrada: "salario", renda: "r1", subtipo: "venda" })]),
      [saida("t1")],
      codigos,
    );
    if (!r.ok) throw new Error("devia ler");
    expect(r.porRef.get("t1")).toEqual({
      ...SEM_SUGESTAO,
      aiCategoryId: "cat-2",
      aiConfidence: "alta",
      aiReason: "CNPJ de restaurante",
    });
  });
});

describe("parseSuggestions: entradas", () => {
  it("salario com renda válida vira parte_salario com a renda fixa (cenário 19)", () => {
    const r = parseSuggestions(
      json([sugestao({ entrada: "salario", renda: "r1", categoria: "c1" })]),
      [entrada("t1")],
      codigos,
    );
    if (!r.ok) throw new Error("devia ler");
    expect(r.porRef.get("t1")).toEqual({
      ...SEM_SUGESTAO,
      aiIncomeKind: "parte_salario",
      aiFixedIncomeId: "renda-1",
      aiConfidence: "alta",
      aiReason: "CNPJ de restaurante",
    });
  });

  it("salario sem renda, ou com renda fora dos códigos, não tem sugestão (cenário 21)", () => {
    const semRenda = parseSuggestions(
      json([sugestao({ entrada: "salario", renda: null })]),
      [entrada("t1")],
      codigos,
    );
    const rendaInvalida = parseSuggestions(
      json([sugestao({ entrada: "salario", renda: "r9" })]),
      [entrada("t1")],
      codigos,
    );
    if (!semRenda.ok || !rendaInvalida.ok) throw new Error("devia ler");
    expect(semRenda.porRef.get("t1")).toEqual(SEM_SUGESTAO);
    expect(rendaInvalida.porRef.get("t1")).toEqual(SEM_SUGESTAO);
    expect(rendaInvalida.codigoInvalido).toBe(1);
  });

  it("variavel sem subtipo vira outro; com subtipo, o subtipo", () => {
    const sem = parseSuggestions(json([sugestao({ entrada: "variavel" })]), [entrada("t1")], codigos);
    const com = parseSuggestions(
      json([sugestao({ entrada: "variavel", subtipo: "venda" })]),
      [entrada("t1")],
      codigos,
    );
    if (!sem.ok || !com.ok) throw new Error("devia ler");
    expect(sem.porRef.get("t1")?.aiIncomeKind).toBe("variavel");
    expect(sem.porRef.get("t1")?.aiIncomeSubtype).toBe("outro");
    expect(com.porRef.get("t1")?.aiIncomeSubtype).toBe("venda");
  });

  it("reembolso e transferencia gravam o tipo, sem renda", () => {
    const r = parseSuggestions(
      json([
        sugestao({ ref: "t1", entrada: "reembolso", categoria: "c1" }),
        sugestao({ ref: "t2", entrada: "transferencia" }),
      ]),
      [entrada("t1"), entrada("t2")],
      codigos,
    );
    if (!r.ok) throw new Error("devia ler");
    expect(r.porRef.get("t1")).toMatchObject({ aiIncomeKind: "reembolso", aiCategoryId: null });
    expect(r.porRef.get("t2")).toMatchObject({ aiIncomeKind: "transferencia", aiFixedIncomeId: null });
  });
});

describe("parseSuggestions: refs, repetições e saída inválida", () => {
  it("ref desconhecida é ignorada e ref repetida vale a primeira", () => {
    const r = parseSuggestions(
      json([
        sugestao({ ref: "t9", categoria: "c1" }),
        sugestao({ ref: "t1", categoria: "c1" }),
        sugestao({ ref: "t1", categoria: "c2" }),
      ]),
      [saida("t1")],
      codigos,
    );
    if (!r.ok) throw new Error("devia ler");
    expect([...r.porRef.keys()]).toEqual(["t1"]);
    expect(r.porRef.get("t1")?.aiCategoryId).toBe("cat-1");
  });

  it("ref que não voltou fica fora do mapa (quem chama trata como sem_resposta)", () => {
    const r = parseSuggestions(
      json([sugestao({ ref: "t1", categoria: "c1" })]),
      [saida("t1"), saida("t2")],
      codigos,
    );
    if (!r.ok) throw new Error("devia ler");
    expect(r.porRef.has("t2")).toBe(false);
  });

  it("JSON quebrado ou sem a lista vira saida_invalida", () => {
    expect(parseSuggestions("{ não é json", [saida("t1")], codigos)).toEqual({
      ok: false,
      erro: "saida_invalida",
    });
    expect(parseSuggestions('{"outra":[]}', [saida("t1")], codigos)).toEqual({
      ok: false,
      erro: "saida_invalida",
    });
  });

  it("temSugestao diz se há categoria ou tipo de entrada", () => {
    expect(temSugestao(SEM_SUGESTAO)).toBe(false);
    expect(temSugestao({ ...SEM_SUGESTAO, aiCategoryId: "cat-1" })).toBe(true);
    expect(temSugestao({ ...SEM_SUGESTAO, aiIncomeKind: "reembolso" })).toBe(true);
  });
});

describe("motivoDaSugestao", () => {
  it("corta em 60 caracteres, tira as pontas e devolve nulo quando vazio", () => {
    expect(motivoDaSugestao("  CNPJ de restaurante  ")).toBe("CNPJ de restaurante");
    expect(motivoDaSugestao("a".repeat(80))).toBe("a".repeat(60));
    expect(motivoDaSugestao("   ")).toBeNull();
    expect(motivoDaSugestao(undefined)).toBeNull();
  });
});
