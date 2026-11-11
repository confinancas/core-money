import { describe, expect, it } from "vitest";
import { spendTypeCopy } from "../../../../src/shared/transactions/spend-type-copy";

// Tabela de textos do tipo de gasto na compra (TASK-0403): as cinco linhas da spec, nos rótulos de SPEND_TYPES.
describe("spendTypeCopy (compra)", () => {
  it("padrão com categoria: diz que a categoria não tem tipo e que entrou como Prazeres", () => {
    expect(
      spendTypeCopy({ type: "prazeres", source: "padrao", kind: "compra", categoryName: "Serviços" }),
    ).toEqual({
      status: "Prazeres · padrão",
      help: "Serviços não tem tipo próprio, então entrou como Prazeres, o padrão. Toque em outro para trocar só nesta compra.",
    });
  });

  it("padrão sem categoria: sem categoria ainda, e toque em outro para trocar", () => {
    expect(spendTypeCopy({ type: "prazeres", source: "padrao", kind: "compra", categoryName: null })).toEqual(
      {
        status: "Prazeres · padrão",
        help: "Sem categoria ainda, então entrou como Prazeres, o padrão. Toque em outro para trocar.",
      },
    );
  });

  it("categoria: o tipo com 'da categoria' e a ajuda com o nome da categoria", () => {
    expect(
      spendTypeCopy({ type: "fixos", source: "categoria", kind: "compra", categoryName: "Mercado" }),
    ).toEqual({
      status: "Custos fixos · da categoria",
      help: "Veio da categoria Mercado. Toque em outro para trocar só nesta compra.",
    });
  });

  it("regra: o tipo com 'regra' e a ajuda de regra automática", () => {
    expect(spendTypeCopy({ type: "conforto", source: "regra", kind: "compra", categoryName: null })).toEqual({
      status: "Conforto · regra",
      help: "Veio de uma regra automática. Toque em outro para trocar só nesta compra.",
    });
  });

  it("escolhido: só o rótulo, e a ajuda explica o tipo padrão da categoria", () => {
    expect(
      spendTypeCopy({ type: "educacao", source: "escolhido", kind: "compra", categoryName: "Lazer" }),
    ).toEqual({
      status: "Educação",
      help: "Vale só para esta compra. Para todas da categoria, defina o tipo padrão em Configurações › Tipos de gasto.",
    });
  });
});
