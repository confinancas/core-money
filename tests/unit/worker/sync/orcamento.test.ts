import { describe, expect, it } from "vitest";
import {
  atingiuOTeto,
  estaPausada,
  estaPausadaPeloTeto,
  FRACAO_DO_LIMITE_DE_ESCRITAS,
} from "../../../../src/worker/sync/orcamento";

describe("teto diário de escritas (TASK-0204, R2)", () => {
  it("a fração é 60% e, no plano gratuito, o teto são 60 mil escritas no dia", () => {
    expect(FRACAO_DO_LIMITE_DE_ESCRITAS).toBe(0.6);
    expect(atingiuOTeto(59_999)).toBe(false);
    expect(atingiuOTeto(60_000)).toBe(true);
  });

  it("com um limite pequeno injetado, o teto segue a mesma fração", () => {
    expect(atingiuOTeto(5, 10)).toBe(false);
    expect(atingiuOTeto(6, 10)).toBe(true);
  });
});

describe("execução pausada (estaPausada)", () => {
  const agora = new Date("2026-11-10T12:00:00.000Z");

  it("sem heartbeat, a execução não está pausada", () => {
    expect(estaPausada(null, agora)).toBe(false);
  });

  it("heartbeat no futuro (a virada do dia): pausada", () => {
    expect(estaPausada("2026-11-11T00:00:00.000Z", agora)).toBe(true);
  });

  it("heartbeat no passado ou exatamente agora: não está pausada", () => {
    expect(estaPausada("2026-11-10T11:59:59.000Z", agora)).toBe(false);
    expect(estaPausada("2026-11-10T12:00:00.000Z", agora)).toBe(false);
  });
});

describe("pausa pelo teto (estaPausadaPeloTeto, TASK-0209)", () => {
  const agora = new Date("2026-11-10T12:00:00.000Z");

  it("só a virada do dia é a pausa do teto", () => {
    expect(estaPausadaPeloTeto("2026-11-11T00:00:00.000Z", agora)).toBe(true);
  });

  it("uma espera de nova tentativa (5 min, 30 min, 2 h) tem heartbeat no futuro, mas não é a pausa do teto", () => {
    expect(estaPausadaPeloTeto("2026-11-10T12:05:00.000Z", agora)).toBe(false);
    expect(estaPausadaPeloTeto("2026-11-10T12:30:00.000Z", agora)).toBe(false);
    expect(estaPausadaPeloTeto("2026-11-10T14:00:00.000Z", agora)).toBe(false);
  });

  it("sem heartbeat, ou a virada já passada, não está pausada pelo teto", () => {
    expect(estaPausadaPeloTeto(null, agora)).toBe(false);
    expect(estaPausadaPeloTeto("2026-11-10T00:00:00.000Z", agora)).toBe(false);
  });
});
