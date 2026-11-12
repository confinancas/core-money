import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UltimaCotacaoFrase } from "@/screens/renda/UltimaCotacaoFrase";
import type { FixedIncomeDto } from "../../../src/shared/fixed-incomes";

// A frase da última cotação (TASK-0902, rodada 2, F4): a taxa e as datas são texto puro; os valores em dólar e em real
// são o MoneyText (o olho os borra). Falha se a frase voltar a ser texto puro.
afterEach(cleanup);

const DOLAR: FixedIncomeDto = {
  id: "renda-dolar",
  name: "[TEST] Salário em dólar",
  currency: "USD",
  amountCents: 200000,
  usualDay: 5,
  arrival: "partes",
  statementText: "[TEST] PAGADORA EXTERIOR",
  keptUsdIsInvestment: true,
  lastFx: { rateE4: 55000, rate: "5,50", date: "2026-10-05" },
};

describe("frase da última cotação", () => {
  it("o texto é o da spec, com os dois valores de dinheiro marcados para o olho", () => {
    const { container } = render(<UltimaCotacaoFrase renda={DOLAR} />);
    const paragrafo = container.querySelector("p");
    expect(paragrafo?.textContent).toBe("Última: 5,50 em 05/10, então 2.000,00 dólares ≈ 11.000,00 reais.");
    expect(container.querySelectorAll("[data-v]")).toHaveLength(2);
    expect(container.querySelectorAll(".mm-cents")).toHaveLength(2);
  });

  it("a taxa e as datas ficam fora dos valores marcados", () => {
    const { container } = render(<UltimaCotacaoFrase renda={DOLAR} />);
    const marcados = Array.from(container.querySelectorAll("[data-v]")).map((el) => el.textContent);
    expect(marcados.some((texto) => texto?.includes("5,50") || texto?.includes("05/10"))).toBe(false);
  });

  it("sem cotação, ou em real, não aparece", () => {
    const sem = render(<UltimaCotacaoFrase renda={{ ...DOLAR, lastFx: null }} />);
    expect(sem.container.innerHTML).toBe("");
    cleanup();
    const real = render(<UltimaCotacaoFrase renda={{ ...DOLAR, currency: "BRL", lastFx: DOLAR.lastFx }} />);
    expect(real.container.innerHTML).toBe("");
  });
});
