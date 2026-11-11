import { describe, expect, it } from "vitest";
import {
  deveMostrarAviso,
  fechamentoQueVale,
  recursoDeMaiorPct,
  SEGUNDA_FRASE_DO_AVISO,
  textoDoRecurso,
} from "@/usage/texto-do-uso";
import { recurso, type UsageResponse, usageBand } from "../../../src/shared/usage";

// Texto e regra do aviso de uso (TASK-0109): o texto por recurso, o recurso de maior porcentagem, e a faixa.
function usoDe(
  pcts: { requests?: number; rows_read?: number; rows_written?: number; size_bytes?: number },
  paidPlan = false,
): UsageResponse {
  const recursos = [
    recurso("requests", Math.round((pcts.requests ?? 0) * 1000)),
    recurso("rows_read", Math.round((pcts.rows_read ?? 0) * 50_000)),
    recurso("rows_written", Math.round((pcts.rows_written ?? 0) * 1000)),
    recurso("size_bytes", Math.round((pcts.size_bytes ?? 0) * 5_242_880)),
  ];
  const maior = Math.max(...recursos.map((item) => item.pct));
  return {
    day: "2026-11-10",
    paidPlan,
    band: paidPlan ? "normal" : usageBand(maior),
    resetsAt: "2026-11-11T00:00:00.000Z",
    resources: recursos,
  };
}

describe("texto por recurso", () => {
  it("leituras: '72% das leituras do banco de hoje', com a segunda frase", () => {
    const texto = textoDoRecurso(recurso("rows_read", 3_600_000));
    expect(texto).toContain("72% das leituras do banco de hoje");
    expect(texto).toContain(SEGUNDA_FRASE_DO_AVISO);
  });

  it("requisições, escritas e tamanho têm o texto da spec", () => {
    expect(textoDoRecurso(recurso("requests", 70_000))).toBe(
      `Vocês já usaram 70% das requisições de hoje do plano gratuito da Cloudflare. ${SEGUNDA_FRASE_DO_AVISO}`,
    );
    expect(textoDoRecurso(recurso("rows_written", 90_000))).toContain("90% das escritas do banco de hoje");
    expect(textoDoRecurso(recurso("size_bytes", 393_216_000))).toBe(
      "O banco já ocupa 75% dos 500 MB do plano gratuito da Cloudflare. Se encher, o app para de gravar.",
    );
  });
});

describe("recurso de maior porcentagem", () => {
  it("escolhe o recurso com a maior porcentagem", () => {
    const uso = usoDe({ requests: 12, rows_read: 91, size_bytes: 40 });
    expect(recursoDeMaiorPct(uso.resources)?.id).toBe("rows_read");
  });
});

describe("quando o aviso aparece", () => {
  it("normal não mostra; atenção e crítico mostram", () => {
    expect(deveMostrarAviso(usoDe({ rows_read: 50 }), null)).toBe(false);
    expect(deveMostrarAviso(usoDe({ rows_read: 72 }), null)).toBe(true);
    expect(deveMostrarAviso(usoDe({ rows_read: 91 }), null)).toBe(true);
  });

  it("plano pago nunca mostra, mesmo acima de 90%", () => {
    expect(deveMostrarAviso(usoDe({ rows_read: 95 }, true), null)).toBe(false);
  });

  it("nenhuma resposta ainda: não mostra", () => {
    expect(deveMostrarAviso(null, null)).toBe(false);
  });

  it("atenção fechada não volta até a faixa mudar; crítico nunca some com o fechamento", () => {
    expect(deveMostrarAviso(usoDe({ rows_read: 72 }), "atencao")).toBe(false);
    expect(deveMostrarAviso(usoDe({ rows_read: 91 }), "atencao")).toBe(true);
  });

  it("o fechamento vale só enquanto a faixa for atenção (normal e crítico o zeram)", () => {
    expect(fechamentoQueVale("atencao", "atencao")).toBe("atencao");
    expect(fechamentoQueVale("critico", "atencao")).toBeNull();
    expect(fechamentoQueVale("normal", "atencao")).toBeNull();
  });
});
