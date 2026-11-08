import { describe, expect, it } from "vitest";
import { shouldRenew } from "../../../src/worker/auth/renovacao";

// Renovação da sessão (TASK-0104): só com a última visita de mais de 24 h. Abaixo disso, nenhuma escrita.
const AGORA = new Date("2026-11-08T12:00:00.000Z");
const ha = (horas: number) => new Date(AGORA.getTime() - horas * 60 * 60 * 1000).toISOString();

describe("shouldRenew", () => {
  it("não renova com 23 h de uso", () => {
    expect(shouldRenew(ha(23), AGORA)).toBe(false);
  });

  it("não renova com exatamente 24 h (a regra é 'mais de 24 h')", () => {
    expect(shouldRenew(ha(24), AGORA)).toBe(false);
  });

  it("renova com 25 h de uso", () => {
    expect(shouldRenew(ha(25), AGORA)).toBe(true);
  });

  it("não renova com 1 h de uso (nenhuma escrita)", () => {
    expect(shouldRenew(ha(1), AGORA)).toBe(false);
  });
});
