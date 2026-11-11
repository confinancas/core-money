// Textos e tons das telas de cartões (TASK-0402). Puro: quem chama passa o "hoje" (todayInSaoPaulo) e recebe o texto.

import { daysBetween } from "../../../shared/cycle";
import { formatDayMonth, monthNamePt } from "../../../shared/format/dates";
import { pctChange } from "../../components/charts/scale";

export type TomDoSelo = "aviso" | "falta" | "sucesso";

export function textoDeCartoes(quantidade: number): string {
  return quantidade === 1 ? "1 cartão" : `${quantidade} cartões`;
}

function capitalizada(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Selo de vencimento: "Vence em N dias", "Vence amanhã", "Vence hoje" (aviso) ou "Venceu em DD/MM" (falta).
export function seloDeVencimento(vencimento: string, hoje: string): { texto: string; tom: TomDoSelo } {
  const dias = daysBetween(hoje, vencimento);
  if (dias < 0) return { texto: `Venceu em ${formatDayMonth(vencimento)}`, tom: "falta" };
  if (dias === 0) return { texto: "Vence hoje", tom: "aviso" };
  if (dias === 1) return { texto: "Vence amanhã", tom: "aviso" };
  return { texto: `Vence em ${dias} dias`, tom: "aviso" };
}

// Selo da última fatura paga: "Setembro paga", em verde.
export function seloDePaga(cycleKey: string): { texto: string; tom: TomDoSelo } {
  return { texto: `${capitalizada(monthNamePt(cycleKey))} paga`, tom: "sucesso" };
}

// Número com uma casa decimal e vírgula: 12.3 → "12,3".
export function percentualPt(valor: number): string {
  return valor.toFixed(1).replace(".", ",");
}

// Pílula da variação contra a fatura anterior: ▲ em alta (aviso), ▼ em queda (sucesso). Sem base, nada.
export function pilulaDeVariacao(
  atualCents: number,
  anteriorCents: number,
): { texto: string; tom: TomDoSelo } | null {
  const variacao = pctChange(atualCents, anteriorCents);
  if (variacao === null) return null;
  if (variacao > 0) return { texto: `▲ ${percentualPt(variacao)}%`, tom: "aviso" };
  if (variacao < 0) return { texto: `▼ ${percentualPt(Math.abs(variacao))}%`, tom: "sucesso" };
  return { texto: `${percentualPt(0)}%`, tom: "sucesso" };
}

// "Média 6 meses", "Média 1 mês", "Média 3 meses". Sem meses, o bloco some (quem chama decide).
export function textoDaMedia(meses: number): string {
  return meses === 1 ? "Média 1 mês" : `Média ${meses} meses`;
}

// Porcentagem do limite usado: (limite − disponível) / limite, de 0 a 100.
export function limiteUsadoPct(limiteCents: number, disponivelCents: number): number {
  if (!(limiteCents > 0)) return 0;
  const usado = ((limiteCents - disponivelCents) / limiteCents) * 100;
  return Math.min(100, Math.max(0, usado));
}

// Rótulo da lista de parcelas futuras da fatura: "Amazon 3/6 · Decathlon 2/3", com " · +N" depois de três.
export function textoDasParcelas(
  itens: readonly { name: string; installment: number; of: number }[],
): string {
  const primeiros = itens.slice(0, 3).map((item) => `${item.name} ${item.installment}/${item.of}`);
  const resto = itens.length - primeiros.length;
  return resto > 0 ? `${primeiros.join(" · ")} · +${resto}` : primeiros.join(" · ");
}

// Contagem dos lançamentos da fatura aberta: "3 lançamentos", "1 lançamento", com "· 1 fora" quando há ocultos.
export function textoDosLancamentos(visiveis: number, ocultos: number): string {
  const base = visiveis === 1 ? "1 lançamento" : `${visiveis} lançamentos`;
  if (ocultos === 0) return base;
  return `${base} · ${ocultos} fora`;
}
