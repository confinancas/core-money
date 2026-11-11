import type { DetalheDaCompra } from "../../../shared/api/transactions";
import { daysBetween } from "../../../shared/cycle";
import { formatDayMonth, monthNamePt, weekdayPt } from "../../../shared/format/dates";
import { SPEND_TYPE_DEFS } from "../../../shared/spend-types";

// Textos da tela da compra (TASK-0403). Puro: quem chama passa o "hoje" (todayInSaoPaulo) e recebe o texto. Os textos
// são os da spec e dos protótipos; a forma de pagamento e o título seguem o movimento.

const TITULOS: Readonly<Record<string, string>> = {
  compra: "Compra",
  estorno: "Estorno",
  debito: "Débito",
  boleto: "Boleto",
  outro: "Saída",
  pix_enviado: "Pix enviado",
  ted_enviada: "TED enviada",
  pix_recebido: "Pix recebido",
  ted_recebida: "TED recebida",
};

const FORMAS: Readonly<Record<string, string>> = {
  debito: "Débito",
  boleto: "Boleto",
  outro: "Saída",
  pix_enviado: "Pix",
  ted_enviada: "TED",
  pix_recebido: "Pix",
  ted_recebida: "TED",
};

// Saída: um dos movimentos de saída com valor negativo, ou o estorno (regra movimentosComTipo, TASK-0802). Entrada
// com nome de saída (o "outro" de cashback, de valor positivo) não é saída: não tem tipo nem se oculta.
const MOVIMENTOS_DE_SAIDA: readonly string[] = [
  "compra",
  "pix_enviado",
  "ted_enviada",
  "debito",
  "boleto",
  "outro",
];

export const ehSaida = (movimento: string, valorEmCentavos: number): boolean =>
  movimento === "estorno" || (valorEmCentavos < 0 && MOVIMENTOS_DE_SAIDA.includes(movimento));

export const tituloDaCompra = (movimento: string): string => TITULOS[movimento] ?? "Transação";

// Tipo de gasto e ocultar só nas saídas (a mesma regra que a API aplica).
export const temTipoDeGasto = (detalhe: Pick<DetalheDaCompra, "movement" | "amountCents">): boolean =>
  ehSaida(detalhe.movement, detalhe.amountCents);

export const podeOcultar = (detalhe: Pick<DetalheDaCompra, "movement" | "amountCents">): boolean =>
  ehSaida(detalhe.movement, detalhe.amountCents);

// A compra de cartão não tem Metas nem Investimentos; a de conta (boleto, débito, outra saída) tem os sete.
export function tiposDaCompra(cartao: boolean) {
  return SPEND_TYPE_DEFS.filter((tipo) => !cartao || (tipo.id !== "metas" && tipo.id !== "investimentos"));
}

// Forma de pagamento: "Crédito à vista", "Crédito parcelado · parcela k de n", "Estorno", ou o nome do movimento.
export function formaDaCompra(detalhe: DetalheDaCompra): string {
  if (detalhe.movement === "estorno") return "Estorno";
  if (detalhe.card !== null) {
    if (detalhe.installment !== null) {
      return `Crédito parcelado · parcela ${detalhe.installment.number} de ${detalhe.installment.total}`;
    }
    return "Crédito à vista";
  }
  return FORMAS[detalhe.movement] ?? "Saída";
}

// "Fecha 03/11 · vence 10/11"; sem fatura (compra que ainda não entrou numa), "Sem fatura ainda".
export function textoDaFatura(fatura: DetalheDaCompra["bill"]): string {
  if (fatura === null) return "Sem fatura ainda";
  const fecha = `Fecha ${formatDayMonth(fatura.closesOn)}`;
  return fatura.dueOn !== null ? `${fecha} · vence ${formatDayMonth(fatura.dueOn)}` : fecha;
}

// "Outubro · 11/10 – 10/11", o mês por extenso com inicial maiúscula.
export function textoDoCiclo(ciclo: DetalheDaCompra["cycle"]): string {
  if (ciclo === null) return "—";
  const mes = monthNamePt(ciclo.key);
  const mesCapitalizado = mes.charAt(0).toUpperCase() + mes.slice(1);
  return `${mesCapitalizado} · ${formatDayMonth(ciclo.startsOn)} – ${formatDayMonth(ciclo.endsOn)}`;
}

const FORMATADOR_DE_HORA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// Meia-noite UTC é só a data de calendário (o agregador manda assim; regra da TASK-0202, em sao-paulo-date.ts). Não é
// um horário: a tela não diz "às 21:00" para uma compra sem hora. Outro instante, como 03:00Z (meia-noite em São Paulo),
// é um horário de verdade.
const SO_DATA_EM_UTC = /T00:00:00(\.000)?Z$/;

// Hora de São Paulo de um instante ISO ("14:32"). Sem horário no texto (só a data), não há hora.
export function horaSaoPaulo(instante: string): string | null {
  if (!/T\d{2}:\d{2}/.test(instante) || SO_DATA_EM_UTC.test(instante)) return null;
  const data = new Date(instante);
  if (Number.isNaN(data.getTime())) return null;
  const partes = FORMATADOR_DE_HORA.formatToParts(data);
  const hora = partes.find((parte) => parte.type === "hour")?.value;
  const minuto = partes.find((parte) => parte.type === "minute")?.value;
  return hora !== undefined && minuto !== undefined ? `${hora.padStart(2, "0")}:${minuto}` : null;
}

// "Hoje, 04/10 às 14:32 · Nubank final 4417"; ontem vira "Ontem"; mais antigo, o dia da semana. Conta: sem final.
export function linhaDeData(
  detalhe: Pick<DetalheDaCompra, "localDate" | "occurredAt" | "card" | "account">,
  hoje: string,
): string {
  const dias = daysBetween(detalhe.localDate, hoje);
  const dia = dias === 0 ? "Hoje" : dias === 1 ? "Ontem" : weekdayPt(detalhe.localDate);
  const hora = horaSaoPaulo(detalhe.occurredAt);
  const quando = `${dia}, ${formatDayMonth(detalhe.localDate)}${hora !== null ? ` às ${hora}` : ""}`;
  const banco =
    detalhe.card !== null
      ? `${detalhe.card.label} final ${detalhe.card.last4}`
      : detalhe.account !== null
        ? detalhe.account.label
        : null;
  return banco !== null && banco !== "" ? `${quando} · ${banco}` : quando;
}

// Nome da categoria com a mãe ("Saúde › Academia") e a linha de baixo, conforme quem categorizou e a sugestão.
export function textoDaCategoria(detalhe: DetalheDaCompra): {
  nome: string;
  sub: string;
  semCategoria: boolean;
} {
  if (detalhe.category !== null) {
    const nome = detalhe.category.parentName
      ? `${detalhe.category.parentName} › ${detalhe.category.name}`
      : detalhe.category.name;
    const sub =
      detalhe.categorizedBy === "regra"
        ? "Automática: vocês já confirmaram antes. Toque para trocar"
        : detalhe.categorizedBy === "ia"
          ? "Sugerida pela IA no histórico, sem conferência. Toque para trocar"
          : "Toque para trocar";
    return { nome, sub, semCategoria: false };
  }

  const sugestao = detalhe.aiSuggestion;
  const sub =
    sugestao === null
      ? "Toque para escolher"
      : sugestao.confidence !== null
        ? `Sugestão da IA: ${sugestao.name} (${sugestao.confidence} certeza)`
        : `Sugestão da IA: ${sugestao.name}`;
  return { nome: "Sem categoria · revisar", sub, semCategoria: true };
}
