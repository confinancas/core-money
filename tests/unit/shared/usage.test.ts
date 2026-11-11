import { describe, expect, it } from "vitest";
import {
  bandaDoUso,
  FREE_LIMITS,
  formataMegabytes,
  formataMilhar,
  recurso,
  resetsAt,
  usageBand,
  usageDay,
  usagePct,
} from "../../../src/shared/usage";

// Faixas e contas do aviso de uso (TASK-0109, cenários 6 e 7 e os limites da spec).
describe("porcentagem e faixa", () => {
  it("69% fica normal; 70% vira atenção; 89% continua atenção; 90% vira crítico", () => {
    expect(usageBand(usagePct(69, 100))).toBe("normal");
    expect(usageBand(usagePct(70, 100))).toBe("atencao");
    expect(usageBand(usagePct(89, 100))).toBe("atencao");
    expect(usageBand(usagePct(90, 100))).toBe("critico");
  });

  it("o piso: 6.999 de 10.000 é 69%, e não 70%", () => {
    expect(usagePct(6999, 10000)).toBe(69);
    expect(usagePct(7000, 10000)).toBe(70);
  });

  it("a faixa do conjunto segue a maior porcentagem", () => {
    const recursos = [recurso("requests", 100), recurso("rows_read", 3_600_000), recurso("rows_written", 5)];
    expect(bandaDoUso(recursos, false)).toBe("atencao");
  });

  it("com o plano pago a faixa é sempre normal, mesmo acima de 90%", () => {
    const recursos = [recurso("rows_read", 4_900_000)];
    expect(bandaDoUso(recursos, true)).toBe("normal");
  });

  it("só as leituras do banco são estimativas", () => {
    expect(recurso("rows_read", 1)).toMatchObject({ estimated: true, limit: FREE_LIMITS.rows_read });
    expect(recurso("requests", 1)).not.toHaveProperty("estimated");
  });
});

// Virada do dia: os limites zeram às 00:00 UTC (cenário 4 no que cabe à conta).
describe("dia e reinício", () => {
  it("resetsAt é a próxima 00:00 UTC, perto da meia-noite", () => {
    expect(resetsAt(new Date("2026-11-02T23:59:59.999Z"))).toBe("2026-11-03T00:00:00.000Z");
    expect(resetsAt(new Date("2026-11-03T00:00:00.000Z"))).toBe("2026-11-04T00:00:00.000Z");
    expect(resetsAt(new Date("2026-12-31T23:30:00.000Z"))).toBe("2027-01-01T00:00:00.000Z");
  });

  it("o dia de uso é o UTC: 23:59 e 00:01 UTC caem em dias diferentes", () => {
    expect(usageDay(new Date("2026-11-02T23:59:00.000Z"))).toBe("2026-11-02");
    expect(usageDay(new Date("2026-11-03T00:01:00.000Z"))).toBe("2026-11-03");
  });
});

describe("formatos", () => {
  it("milhar com ponto", () => {
    expect(formataMilhar(3_600_000)).toBe("3.600.000");
    expect(formataMilhar(999)).toBe("999");
    expect(formataMilhar(0)).toBe("0");
  });

  it("tamanho em MB com vírgula", () => {
    expect(formataMegabytes(168_000)).toBe("0,2 MB");
    expect(formataMegabytes(393_216_000)).toBe("375 MB");
  });
});
