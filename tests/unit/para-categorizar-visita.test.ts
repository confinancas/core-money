import { describe, expect, it } from "vitest";
import { paraAceitar, quantosConfirmados } from "../../src/shared/para-categorizar";

// Aceitar e progresso da visita (TASK-0304, rodada 1): o aceite manda no máximo 100 linhas com sugestão (até 20 entradas), e a
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

  it("deixa de fora linhas sem sugestão e saída com sugestão de renda", () => {
    const linhas = [
      com("ok"),
      com("sem", { suggestion: null }),
      com("renda-numa-saida", { suggestion: { option: "salario" } }),
      com("entrada-sem-opcao", { kind: "entrada", suggestion: { option: null } }),
    ];
    expect(paraAceitar(linhas).map((l) => l.transactionId)).toEqual(["ok"]);
  });

  it("inclui entradas com sugestão de renda, no máximo 20; as outras ficam na lista", () => {
    const entrada = (id: string) => com(id, { kind: "entrada", suggestion: { option: "variavel" } });
    const linhas = [...Array.from({ length: 25 }, (_, i) => entrada(`e-${i}`)), com("saida")];
    const escolhidas = paraAceitar(linhas).map((l) => l.transactionId);
    expect(escolhidas).toHaveLength(21);
    expect(escolhidas.filter((id) => id.startsWith("e-"))).toHaveLength(20);
    expect(escolhidas).toContain("e-19");
    expect(escolhidas).not.toContain("e-20");
    expect(escolhidas).toContain("saida");
  });

  it("o teto de 100 vale para entradas e saídas juntas", () => {
    const linhas = [
      ...Array.from({ length: 20 }, (_, i) =>
        com(`e-${i}`, { kind: "entrada", suggestion: { option: "variavel" } }),
      ),
      ...Array.from({ length: 120 }, (_, i) => com(`s-${i}`)),
    ];
    expect(paraAceitar(linhas)).toHaveLength(100);
  });
});

describe("quantosConfirmados", () => {
  it("conta cada confirmação e as iguais que ela resolveu", () => {
    expect(quantosConfirmados([])).toBe(0);
    expect(quantosConfirmados([{ iguais: 0 }, { iguais: 2 }])).toBe(4);
  });
});
