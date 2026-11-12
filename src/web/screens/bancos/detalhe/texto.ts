// Textos da tela do banco conectado (TASK-0206) que não são regra de domínio: a última atualização com sucesso e a
// data curta. A hora e o dia são os de São Paulo.
import { horaDeSaoPaulo } from "../../../../shared/bank-item-view";
import { todayInSaoPaulo } from "../../../../shared/sao-paulo-date";

// "DD/MM" a partir de AAAA-MM-DD.
export function diaEMes(dia: string): string {
  const [, mes, diaDoMes] = dia.split("-");
  return `${diaDoMes}/${mes}`;
}

export function horaDaUltimaComSucesso(lastSyncAt: string | null): string {
  if (lastSyncAt === null) return "Ainda não atualizou";
  const dia = todayInSaoPaulo(new Date(lastSyncAt));
  return `Última atualização com sucesso às ${horaDeSaoPaulo(lastSyncAt)} do dia ${diaEMes(dia)}`;
}
