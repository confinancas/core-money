import { describe, expect, it } from "vitest";
import type { PlannedPercentages } from "../../../src/shared/spend-types";
import {
  AVISO_DE_SOMA,
  mudaPercentual,
  segmentosDaBarra,
  TEXTO_BASE_SEM_RENDA,
  textoDaBase,
  textoDoLimite,
  totalDaDistribuicao,
  valorPorCiclo,
} from "../../../src/web/screens/configuracoes/tipos-de-gasto/view-model";

// View-model da tela TiposGasto (TASK-0802): barra, base, limite e o aviso de 100%. Sem React.

const PADRAO: PlannedPercentages = {
  fixos: 35,
  conforto: 10,
  educacao: 5,
  extras: 5,
  metas: 10,
  prazeres: 10,
};
const formatar = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")}`;

describe("barra e total da distribuição", () => {
  it("com a soma em 75%, a barra fecha 100% com a sobra em Investimentos (25%)", () => {
    const barra = segmentosDaBarra(PADRAO);
    expect(barra.map((segmento) => segmento.id)).toEqual([
      "fixos",
      "conforto",
      "educacao",
      "extras",
      "prazeres",
      "metas",
      "investimentos",
    ]);
    expect(barra.reduce((total, segmento) => total + segmento.largura, 0)).toBeCloseTo(100, 6);
    expect(barra.find((segmento) => segmento.id === "investimentos")?.largura).toBeCloseTo(25, 6);
  });

  it("acima de 100%, o total vermelho mostra a soma e a sobra não existe", () => {
    const acima = { ...PADRAO, metas: 40, fixos: 60 };
    expect(totalDaDistribuicao(acima)).toEqual({ texto: "130%", passou: true });
    expect(segmentosDaBarra(acima).find((segmento) => segmento.id === "investimentos")?.largura).toBe(0);
  });

  it("fechando em 100%, o total não é vermelho", () => {
    expect(totalDaDistribuicao({ ...PADRAO, metas: 35 })).toEqual({ texto: "100%", passou: false });
  });
});

describe("textos da base e do limite", () => {
  it("sem base, o texto da spec; com base, o mês e o valor", () => {
    expect(textoDaBase(null, formatar)).toBe(TEXTO_BASE_SEM_RENDA);
    expect(textoDaBase({ cycleKey: "2026-09", label: "setembro", prevIncomeCents: 1656870 }, formatar)).toBe(
      "Base: renda de setembro, 16568,70. Investimentos é o que sobra: ajusta sozinho para fechar 100%.",
    );
  });

  it("valor por ciclo é a base vezes o percentual; sem base, nada", () => {
    expect(valorPorCiclo({ cycleKey: "2026-09", label: "setembro", prevIncomeCents: 100000 }, 35)).toBe(
      35000,
    );
    expect(valorPorCiclo(null, 35)).toBeNull();
  });

  it("limite sem fotografia: traço e o texto do próximo ciclo", () => {
    expect(textoDoLimite(null, PADRAO)).toEqual({
      valorCents: null,
      linha: null,
      proximo: null,
      semValor: "O limite entra no começo do próximo ciclo.",
    });
  });

  it("limite com fotografia: a linha; a prévia só quando os percentuais mudaram", () => {
    const limite = { cycleKey: "2026-10", spendLimitCents: 1076966, pct: 65 };
    expect(textoDoLimite(limite, PADRAO).proximo).toBeNull();
    expect(textoDoLimite(limite, { ...PADRAO, fixos: 40 }).proximo).toBe(
      "Com os novos percentuais, o próximo ciclo terá 70% da renda.",
    );
    expect(textoDoLimite(limite, PADRAO).linha).toBe(
      "65% da renda do ciclo anterior · Fixos + Conforto + Educação + Extras + Prazeres",
    );
  });
});

describe("ajuste de percentual e aviso", () => {
  it("passo de 1, de 0 a 100", () => {
    expect(mudaPercentual(PADRAO, "fixos", 1).fixos).toBe(36);
    expect(mudaPercentual({ ...PADRAO, fixos: 0 }, "fixos", -1).fixos).toBe(0);
    expect(mudaPercentual({ ...PADRAO, fixos: 100 }, "fixos", 1).fixos).toBe(100);
  });

  it("o aviso da soma é o da spec", () => {
    expect(AVISO_DE_SOMA).toBe(
      "Os outros tipos passam de 100%. Reduza algum para sobrar para Investimentos.",
    );
  });
});
