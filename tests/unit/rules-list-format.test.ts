import { describe, expect, it } from "vitest";
import type { RegraDaLista } from "../../src/shared/rule-match";
import {
  acoesDaRegra,
  dataCurta,
  linhaDeCriacao,
  rotuloDaRenda,
  rotuloDeCriadaPor,
  textoDeDesfazer,
} from "../../src/web/screens/configuracoes/regras/format";

const base = (sobre: Partial<RegraDaLista> & { set?: Partial<RegraDaLista["set"]> }): RegraDaLista => {
  const { set, ...resto } = sobre;
  return {
    id: "[TEST] regra-1",
    scope: "estabelecimento",
    matchLabel: "[TEST] MERCADO",
    createdFrom: "lembrar",
    createdAt: "2026-11-05T15:00:00.000Z",
    createdByName: "[TEST] Pessoa A",
    ...resto,
    set: {
      categoryId: null,
      categoryName: null,
      categoryColor: null,
      customName: null,
      spendType: null,
      incomeKind: null,
      incomeSubtype: null,
      ...set,
    },
  };
};

describe("resumo da ação da regra", () => {
  it("categoria com a cor dela", () => {
    const acoes = acoesDaRegra(
      base({ set: { categoryId: "c1", categoryName: "Serviços", categoryColor: "#3D7BF7" } }),
    );
    expect(acoes).toEqual([{ tipo: "categoria", nome: "Serviços", cor: "#3D7BF7" }]);
  });

  it("categoria que não existe mais vira texto, sem cor", () => {
    expect(acoesDaRegra(base({ set: { categoryId: "c9", categoryName: null } }))).toEqual([
      { tipo: "texto", texto: "Categoria removida" },
    ]);
  });

  it("renomeia, com o nome entre aspas", () => {
    expect(acoesDaRegra(base({ set: { customName: "[TEST] Mercadinho" } }))).toEqual([
      { tipo: "texto", texto: 'Renomeia para "[TEST] Mercadinho"' },
    ]);
  });

  it("tipo de gasto pelo rótulo do tipo", () => {
    expect(acoesDaRegra(base({ set: { spendType: "educacao" } }))).toEqual([
      { tipo: "texto", texto: "Educação" },
    ]);
  });

  it("categoria e nome juntos saem nessa ordem", () => {
    const acoes = acoesDaRegra(
      base({ set: { categoryId: "c1", categoryName: "Mercado", categoryColor: "#000000", customName: "X" } }),
    );
    expect(acoes.map((acao) => acao.tipo)).toEqual(["categoria", "texto"]);
  });

  it("sem nenhum efeito diz isso", () => {
    expect(acoesDaRegra(base({}))).toEqual([{ tipo: "texto", texto: "Sem efeito" }]);
  });
});

describe("rótulos de renda", () => {
  it("cada tipo de entrada", () => {
    expect(rotuloDaRenda("parte_salario", null)).toBe("Parte do salário");
    expect(rotuloDaRenda("variavel", "venda")).toBe("Renda variável · Venda");
    expect(rotuloDaRenda("variavel", null)).toBe("Renda variável");
    expect(rotuloDaRenda("reembolso", null)).toBe("Reembolso de terceiros");
    expect(rotuloDaRenda("transferencia", null)).toBe("Transferência entre vocês");
    expect(rotuloDaRenda(null, null)).toBeNull();
  });

  it("renda variável dá a regra de entrada no resumo", () => {
    expect(
      acoesDaRegra(base({ scope: "remetente", set: { incomeKind: "variavel", incomeSubtype: "cashback" } })),
    ).toEqual([{ tipo: "texto", texto: "Renda variável · Cashback" }]);
  });
});

describe("matchLabel sem o documento e rótulos de createdFrom", () => {
  it("o rótulo de destinatário não mostra o documento mascarado", () => {
    const regra = base({ scope: "destinatario", matchLabel: "[TEST] JOAO" });
    expect(regra.matchLabel).not.toContain("|");
    expect(textoDeDesfazer(regra.matchLabel)).toBe(
      "Desfazer a regra de [TEST] JOAO? As próximas transações voltam para a fila Para categorizar. As que já foram continuam como estão.",
    );
  });

  it("cada origem tem o seu rótulo", () => {
    expect(rotuloDeCriadaPor("lembrar")).toBe("Lembrar");
    expect(rotuloDeCriadaPor("aplicar_todas")).toBe("Aplicar a todas");
    expect(rotuloDeCriadaPor("confirmacao")).toBe("Confirmação");
    expect(rotuloDeCriadaPor("manual")).toBe("Manual");
    expect(rotuloDeCriadaPor("desconhecida")).toBe("Confirmação");
  });

  it("linha de criação com data, nome e origem", () => {
    const data = new Date("2026-11-05T15:00:00.000Z");
    const esperado = `${String(data.getDate()).padStart(2, "0")}/${String(data.getMonth() + 1).padStart(2, "0")}`;
    expect(dataCurta("2026-11-05T15:00:00.000Z")).toBe(esperado);
    expect(linhaDeCriacao(base({}))).toBe(`${esperado} · [TEST] Pessoa A · Lembrar`);
    expect(linhaDeCriacao(base({ createdByName: null }))).toBe(`${esperado} · Lembrar`);
    expect(dataCurta("nao-e-data")).toBe("");
  });
});
