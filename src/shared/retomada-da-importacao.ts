// Quando a importação pausada pelo teto volta (TASK-0209). A cota renova à 00:00 UTC, que é 21h em São Paulo. Uma pausa
// às 15h volta hoje às 21h; uma pausa às 22h volta amanhã às 21h. "Hoje" ou "amanhã" sai de pausadaAte comparado ao dia
// de São Paulo de agora.
import { todayInSaoPaulo } from "./sao-paulo-date";

export function quandoAImportacaoContinua(pausadaAte: string, agora: Date): "hoje" | "amanhã" {
  return todayInSaoPaulo(new Date(pausadaAte)) === todayInSaoPaulo(agora) ? "hoje" : "amanhã";
}

export function fraseDaRetomada(pausadaAte: string, agora: Date): string {
  return `A importação continua ${quandoAImportacaoContinua(pausadaAte, agora)} às 21h.`;
}
