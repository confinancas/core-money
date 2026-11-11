// Textos e regras do aviso de uso (TASK-0109), sem React: o banner, a seção e os testes usam estas funções.
import type { UsageBand, UsageResource, UsageResponse } from "../../shared/usage";

export const SEGUNDA_FRASE_DO_AVISO =
  "Se chegar a 100%, o app fica sem dados até as 21h (horário de Brasília).";

// O texto do recurso de maior porcentagem (a spec: "Texto pelo recurso de maior porcentagem").
export function recursoDeMaiorPct(recursos: readonly UsageResource[]): UsageResource | undefined {
  let maior: UsageResource | undefined;
  for (const recurso of recursos) {
    if (maior === undefined || recurso.pct > maior.pct) maior = recurso;
  }
  return maior;
}

export function textoDoRecurso(recurso: UsageResource): string {
  const pct = recurso.pct;
  switch (recurso.id) {
    case "requests":
      return `Vocês já usaram ${pct}% das requisições de hoje do plano gratuito da Cloudflare. ${SEGUNDA_FRASE_DO_AVISO}`;
    case "rows_read":
      return `Vocês já usaram ${pct}% das leituras do banco de hoje do plano gratuito da Cloudflare. ${SEGUNDA_FRASE_DO_AVISO}`;
    case "rows_written":
      return `Vocês já usaram ${pct}% das escritas do banco de hoje do plano gratuito da Cloudflare. ${SEGUNDA_FRASE_DO_AVISO}`;
    case "size_bytes":
      return `O banco já ocupa ${pct}% dos 500 MB do plano gratuito da Cloudflare. Se encher, o app para de gravar.`;
  }
}

// O aviso aparece em atenção ou crítico, no plano gratuito. A atenção pode ser fechada até a faixa mudar de nível:
// `fechadaNaFaixa` é a faixa em que a pessoa fechou (ou null). Crítico nunca some.
export function deveMostrarAviso(uso: UsageResponse | null, fechadaNaFaixa: UsageBand | null): boolean {
  if (uso === null || uso.paidPlan) return false;
  if (uso.band === "normal") return false;
  if (uso.band === "atencao" && fechadaNaFaixa === "atencao") return false;
  return true;
}

// A atenção fechada vale só enquanto a faixa for atenção: normal ou crítico zeram o fechamento.
export function fechamentoQueVale(band: UsageBand, fechadaNaFaixa: UsageBand | null): UsageBand | null {
  return band === "atencao" ? fechadaNaFaixa : null;
}
