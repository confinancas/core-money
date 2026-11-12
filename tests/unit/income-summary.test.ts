import { describe, expect, it } from "vitest";
import {
  formatFxDate,
  formatFxRate,
  fxReferenceDate,
  type RendaNoCiclo,
  summarizeCycleIncome,
  usdInBrlCents,
  usdToBrlCents,
} from "../../src/shared/income";

// Renda do ciclo (TASK-0902): a conta pura. Os números são os do protótipo e os cenários da spec, em centavos.

const CLT: RendaNoCiclo = {
  id: "clt",
  currency: "BRL",
  amountCents: 500000,
  keptUsdIsInvestment: false,
  recebidoCents: 500000,
  recebimentos: 1,
  fxRate: null,
};

// US$ 2.000,00 a 5,50: previsto de 11.000,00 em reais.
const dolar = (sobrescrito: Partial<RendaNoCiclo>): RendaNoCiclo => ({
  id: "dolar",
  currency: "USD",
  amountCents: 200000,
  keptUsdIsInvestment: true,
  recebidoCents: 0,
  recebimentos: 0,
  fxRate: 55000,
  ...sobrescrito,
});

const umaRenda = (renda: RendaNoCiclo, variavel = 0) => summarizeCycleIncome([renda], variavel);

describe("summarizeCycleIncome: os números do protótipo", () => {
  it("dólar 6.000,00 trazido, CLT 5.000,00, variável 568,70 e ficou 5.000,00 dão 16.568,70", () => {
    const resumo = summarizeCycleIncome([CLT, dolar({ recebidoCents: 600000, recebimentos: 2 })], 56870);
    expect(resumo.brazilSalariesCents).toBe(1100000);
    expect(resumo.keptUsdInvestedCents).toBe(500000);
    expect(resumo.variableCents).toBe(56870);
    expect(resumo.totalCents).toBe(1656870);
  });
});

describe("summarizeCycleIncome: cenários da spec", () => {
  it("cenário 2: trazido 4.000,00 de 11.000,00 deixa 7.000,00 como ficou e contribui 11.000,00", () => {
    const renda = umaRenda(dolar({ recebidoCents: 400000, recebimentos: 1 })).fixedIncomes[0];
    expect(renda).toMatchObject({
      received: true,
      expectedBrlCents: 1100000,
      broughtCents: 400000,
      keptCents: 700000,
    });
    expect(umaRenda(dolar({ recebidoCents: 400000, recebimentos: 1 })).totalCents).toBe(1100000);
  });

  it("cenário 2, com o Pix de 2.000,00: trazido 6.000,00, ficou 5.000,00", () => {
    const resumo = umaRenda(dolar({ recebidoCents: 600000, recebimentos: 2 }));
    expect(resumo.fixedIncomes[0]).toMatchObject({ broughtCents: 600000, keptCents: 500000 });
    expect(resumo.totalCents).toBe(1100000);
  });

  it("cenário 8: switch desligado, ficou é 0 e a renda conta só o trazido", () => {
    const resumo = umaRenda(dolar({ recebidoCents: 400000, recebimentos: 1, keptUsdIsInvestment: false }));
    expect(resumo.keptUsdInvestedCents).toBe(0);
    expect(resumo.totalCents).toBe(400000);
  });

  it("cenário 9: trouxe mais que o previsto, ficou é 0 e contribui o trazido", () => {
    const resumo = umaRenda(dolar({ recebidoCents: 1200000, recebimentos: 1 }));
    expect(resumo.fixedIncomes[0]).toMatchObject({ keptCents: 0, broughtCents: 1200000 });
    expect(resumo.totalCents).toBe(1200000);
  });

  it("cenário 10: renda sem recebimento no ciclo, received é falso e contribui 0", () => {
    const resumo = umaRenda(dolar({}));
    expect(resumo.fixedIncomes[0]).toMatchObject({ received: false, broughtCents: 0, keptCents: 0 });
    expect(resumo.totalCents).toBe(0);
  });

  it("cenário 12: 0,00 trazido com cotação deixa tudo como ficou (o previsto)", () => {
    const resumo = umaRenda(dolar({ recebidoCents: 0, recebimentos: 1 }));
    expect(resumo.fixedIncomes[0]).toMatchObject({ received: true, keptCents: 1100000, fxPending: false });
    expect(resumo.totalCents).toBe(1100000);
  });

  it("cotação pendente: com recebimento e sem cotação, contribui o trazido e marca fxPending", () => {
    const resumo = umaRenda(dolar({ recebidoCents: 400000, recebimentos: 1, fxRate: null }));
    expect(resumo.fixedIncomes[0]).toMatchObject({
      received: true,
      expectedBrlCents: null,
      broughtCents: 400000,
      keptCents: 0,
      fxPending: true,
    });
    expect(resumo.totalCents).toBe(400000);
  });

  it("cenário 17: a variável entra como está no total", () => {
    expect(umaRenda(CLT, 12340).totalCents).toBe(500000 + 12340);
  });
});

