// Montagem pura das respostas de cartões (TASK-0402): a série de faturas (fechadas, aberta e futuras projetadas), o
// selo, a fatura do topo, a média e o melhor dia. Nada aqui fala com o banco: as consultas (queries.ts) entregam as
// linhas e o total de cada fatura já somado no SQL.

import {
  type FaturaProjetada,
  type ItemDeParcela,
  type LinhaParcelada,
  projectFutureBills,
} from "../../shared/cards/installments";
import { addDays, type Ciclo, cycleForDate, daysInMonth, standardCycle } from "../../shared/cycle";
import { displayName } from "../../shared/transactions/display-name";

export type FaturaDoBanco = {
  id: string;
  cardId: string;
  closesOn: string;
  dueOn: string | null;
  status: string;
  paidOn: string | null;
  cycleKey: string | null;
};

export type FaturaDaSerie = {
  billId: string | null;
  cycleKey: string;
  closesOn: string;
  dueOn: string | null;
  status: "aberta" | "fechada" | "paga" | "futura";
  paidOn: string | null;
  totalCents: number;
  futureItems: ItemDeParcela[];
};

export type Selo = { kind: "vence"; dueOn: string } | { kind: "paga"; cycleKey: string } | null;

export type FaturaAtual = {
  state: "aberta" | "fechada";
  billId: string;
  cycleKey: string;
  closesOn: string;
  dueOn: string | null;
  totalCents: number;
} | null;

export type SerieDoCartao = {
  faturas: FaturaDaSerie[];
  aberta: FaturaDaSerie | null;
  fechadaAPagar: FaturaDaSerie | null;
  futurasCents: number;
};

// Monta a série de um cartão. faturas são as do banco (qualquer ordem; as "futura" gravadas pelo banco não entram).
// totaisPorFatura é o total já somado no SQL, sem itens ocultos. parcelasDaBase são as linhas parceladas da fatura
// base (a aberta; sem aberta, a última fechada), e cicloDe diz o ciclo de uma data de fechamento.
export function montarSerie(
  faturas: readonly FaturaDoBanco[],
  totaisPorFatura: ReadonlyMap<string, number>,
  parcelasDaBase: readonly LinhaParcelada[],
  cicloDe: (data: string) => string,
): SerieDoCartao {
  const doBanco: FaturaDaSerie[] = faturas
    .filter((fatura) => fatura.status !== "futura")
    .map((fatura) => ({
      billId: fatura.id,
      cycleKey: fatura.cycleKey ?? cicloDe(fatura.closesOn),
      closesOn: fatura.closesOn,
      dueOn: fatura.dueOn,
      status: fatura.status as FaturaDaSerie["status"],
      paidOn: fatura.paidOn,
      totalCents: totaisPorFatura.get(fatura.id) ?? 0,
      futureItems: [],
    }))
    .sort((a, b) => a.closesOn.localeCompare(b.closesOn));

  const aberta = doBanco.find((fatura) => fatura.status === "aberta") ?? null;
  const fechadas = doBanco.filter((fatura) => fatura.status === "fechada");
  const ultimaFechada = fechadas[fechadas.length - 1] ?? null;
  const base = aberta ?? ultimaFechada;

  const projetadas: FaturaProjetada[] = projectFutureBills(
    base ? { closesOn: base.closesOn, dueOn: base.dueOn } : null,
    parcelasDaBase,
    cicloDe,
  );
  const futuras: FaturaDaSerie[] = projetadas.map((futura) => ({
    billId: null,
    cycleKey: futura.cycleKey,
    closesOn: futura.closesOn,
    dueOn: futura.dueOn,
    status: "futura",
    paidOn: null,
    totalCents: futura.totalCents,
    futureItems: futura.items,
  }));

  const todas = [...doBanco, ...futuras].sort((a, b) => a.closesOn.localeCompare(b.closesOn));
  return {
    faturas: todas,
    aberta,
    fechadaAPagar: fechadas[fechadas.length - 1] ?? null,
    futurasCents: futuras.reduce((soma, futura) => soma + futura.totalCents, 0),
  };
}

const deFatura = (fatura: FaturaDaSerie): NonNullable<FaturaAtual> => ({
  state: fatura.status === "aberta" ? "aberta" : "fechada",
  billId: fatura.billId ?? "",
  cycleKey: fatura.cycleKey,
  closesOn: fatura.closesOn,
  dueOn: fatura.dueOn,
  totalCents: fatura.totalCents,
});

