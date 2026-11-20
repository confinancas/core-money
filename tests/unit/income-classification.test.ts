import { describe, expect, it } from "vitest";
import {
  applyClassificationDelta,
  type ClassificacaoDeEntrada,
  INCOME_OPTIONS,
  INCOME_SUBTYPES,
  type RendaNoCiclo,
  summarizeCycleIncome,
  usdToBrlCents,
} from "../../src/shared/income";

const salario = (fixedIncomeId: string): ClassificacaoDeEntrada => ({
  option: "salario",
  fixedIncomeId,
  incomeSubtype: null,
});
const variavel = (incomeSubtype: string): ClassificacaoDeEntrada => ({
  option: "variavel",
  fixedIncomeId: null,
  incomeSubtype,
});
const reembolso: ClassificacaoDeEntrada = { option: "reembolso", fixedIncomeId: null, incomeSubtype: null };
const transferencia: ClassificacaoDeEntrada = { option: "transferencia", fixedIncomeId: null, incomeSubtype: null };

const renda = (overrides: Partial<RendaNoCiclo> = {}): RendaNoCiclo => ({
  id: "renda-brl",
  currency: "BRL",
  amountCents: 1_000_000,
  keptUsdIsInvestment: false,
  recebidoCents: 0,
  recebimentos: 0,
  fxRate: null,
  ...overrides,
});

const total = (rendas: RendaNoCiclo[], variavelCents: number): number =>
  summarizeCycleIncome(rendas, variavelCents).totalCents;

describe("INCOME_OPTIONS", () => {
  it("mapeia cada opção da tela para o income_kind do modelo", () => {
    expect(INCOME_OPTIONS.salario.incomeKind).toBe("parte_salario");
    expect(INCOME_OPTIONS.variavel.incomeKind).toBe("variavel");
    expect(INCOME_OPTIONS.reembolso.incomeKind).toBe("reembolso");
    expect(INCOME_OPTIONS.transferencia.incomeKind).toBe("transferencia");
  });

  it("exige renda em salário e subtipo em variável, e nada nas outras", () => {
    expect(INCOME_OPTIONS.salario.exigeRenda).toBe(true);
    expect(INCOME_OPTIONS.variavel.exigeSubtipo).toBe(true);
    expect(INCOME_OPTIONS.reembolso.exigeRenda || INCOME_OPTIONS.reembolso.exigeSubtipo).toBe(false);
    expect(INCOME_OPTIONS.transferencia.exigeRenda || INCOME_OPTIONS.transferencia.exigeSubtipo).toBe(false);
  });

  it("tem os quatro subtipos da renda variável", () => {
    expect([...INCOME_SUBTYPES]).toEqual(["venda", "rendimento", "cashback", "outro"]);
  });
});

describe("applyClassificationDelta", () => {
  const ciclo = { rendas: [renda({ id: "renda-brl" })], variavelCents: 1_656_870 };

  it("nada -> variável soma na variável (cenário 1)", () => {
    const depois = applyClassificationDelta(ciclo, null, variavel("venda"), 150_000);
    expect(depois.variavelCents).toBe(1_806_870);
    expect(total(depois.rendas, depois.variavelCents)).toBe(total(ciclo.rendas, 1_806_870));
  });

  it("nada -> parte do salário soma no recebido e conta um recebimento", () => {
    const depois = applyClassificationDelta(ciclo, null, salario("renda-brl"), 150_000);
    expect(depois.rendas[0]?.recebidoCents).toBe(150_000);
    expect(depois.rendas[0]?.recebimentos).toBe(1);
    expect(depois.variavelCents).toBe(1_656_870);
  });

  it("nada -> reembolso e transferência não mudam a renda", () => {
    expect(applyClassificationDelta(ciclo, null, reembolso, 150_000)).toEqual(ciclo);
    expect(applyClassificationDelta(ciclo, null, transferencia, 150_000)).toEqual(ciclo);
  });

  it("parte do salário -> variável tira do recebido e põe na variável (cenário 5)", () => {
    const comSalario = applyClassificationDelta(ciclo, null, salario("renda-brl"), 150_000);
    const depois = applyClassificationDelta(comSalario, salario("renda-brl"), variavel("venda"), 150_000);
    expect(depois.rendas[0]?.recebidoCents).toBe(0);
    expect(depois.rendas[0]?.recebimentos).toBe(0);
    expect(depois.variavelCents).toBe(1_806_870);
  });

  it("variável -> parte do salário tira da variável e põe no recebido", () => {
    const comVariavel = applyClassificationDelta(ciclo, null, variavel("venda"), 150_000);
    const depois = applyClassificationDelta(comVariavel, variavel("venda"), salario("renda-brl"), 150_000);
    expect(depois.variavelCents).toBe(1_656_870);
    expect(depois.rendas[0]?.recebidoCents).toBe(150_000);
  });

  it("reembolso -> variável: a variável sobe e a renda não muda", () => {
    const depois = applyClassificationDelta(ciclo, reembolso, variavel("cashback"), 150_000);
    expect(depois.variavelCents).toBe(1_806_870);
    expect(depois.rendas).toEqual(ciclo.rendas);
  });

  it("variável -> nada tira da variável", () => {
    const comVariavel = applyClassificationDelta(ciclo, null, variavel("venda"), 150_000);
    expect(applyClassificationDelta(comVariavel, variavel("venda"), null, 150_000).variavelCents).toBe(1_656_870);
  });

  it("renda em dólar sem cotação: a parte do salário conta o trazido, sem previsto", () => {
    const sem = { rendas: [renda({ id: "usd", currency: "USD", amountCents: 1_100_000 })], variavelCents: 0 };
    const depois = applyClassificationDelta(sem, null, salario("usd"), 600_000);
    expect(depois.rendas[0]?.recebidoCents).toBe(600_000);
    const resumo = summarizeCycleIncome(depois.rendas, depois.variavelCents);
    expect(resumo.fixedIncomes[0]?.fxPending).toBe(true);
    expect(resumo.totalCents).toBe(600_000);
  });

  it("cenário 2: salário em dólar com cotação, trazido 6.000,00 -> 7.500,00, renda total sem mudança", () => {
    const rateE4 = 10_000;
    expect(usdToBrlCents(1_100_000, rateE4)).toBe(1_100_000);
    const antes = {
      rendas: [
        renda({
          id: "usd",
          currency: "USD",
          amountCents: 1_100_000,
          keptUsdIsInvestment: true,
          recebidoCents: 600_000,
          recebimentos: 1,
          fxRate: rateE4,
        }),
      ],
      variavelCents: 0,
    };
    const depois = applyClassificationDelta(antes, null, salario("usd"), 150_000);
    expect(depois.rendas[0]?.recebidoCents).toBe(750_000);
    const resumoAntes = summarizeCycleIncome(antes.rendas, antes.variavelCents);
    const resumoDepois = summarizeCycleIncome(depois.rendas, depois.variavelCents);
    expect(resumoDepois.fixedIncomes[0]?.keptCents).toBe(350_000);
    expect(resumoDepois.fixedIncomes[0]?.broughtCents).toBe(750_000);
    expect(resumoDepois.totalCents).toBe(resumoAntes.totalCents);
  });

  it("classificação numa renda que não está no ciclo não muda nada", () => {
    expect(applyClassificationDelta(ciclo, null, salario("renda-inexistente"), 150_000)).toEqual(ciclo);
  });
});