describe("usdToBrlCents", () => {
  it("converte com a cotação × 10.000 e arredonda para o centavo", () => {
    expect(usdToBrlCents(200000, 55000)).toBe(1100000);
    expect(usdToBrlCents(1, 54212)).toBe(5);
    expect(usdToBrlCents(1, 15000)).toBe(2);
  });

  it("recusa valores que não são inteiros", () => {
    expect(() => usdToBrlCents(1.5, 55000)).toThrow(TypeError);
    expect(() => usdToBrlCents(100, 5.5)).toThrow(TypeError);
  });

  it("o teto de US$ 100 milhões cabe no inteiro seguro", () => {
    const maximo = usdToBrlCents(10_000_000_000, 99_999);
    expect(Number.isSafeInteger(maximo)).toBe(true);
  });
});

describe("formatação da cotação", () => {
  it("duas casas, arredondadas", () => {
    expect(formatFxRate(55000)).toBe("5,50");
    expect(formatFxRate(54212)).toBe("5,42");
    expect(formatFxRate(54250)).toBe("5,43");
  });

  it("dia e mês de AAAA-MM-DD", () => {
    expect(formatFxDate("2026-10-05")).toBe("05/10");
  });
});

describe("fxReferenceDate", () => {
  it("é o recebimento do extrato mais antigo, mesmo que um manual seja anterior", () => {
    expect(
      fxReferenceDate([
        { receivedOn: "2026-10-03", confirmedBy: "pessoa" },
        { receivedOn: "2026-10-05", confirmedBy: "extrato" },
      ]),
    ).toBe("2026-10-05");
  });

  it("sem extrato, é o mais antigo de todos", () => {
    expect(
      fxReferenceDate([
        { receivedOn: "2026-10-09", confirmedBy: "pessoa" },
        { receivedOn: "2026-10-03", confirmedBy: "pessoa" },
      ]),
    ).toBe("2026-10-03");
  });

  it("sem recebimento, não há dia", () => {
    expect(fxReferenceDate([])).toBeNull();
  });
});

describe("usdInBrlCents", () => {
  it("soma as rendas em dólar pela própria cotação e ignora as em real", () => {
    const cotacao = { rateE4: 55000, rate: "5,50", date: "2026-10-05" };
    expect(
      usdInBrlCents([
        { currency: "USD", amountCents: 200000, ultima: cotacao },
        { currency: "BRL", amountCents: 500000, ultima: null },
      ]),
    ).toBe(1100000);
  });

  it("é nulo sem rendas em dólar e nulo se alguma ainda não tem cotação", () => {
    expect(usdInBrlCents([{ currency: "USD", amountCents: 200000, ultima: null }])).toBeNull();
    expect(usdInBrlCents([{ currency: "BRL", amountCents: 500000, ultima: null }])).toBeNull();
  });
});
