// Teto diário de escritas da importação (TASK-0204, R2). A importação para quando as escritas do dia (usage_daily, a
// contagem da TASK-0109, dia UTC) chegam a FRACAO_DO_LIMITE_DE_ESCRITAS do limite do plano gratuito, para sobrar espaço
// ao uso do app. A execução pausada fica com o heartbeat na próxima virada do dia (00:00 UTC, 21h em Brasília), e o cron
// só a reenfileira depois dele.
import { FREE_LIMITS, resetsAt, usageDay } from "../../shared/usage";

// Fração do limite diário de escritas (100 mil no plano gratuito). 60%, confirmado em 2026-11-21.
export const FRACAO_DO_LIMITE_DE_ESCRITAS = 0.6;

// O que a leitura do contador precisa do D1. Estrutural (sem os globais do D1), para este arquivo entrar no teste de
// unidade; um D1 de verdade satisfaz.
export type LeitorDoContador = {
  prepare(sql: string): {
    bind(...valores: unknown[]): { all<T>(): Promise<{ results?: T[] }> };
  };
};

// Uma consulta só: as escritas do dia UTC (zero sem linha no contador) e o plano do lar (TASK-0209). O JOIN em households
// pela chave é o único custo a mais; a fatia continua com o mesmo número de chamadas ao D1.
const SQL_LEITURA_DO_TETO = `SELECT u.rows_written AS escritas, h.paid_plan AS paid_plan
FROM households h LEFT JOIN usage_daily u ON u.day = ?1
WHERE h.id = ?2`;

export type LeituraDoTeto = { escritas: number; paidPlan: boolean };

export async function leituraDoTeto(
  d1: LeitorDoContador,
  householdId: string,
  agora: Date,
): Promise<LeituraDoTeto> {
  const linhas = await d1.prepare(SQL_LEITURA_DO_TETO).bind(usageDay(agora), householdId).all<{
    escritas: number | null;
    paid_plan: number;
  }>();
  const linha = linhas.results?.[0];
  return { escritas: Number(linha?.escritas ?? 0), paidPlan: Number(linha?.paid_plan ?? 0) === 1 };
}

// Chegou ao teto? Com o limite do plano, são 60 mil escritas no dia. O limite é um parâmetro para o teste usar um
// número pequeno; em produção, fica o do plano.
export function atingiuOTeto(escritas: number, limite: number = FREE_LIMITS.rows_written): boolean {
  return escritas >= Math.round(limite * FRACAO_DO_LIMITE_DE_ESCRITAS);
}

// O teto vale só no plano gratuito: no plano pago (Workers Paid), a fatia não pausa pelo contador.
export function pausaPeloTeto(leitura: LeituraDoTeto, limite: number = FREE_LIMITS.rows_written): boolean {
  return !leitura.paidPlan && atingiuOTeto(leitura.escritas, limite);
}

// Pausada quando o heartbeat ainda está no futuro (a execução só volta depois dele). Sem heartbeat, não está pausada.
export function estaPausada(heartbeatAt: string | null, agora: Date): boolean {
  return heartbeatAt !== null && Date.parse(heartbeatAt) > agora.getTime();
}

// Pausada pelo teto (TASK-0209): o heartbeat é exatamente a próxima virada do dia, que é o que a fatia grava ao pausar.
// A espera de uma nova tentativa (5 min, 30 min, 2 h) também tem heartbeat no futuro, mas não é o teto: por isso não basta
// `estaPausada`.
export function estaPausadaPeloTeto(heartbeatAt: string | null, agora: Date): boolean {
  return heartbeatAt !== null && heartbeatAt === resetsAt(agora);
}
