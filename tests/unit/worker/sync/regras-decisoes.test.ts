import { describe, expect, it } from "vitest";
import { conciliaAposExecucao } from "../../../../src/worker/sync/regras";

// Decisão do afterRun (TASK-0205, A4, F8): a importação não concilia de novo (as fatias já fizeram); a diária e a manual
// concilian a janela de hoje.
describe("conciliaAposExecucao", () => {
  it("a importação não concilia no afterRun", () => {
    expect(conciliaAposExecucao("historico")).toBe(false);
  });

  it("a diária e a manual conciliam a janela de hoje", () => {
    expect(conciliaAposExecucao("diaria")).toBe(true);
    expect(conciliaAposExecucao("manual")).toBe(true);
  });
});
