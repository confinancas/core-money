import { describe, expect, it } from "vitest";
import { paraAceitar, quantosConfirmados } from "../../src/shared/para-categorizar";

// Aceitar e progresso da visita (TASK-0304, rodada 1): o aceite manda no máximo 100 linhas com sugestão de saída, e a
// conta de "X de Y" soma a confirmação e as iguais que ela resolveu.

const com = (id: string, extra: Record<string, unknown> = {}) => ({
  transactionId: id,
  kind: "pix",
  suggestion: { categoryId: "cat", categoryName: "Serviços" },
  ...extra,
});

describe("paraAceitar", () => {
  it("manda no máximo 100 linhas, as primeiras carregadas", () => {
    const linhas = Array.from({ length: 120 }, (_, i) => com(`t-${i}`));
    const escolhidas = paraAceitar(linhas);
    expect(escolhidas).toHaveLength(100);
    expect(escolhidas[0]?.transactionId).toBe("t-0");
    expect(escolhidas[99]?.transactionId).toBe("t-99");
  });

  it("deixa de fora entradas, linhas sem sugestão e sugestão de renda", () => {
    const linhas = [
      com("ok"),
      com("entrada", { kind: "entrada" }),
      com("sem", { suggestion: null }),
      com("renda", { suggestion: { option: "salario" } }),
    ];
    expect(paraAceitar(linhas).map((l) => l.transactionId)).toEqual(["ok"]);
  });
});

describe("quantosConfirmados", () => {
  it("conta cada confirmação e as iguais que ela resolveu", () => {
    expect(quantosConfirmados([])).toBe(0);
    expect(quantosConfirmados([{ iguais: 0 }, { iguais: 2 }])).toBe(4);
  });
});
