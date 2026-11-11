import { describe, expect, it } from "vitest";
import {
  limiteUsadoPct,
  percentualPt,
  pilulaDeVariacao,
  seloDePaga,
  seloDeVencimento,
  textoDaMedia,
  textoDasParcelas,
  textoDeCartoes,
  textoDosLancamentos,
} from "../../../../src/web/screens/cartoes/view-model";

const HOJE = "2026-11-10";

describe("textoDeCartoes", () => {
  it("1 cartão no singular, o resto no plural", () => {
    expect(textoDeCartoes(1)).toBe("1 cartão");
    expect(textoDeCartoes(2)).toBe("2 cartões");
    expect(textoDeCartoes(0)).toBe("0 cartões");
  });
});

describe("seloDeVencimento", () => {
  it("dias até o vencimento, com aviso", () => {
    expect(seloDeVencimento("2026-11-14", HOJE)).toEqual({ texto: "Vence em 4 dias", tom: "aviso" });
  });

  it("amanhã e hoje têm texto próprio", () => {
    expect(seloDeVencimento("2026-11-11", HOJE)).toEqual({ texto: "Vence amanhã", tom: "aviso" });
    expect(seloDeVencimento("2026-11-10", HOJE)).toEqual({ texto: "Vence hoje", tom: "aviso" });
  });

  it("vencido: Venceu em DD/MM, em falta", () => {
    expect(seloDeVencimento("2026-11-08", HOJE)).toEqual({ texto: "Venceu em 08/11", tom: "falta" });
  });
});

describe("seloDePaga", () => {
  it("mês por extenso com a inicial maiúscula, em verde", () => {
    expect(seloDePaga("2026-09")).toEqual({ texto: "Setembro paga", tom: "sucesso" });
    expect(seloDePaga("2026-03")).toEqual({ texto: "Março paga", tom: "sucesso" });
  });
});

describe("pilulaDeVariacao", () => {
  it("cenário 5: setembro 2.870,40 contra agosto 3.120,00 é ▼ 8,0%, em verde", () => {
    expect(pilulaDeVariacao(287_040, 312_000)).toEqual({ texto: "▼ 8,0%", tom: "sucesso" });
  });

  it("alta vem em aviso, com vírgula", () => {
    expect(pilulaDeVariacao(112_300, 100_000)).toEqual({ texto: "▲ 12,3%", tom: "aviso" });
  });

  it("sem fatura anterior com valor, não há pílula", () => {
    expect(pilulaDeVariacao(50_000, 0)).toBeNull();
  });
});

describe("percentualPt e textoDaMedia", () => {
  it("uma casa decimal com vírgula", () => {
    expect(percentualPt(4.1)).toBe("4,1");
    expect(percentualPt(10)).toBe("10,0");
  });

  it("média em meses, no singular e no plural", () => {
    expect(textoDaMedia(1)).toBe("Média 1 mês");
    expect(textoDaMedia(5)).toBe("Média 5 meses");
  });
});

describe("limiteUsadoPct", () => {
  it("(limite − disponível) / limite, de 0 a 100", () => {
    expect(limiteUsadoPct(600_000, 366_000)).toBeCloseTo(39);
    expect(limiteUsadoPct(600_000, 600_000)).toBe(0);
    expect(limiteUsadoPct(600_000, -10_000)).toBe(100);
    expect(limiteUsadoPct(600_000, 900_000)).toBe(0);
  });

  it("sem limite, zero", () => {
    expect(limiteUsadoPct(0, 0)).toBe(0);
  });
});

describe("textoDasParcelas", () => {
  it("até três itens, separados por ·", () => {
    expect(
      textoDasParcelas([
        { name: "Amazon", installment: 3, of: 6 },
        { name: "Decathlon", installment: 2, of: 3 },
      ]),
    ).toBe("Amazon 3/6 · Decathlon 2/3");
  });

  it("depois de três, mostra o resto como +N", () => {
    const itens = [1, 2, 3, 4, 5].map((i) => ({ name: `Loja ${i}`, installment: 2, of: 4 }));
    expect(textoDasParcelas(itens)).toBe("Loja 1 2/4 · Loja 2 2/4 · Loja 3 2/4 · +2");
  });
});

describe("textoDosLancamentos", () => {
  it("sem ocultos, só a contagem", () => {
    expect(textoDosLancamentos(1, 0)).toBe("1 lançamento");
    expect(textoDosLancamentos(4, 0)).toBe("4 lançamentos");
  });

  it("com ocultos, mostra quantos ficaram fora", () => {
    expect(textoDosLancamentos(4, 1)).toBe("4 lançamentos · 1 fora");
  });
});
