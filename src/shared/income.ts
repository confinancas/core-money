// Renda do ciclo (TASK-0902): conversão do dólar, cotação de referência e a soma da renda do ciclo. Puro.
// Dinheiro em centavos inteiros; reais são sempre reais (o que entrou na conta), dólar é o que está na renda, na moeda
// dela. A cotação é um inteiro × 10.000 (5,4212 vira 54212). Nada passa por parseFloat.

export const FX_ESCALA = 10_000;

// Cotação de uma renda no ciclo: a taxa usada e o dia de referência dela (AAAA-MM-DD).
export type UltimaCotacao = { rateE4: number; rate: string; date: string };

// Dólar em centavos × cotação × 10.000 = reais em centavos, com arredondamento para o centavo mais próximo.
export function usdToBrlCents(usdCents: number, rateE4: number): number {
  if (!Number.isSafeInteger(usdCents) || !Number.isSafeInteger(rateE4)) {
    throw new TypeError("valores em centavos e cotação precisam ser inteiros");
  }
  return Math.round((usdCents * rateE4) / FX_ESCALA);
}

// "5,50" e "5,42": duas casas, arredondadas (a cotação guarda quatro).
export function formatFxRate(rateE4: number): string {
  const centesimos = Math.round(rateE4 / 100);
  const inteiro = Math.floor(centesimos / 100);
  return `${inteiro},${String(centesimos % 100).padStart(2, "0")}`;
}

// "05/10" a partir de AAAA-MM-DD.
export function formatFxDate(data: string): string {
  return `${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

export function ultimaCotacao(rateE4: number, date: string): UltimaCotacao {
  return { rateE4, rate: formatFxRate(rateE4), date };
}

// Dia de referência da cotação de uma renda no ciclo: o recebimento mais antigo do extrato ("o dia em que caiu na
// conta"); sem nenhum, o mais antigo de todos; sem recebimento, não há (ainda não caiu).
export function fxReferenceDate(
  recebimentos: readonly { receivedOn: string; confirmedBy: string }[],
): string | null {
  const doExtrato = recebimentos.filter((recebimento) => recebimento.confirmedBy === "extrato");
  const base = doExtrato.length > 0 ? doExtrato : recebimentos;
  const datas = base.map((recebimento) => recebimento.receivedOn).sort();
  return datas[0] ?? null;
}

// Uma renda no ciclo, já somada no SQL: recebidoCents são os reais que entraram; fxRate é a cotação do ciclo (dos
// recebimentos), nula enquanto a busca não trouxe.
export type RendaNoCiclo = {
  id: string;
  currency: "BRL" | "USD";
  amountCents: number;
  keptUsdIsInvestment: boolean;
  recebidoCents: number;
  recebimentos: number;
  fxRate: number | null;
};

export type ResumoDaRenda = {
  id: string;
  received: boolean;
  // Previsto em reais: o valor da renda em real, ou o dólar convertido pela cotação (nulo sem cotação).
  expectedBrlCents: number | null;
  broughtCents: number;
  keptCents: number;
  fxPending: boolean;
  contribuiCents: number;
};

export type ResumoDoCiclo = {
  fixedIncomes: ResumoDaRenda[];
  brazilSalariesCents: number;
  variableCents: number;
  keptUsdInvestedCents: number;
  totalCents: number;
};

// Renda do ciclo (pura). Real: contribui o trazido. Dólar sem recebimento: contribui 0 e "ainda não caiu". Dólar com
// recebimento e sem cotação: contribui o trazido, com fxPending. Dólar com cotação: contribui o trazido mais o que
// ficou (previsto em reais menos o trazido, nunca negativo, e só se o que fica é Investimento).
export function summarizeCycleIncome(rendas: readonly RendaNoCiclo[], variableCents: number): ResumoDoCiclo {
  const fixedIncomes = rendas.map((renda): ResumoDaRenda => {
    const received = renda.recebimentos > 0;
    const trazido = renda.recebidoCents;

    if (renda.currency === "BRL") {
      return {
        id: renda.id,
        received,
        expectedBrlCents: renda.amountCents,
        broughtCents: trazido,
        keptCents: 0,
        fxPending: false,
        contribuiCents: trazido,
      };
    }

    if (renda.fxRate === null) {
      return {
        id: renda.id,
        received,
        expectedBrlCents: null,
        broughtCents: received ? trazido : 0,
        keptCents: 0,
        fxPending: received,
        contribuiCents: received ? trazido : 0,
      };
    }

    const previsto = usdToBrlCents(renda.amountCents, renda.fxRate);
    const ficou = received && renda.keptUsdIsInvestment ? Math.max(0, previsto - trazido) : 0;
    const trazidoNaRenda = received ? trazido : 0;
    return {
      id: renda.id,
      received,
      expectedBrlCents: previsto,
      broughtCents: trazidoNaRenda,
      keptCents: ficou,
      fxPending: false,
      contribuiCents: trazidoNaRenda + ficou,
    };
  });

  const brazilSalariesCents = fixedIncomes.reduce((soma, renda) => soma + renda.broughtCents, 0);
  const keptUsdInvestedCents = fixedIncomes.reduce((soma, renda) => soma + renda.keptCents, 0);
  return {
    fixedIncomes,
    brazilSalariesCents,
    variableCents,
    keptUsdInvestedCents,
    totalCents: brazilSalariesCents + variableCents + keptUsdInvestedCents,
  };
}

// Soma das rendas em dólar convertidas pela própria cotação. Nulo sem rendas em dólar (não há conversão a mostrar), e
// nulo se alguma renda em dólar ainda não tem cotação.
export function usdInBrlCents(
  rendas: readonly { currency: "BRL" | "USD"; amountCents: number; ultima: UltimaCotacao | null }[],
): number | null {
  let total = 0;
  let temDolar = false;
  for (const renda of rendas) {
    if (renda.currency !== "USD") continue;
    temDolar = true;
    if (renda.ultima === null) return null;
    total += usdToBrlCents(renda.amountCents, renda.ultima.rateE4);
  }
  return temDolar ? total : null;
}
