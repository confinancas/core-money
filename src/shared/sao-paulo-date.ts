// Dia de calendário e hora em São Paulo. O ciclo do casal conta pelo dia local de São Paulo (modelo de dados).

const FUSO = "America/Sao_Paulo";

// Criados uma vez no módulo: instanciar Intl.DateTimeFormat a cada chamada é caro.
const formatoDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const formatoHora = new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, hour: "2-digit", hourCycle: "h23" });

// Datas só de calendário: o Pluggy as manda como instante à meia-noite UTC (ex.: 2026-11-10T00:00:00.000Z).
const MEIA_NOITE_UTC = /T00:00:00(\.000)?Z$/;
const SO_DATA = /^\d{4}-\d{2}-\d{2}$/;

function paraInstante(agora: Date | string): Date {
  const instante = typeof agora === "string" ? new Date(agora) : agora;
  if (Number.isNaN(instante.getTime())) throw new TypeError("data inválida");
  return instante;
}

// Data de calendário (AAAA-MM-DD) do movimento, no dia local de São Paulo.
export function toSaoPauloDate(iso: string): string {
  if (SO_DATA.test(iso) || MEIA_NOITE_UTC.test(iso)) return iso.slice(0, 10);
  return formatoDia.format(paraInstante(iso));
}

export function todayInSaoPaulo(agora: Date | string = new Date()): string {
  return formatoDia.format(paraInstante(agora));
}

// Hora cheia de São Paulo, de 0 a 23.
export function saoPauloHour(agora: Date | string = new Date()): number {
  return Number(formatoHora.format(paraInstante(agora)));
}
