// Datas em português para as telas (TASK-0402; reaproveitadas pela TASK-0401 e pela TASK-1001). Entrada: data de
// calendário AAAA-MM-DD, ou a chave de ciclo AAAA-MM. Nada aqui lê o relógio: quem chama passa o "hoje"
// (todayInSaoPaulo), para o resultado não mudar de um minuto para o outro sem ninguém pedir.

import { isYmd } from "../cycle";

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

const MESES_ABREVIADOS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
] as const;

const DIAS_DA_SEMANA = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const CHAVE = /^(\d{4})-(\d{2})$/;
const MS_POR_DIA = 86_400_000;

function partesDaData(data: string): { ano: number; mes: number; dia: number } {
  if (!isYmd(data)) throw new RangeError("data inválida (use AAAA-MM-DD, de calendário)");
  return { ano: Number(data.slice(0, 4)), mes: Number(data.slice(5, 7)), dia: Number(data.slice(8, 10)) };
}

function mesDaChave(chave: string): number {
  const casa = CHAVE.exec(chave) ?? DATA.exec(chave);
  const mes = casa ? Number(casa[2]) : Number.NaN;
  if (!(mes >= 1 && mes <= 12)) throw new RangeError("chave de ciclo inválida (use AAAA-MM)");
  return mes;
}

// Dia da semana e diferença em dias, em UTC: sem fuso e sem horário de verão.
const instanteUtc = (data: string): number => {
  const { ano, mes, dia } = partesDaData(data);
  return Date.UTC(ano, mes - 1, dia);
};

// Mês por extenso, em minúsculas: "outubro". Aceita a chave AAAA-MM do ciclo.
export function monthNamePt(cycleKey: string): string {
  return MESES[mesDaChave(cycleKey) - 1] as string;
}

// Mês abreviado com a inicial maiúscula, a partir de uma data: "Out".
export function monthAbbrPt(data: string): string {
  const { mes } = partesDaData(data);
  const abreviado = MESES_ABREVIADOS[mes - 1] as string;
  return abreviado.charAt(0).toUpperCase() + abreviado.slice(1);
}

// Mês abreviado com o ano curto, a partir da chave AAAA-MM: "out/26" (o rótulo das setas do cartão).
export function monthYearShortPt(cycleKey: string): string {
  const casa = CHAVE.exec(cycleKey);
  if (!casa) throw new RangeError("chave de ciclo inválida (use AAAA-MM)");
  const mes = mesDaChave(cycleKey);
  return `${MESES_ABREVIADOS[mes - 1]}/${casa[1]?.slice(2)}`;
}

// Dia e mês com dois dígitos: "03/11".
export function formatDayMonth(data: string): string {
  const { mes, dia } = partesDaData(data);
  return `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}`;
}

// "Hoje", "Ontem" ou DD/MM. A diferença é contada em dias de calendário, então a virada do ano também vale.
export function relativeDayPt(data: string, hoje: string): string {
  const dias = Math.round((instanteUtc(hoje) - instanteUtc(data)) / MS_POR_DIA);
  if (dias === 0) return "Hoje";
  if (dias === 1) return "Ontem";
  return formatDayMonth(data);
}

// Dia da semana com a inicial maiúscula: "Sábado".
export function weekdayPt(data: string): string {
  const dia = new Date(instanteUtc(data)).getUTCDay();
  return DIAS_DA_SEMANA[dia] as string;
}
