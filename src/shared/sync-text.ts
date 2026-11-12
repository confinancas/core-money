// Texto da última atualização (TASK-0205), para Configurações. Dia e hora de São Paulo; compartilhado com o teste de unidade.
import { todayInSaoPaulo } from "./sao-paulo-date";

const formatoHora = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// Dia anterior de uma data AAAA-MM-DD (calendário, sem fuso).
function diaAnterior(dia: string): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

export function textoDaUltimaAtualizacao(lastSyncAt: string | null, agora: Date): string {
  if (lastSyncAt === null) return "Ainda não atualizou";
  const dia = todayInSaoPaulo(new Date(lastSyncAt));
  const hoje = todayInSaoPaulo(agora);
  const hora = formatoHora.format(new Date(lastSyncAt));
  if (dia === hoje) return `Última: hoje às ${hora}`;
  if (dia === diaAnterior(hoje)) return `Última: ontem às ${hora}`;
  const [, mes, diaDoMes] = dia.split("-");
  return `Última: ${diaDoMes}/${mes} às ${hora}`;
}