// Fatura do topo: a fechada a pagar (e aí o total da nova aberta vai à parte); senão, a aberta; senão, nenhuma.
export function faturaAtual(serie: SerieDoCartao): FaturaAtual {
  if (serie.fechadaAPagar) return deFatura(serie.fechadaAPagar);
  if (serie.aberta) return deFatura(serie.aberta);
  return null;
}

// Total da nova aberta, só quando a fatura do topo é a fechada a pagar.
export function totalDaNovaAberta(serie: SerieDoCartao): number | null {
  if (!serie.fechadaAPagar || !serie.aberta) return null;
  return serie.aberta.totalCents;
}

// Selo: fechada a pagar → vence (vencimento); senão, a última paga → paga (ciclo dela); senão, nenhum.
export function selo(serie: SerieDoCartao): Selo {
  const fechada = serie.fechadaAPagar;
  if (fechada) return fechada.dueOn === null ? null : { kind: "vence", dueOn: fechada.dueOn };
  const pagas = serie.faturas.filter((fatura) => fatura.status === "paga");
  const ultimaPaga = pagas[pagas.length - 1];
  return ultimaPaga ? { kind: "paga", cycleKey: ultimaPaga.cycleKey } : null;
}

// Média das até seis últimas faturas paga ou fechada, arredondada. Sem nenhuma, a média é zero e meses é zero.
export function mediaDasSeis(serie: SerieDoCartao): { avgCents: number; meses: number } {
  const considera = serie.faturas
    .filter((fatura) => fatura.status === "paga" || fatura.status === "fechada")
    .slice(-6);
  if (considera.length === 0) return { avgCents: 0, meses: 0 };
  const soma = considera.reduce((total, fatura) => total + fatura.totalCents, 0);
  return { avgCents: Math.round(soma / considera.length), meses: considera.length };
}

// Melhor dia de compra: se o banco informou best_day, esse dia no mês do fechamento da aberta (no mês seguinte se
// best_day não passa do dia do fechamento); senão, o dia seguinte ao fechamento. Sem aberta, não há data.
export function melhorDia(bestDay: number | null, aberta: FaturaDaSerie | null): string | null {
  if (!aberta) return null;
  if (bestDay === null) return addDays(aberta.closesOn, 1);
  const [ano, mes, diaDoFechamento] = [
    Number(aberta.closesOn.slice(0, 4)),
    Number(aberta.closesOn.slice(5, 7)),
    Number(aberta.closesOn.slice(8, 10)),
  ];
  const deslocamento = bestDay <= diaDoFechamento ? 1 : 0;
  const total = ano * 12 + (mes - 1) + deslocamento;
  const anoAlvo = Math.floor(total / 12);
  const mesAlvo = (total % 12) + 1;
  const dia = Math.min(bestDay, daysInMonth(anoAlvo, mesAlvo));
  return `${anoAlvo}-${String(mesAlvo).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

// Rótulo do cartão: o banco; com dois cartões do mesmo banco no lar, acrescenta o final.
export function rotuloDoCartao(banco: string, final: string, bancoRepetido: boolean): string {
  return bancoRepetido ? `${banco} · final ${final}` : banco;
}

// Ciclo de uma data pelo calendário do lar; fora dele, o padrão do dia de início.
export function cicloDaData(calendario: readonly Ciclo[], diaDeInicio: number): (data: string) => string {
  return (data) => cycleForDate(data, calendario)?.key ?? standardCycle(data, diaDeInicio).key;
}

// Forma de um lançamento na lista (compra ou estorno), com o nome e a categoria já resolvidos.
export type LancamentoDoBanco = {
  id: string;
  originalDescription: string;
  customName: string | null;
  movement: string;
  counterpartyName: string | null;
  localDate: string;
  amountCents: number;
  installmentNumber: number | null;
  installmentTotal: number | null;
  hidden: boolean;
  categoryName: string | null;
  uncategorized: boolean;
};

export function paraCompra(lancamento: LancamentoDoBanco, rotuloDoCartao?: string) {
  return {
    id: lancamento.id,
    name: displayName(lancamento),
    localDate: lancamento.localDate,
    ...(rotuloDoCartao !== undefined ? { cardLabel: rotuloDoCartao } : {}),
    categoryName: lancamento.categoryName,
    installmentNumber: lancamento.installmentNumber,
    installmentTotal: lancamento.installmentTotal,
    amountCents: lancamento.amountCents,
    movement: lancamento.movement as "compra" | "estorno",
    hidden: lancamento.hidden,
    uncategorized: lancamento.uncategorized,
  };
}
