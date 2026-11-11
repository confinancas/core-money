import { describe, expect, it } from "vitest";
import { CorpoDoPatchSchema, DetalheDaCompraSchema } from "../../../../src/shared/api/transactions";

// Schema do PATCH da compra (TASK-0403): ao menos um campo, nome com até 80 caracteres depois do trim, tipo da lista
// dos sete e só os três campos da spec.
describe("CorpoDoPatchSchema", () => {
  it("aceita um campo de cada vez e o nome nulo (usar original)", () => {
    expect(CorpoDoPatchSchema.safeParse({ customName: "Conserto do portão" }).success).toBe(true);
    expect(CorpoDoPatchSchema.safeParse({ customName: null }).success).toBe(true);
    expect(CorpoDoPatchSchema.safeParse({ spendType: "conforto" }).success).toBe(true);
    expect(CorpoDoPatchSchema.safeParse({ hidden: true }).success).toBe(true);
  });

  it("corpo vazio não passa", () => {
    expect(CorpoDoPatchSchema.safeParse({}).success).toBe(false);
  });

  // Campo desconhecido não pode passar nem junto de um campo válido (o schema não pode só descartá-lo).
  it("campo desconhecido junto de um campo válido também não passa", () => {
    expect(CorpoDoPatchSchema.safeParse({ hidden: true, categoryId: "seed:x" }).success).toBe(false);
    expect(CorpoDoPatchSchema.safeParse({ customName: "Nome", originalDescription: "x" }).success).toBe(
      false,
    );
  });

  it("nome de 81 caracteres não passa; 80 passa; o espaço das pontas não conta", () => {
    expect(CorpoDoPatchSchema.safeParse({ customName: "a".repeat(81) }).success).toBe(false);
    expect(CorpoDoPatchSchema.safeParse({ customName: "a".repeat(80) }).success).toBe(true);
    expect(CorpoDoPatchSchema.safeParse({ customName: ` ${"a".repeat(80)} ` }).success).toBe(true);
    expect(CorpoDoPatchSchema.safeParse({ customName: ` ${"a".repeat(81)} ` }).success).toBe(false);
  });

  it("tipo fora dos sete não passa, e campo que não está na spec não passa", () => {
    expect(CorpoDoPatchSchema.safeParse({ spendType: "luxo" }).success).toBe(false);
    expect(CorpoDoPatchSchema.safeParse({ spendType: "metas" }).success).toBe(true);
    expect(CorpoDoPatchSchema.safeParse({ categoryId: "seed:x" }).success).toBe(false);
    expect(CorpoDoPatchSchema.safeParse({ originalDescription: "outra" }).success).toBe(false);
  });

  it("hidden tem que ser booleano", () => {
    expect(CorpoDoPatchSchema.safeParse({ hidden: "sim" }).success).toBe(false);
  });
});

describe("DetalheDaCompraSchema", () => {
  it("recusa o grau de confiança fora dos três que a tela mostra", () => {
    const base = {
      id: "t1",
      movement: "compra",
      localDate: "2026-10-04",
      occurredAt: "2026-10-04T17:32:00Z",
      amountCents: -4500,
      originalDescription: "PAG*JOSEDASILVA SAO PAULO BR",
      customName: null,
      displayName: "PAG*JOSEDASILVA SAO PAULO BR",
      category: null,
      categorizedBy: null,
      spendType: "prazeres",
      spendTypeSource: "padrao",
      hidden: false,
      hiddenReason: null,
      installment: null,
      card: null,
      account: null,
      bill: null,
      cycle: null,
    };
    const com = (confidence: string) =>
      DetalheDaCompraSchema.safeParse({
        ...base,
        aiSuggestion: { categoryId: "k9", name: "Serviços", confidence },
      });
    expect(com("pouca").success).toBe(true);
    expect(com("média").success).toBe(true);
    expect(com("alta").success).toBe(true);
    expect(com("certa").success).toBe(false);
  });
});
