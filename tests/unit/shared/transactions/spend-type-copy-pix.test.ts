import { describe, expect, it } from "vitest";
import { docKindDe, iniciaisDe } from "../../../../src/shared/transactions/counterparty";
import { spendTypeCopy } from "../../../../src/shared/transactions/spend-type-copy";

// Pix enviado (TASK-0404): textos do kind 'pix', Metas e Investimentos, docKind e iniciais do avatar.
describe("spendTypeCopy (pix)", () => {
  it("escolhido: vale para este Pix e diz o que o Lembrar faz", () => {
    expect(
      spendTypeCopy({ type: "conforto", source: "escolhido", kind: "pix", categoryName: "Serviços" }).help,
    ).toBe('Vale para este Pix. Com "Lembrar" ligado, vale também para os próximos Pix para essa pessoa.');
  });

  it("Metas em Pix tem a ajuda própria, qualquer que seja a origem", () => {
    expect(spendTypeCopy({ type: "metas", source: "padrao", kind: "pix", categoryName: null }).help).toBe(
      "Vai para Metas: sai do limite de gasto do ciclo e soma no dinheiro guardado, como a reserva da viagem.",
    );
  });

  it("Investimentos em Pix tem a ajuda própria", () => {
    expect(
      spendTypeCopy({ type: "investimentos", source: "regra", kind: "pix", categoryName: null }).help,
    ).toBe("Conta como dinheiro guardado. Pix para a corretora já entra aqui sozinho.");
  });

  it("categoria no Pix troca 'nesta compra' por 'neste Pix'", () => {
    expect(
      spendTypeCopy({ type: "prazeres", source: "categoria", kind: "pix", categoryName: "Serviços" }).help,
    ).toBe("Veio da categoria Serviços. Toque em outro para trocar só neste Pix.");
  });
});

describe("docKindDe", () => {
  it("conta posições de dígito e • (pontuação não conta): 11 é CPF, 14 é CNPJ", () => {
    expect(docKindDe("•••.456.789-••")).toBe("cpf");
    expect(docKindDe("••.•••.•••/0001-••")).toBe("cnpj");
    expect(docKindDe("12345")).toBeNull();
    expect(docKindDe(null)).toBeNull();
  });
});

describe("iniciaisDe", () => {
  it("primeira e última palavra; uma palavra só dá uma letra; sem nome, null", () => {
    expect(iniciaisDe("JOAO P SILVA")).toBe("JS");
    expect(iniciaisDe("Diarista")).toBe("D");
    expect(iniciaisDe("  ")).toBeNull();
    expect(iniciaisDe(null)).toBeNull();
  });
});
