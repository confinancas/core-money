import { describe, expect, it } from "vitest";
import { DIAS_DO_CICLO, subtituloDoCiclo } from "@/screens/configuracoes/cycle-subtitle";

// Subtítulo de "Início do ciclo" (TASK-0107): do dia D ao dia D−1 do mês seguinte, e com D = 1 o ciclo vai ao último
// dia do mês.
describe("subtítulo do início do ciclo", () => {
  it("dia 11: do dia 11 ao dia 10 do mês seguinte", () => {
    expect(subtituloDoCiclo(11)).toBe("Do dia 11 ao dia 10 do mês seguinte");
  });

  it("dia 1: do dia 1 ao último dia do mês", () => {
    expect(subtituloDoCiclo(1)).toBe("Do dia 1 ao último dia do mês");
  });

  it("dia 28: do dia 28 ao dia 27 do mês seguinte", () => {
    expect(subtituloDoCiclo(28)).toBe("Do dia 28 ao dia 27 do mês seguinte");
  });
});

describe("dias oferecidos no seletor", () => {
  it("vai de 1 a 28, o mesmo intervalo do servidor", () => {
    expect(DIAS_DO_CICLO[0]).toBe(1);
    expect(DIAS_DO_CICLO[DIAS_DO_CICLO.length - 1]).toBe(28);
    expect(DIAS_DO_CICLO).toHaveLength(28);
  });
});
