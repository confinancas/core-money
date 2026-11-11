// Teto diário de escritas da importação (TASK-0204, R2). A importação para quando as escritas do dia (usage_daily, a
// contagem da TASK-0109, dia UTC) chegam a FRACAO_DO_LIMITE_DE_ESCRITAS do limite do plano gratuito, para sobrar espaço
// ao uso do app. A execução pausada fica com o heartbeat na próxima virada do dia (00:00 UTC, 21h em Brasília), e o cron
// só a reenfileira depois dele.
import { FREE_LIMITS, usageDay } from "../../shared/usage";

// Fração do limite diário de escritas (100 mil no plano gratuito). Número proposto, pendente de confirmação.
export const FRACAO_DO_LIMITE_DE_ESCRITAS = 0.6;

// O que a leitura do contador precisa do D1. Estrutural (sem os globais do D1), para este arquivo entrar no teste de
// unidade; um D1 de verdade satisfaz.
export type LeitorDoContador = {
  prepare(sql: string): {
    bind(...valores: unknown[]): { all<T>(): Promise<{ results?: T[] }> };
  };
};

// Escritas gravadas no dia UTC de `agora`. Zero quando o dia ainda não tem linha no contador.
export async function escritasDeHoje(d1: LeitorDoContador, agora: Date): Promise<number> {
  const linhas = await d1
    .prepare("SELECT rows_written AS escritas FROM usage_daily WHERE day = ?")
    .bind(usageDay(agora))
    .all<{ escritas: number }>();
  return linhas.results?.[0]?.escritas ?? 0;
}

// Chegou ao teto? Com o limite do plano, são 60 mil escritas no dia. O limite é um parâmetro para o teste usar um
// número pequeno; em produção, fica o do plano.
export function atingiuOTeto(escritas: number, limite: number = FREE_LIMITS.rows_written): boolean {
  return escritas >= Math.round(limite * FRACAO_DO_LIMITE_DE_ESCRITAS);
}

// Pausada quando o heartbeat ainda está no futuro (a execução só volta depois dele). Sem heartbeat, não está pausada.
export function estaPausada(heartbeatAt: string | null, agora: Date): boolean {
  return heartbeatAt !== null && Date.parse(heartbeatAt) > agora.getTime();
}
