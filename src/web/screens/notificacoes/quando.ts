// Rótulo de hora das notificações (TASK-0701), no dia local de São Paulo: "Hoje · 08:00", "Ontem · 18:05", "10/10 ·
// 09:00"; de outro ano, "10/10/2025 · 09:00". O fuso é o de São Paulo, nunca o do aparelho.

const FUSO = "America/Sao_Paulo";

// Criados uma vez no módulo: instanciar Intl.DateTimeFormat a cada chamada é caro.
const formatoDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const formatoHora = new Intl.DateTimeFormat("en-GB", {
  timeZone: FUSO,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// "AAAA-MM-DD" do instante, no dia de São Paulo.
function diaDe(instante: Date): string {
  return formatoDia.format(instante);
}

// O dia anterior a uma data de calendário (AAAA-MM-DD), feito em UTC para não depender do fuso do aparelho.
function diaAnterior(dia: string): string {
  const [ano, mes, diaDoMes] = dia.split("-").map(Number);
  return new Date(Date.UTC(ano ?? 0, (mes ?? 1) - 1, (diaDoMes ?? 1) - 1)).toISOString().slice(0, 10);
}

export function quandoRotulo(iso: string, agora: Date): string {
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) throw new TypeError("data inválida");
  const dia = diaDe(instante);
  const hoje = diaDe(agora);
  const hora = formatoHora.format(instante);

  if (dia === hoje) return `Hoje · ${hora}`;
  if (dia === diaAnterior(hoje)) return `Ontem · ${hora}`;

  const [ano, mes, diaDoMes] = dia.split("-");
  const anoDeHoje = hoje.slice(0, 4);
  const data = ano === anoDeHoje ? `${diaDoMes}/${mes}` : `${diaDoMes}/${mes}/${ano}`;
  return `${data} · ${hora}`;
}
