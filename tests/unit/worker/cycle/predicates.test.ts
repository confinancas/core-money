import { describe, expect, it } from "vitest";
import {
  COUNTS_SQL,
  CYCLE_OUTFLOW_SQL,
  countsInCalculations,
  isCycleOutflow,
  isSpentInLimit,
  type LinhaDeGasto,
  SPENT_IN_LIMIT_SQL,
} from "../../../../src/worker/cycle/predicates";

const MOVIMENTOS = [
  "compra",
  "estorno",
  "pix_enviado",
  "pix_recebido",
  "ted_enviada",
  "ted_recebida",
  "pagamento_fatura",
  "transferencia_interna",
  "rendimento",
  "debito",
  "boleto",
  "outro",
] as const;

const linha = (extra: Partial<LinhaDeGasto>): LinhaDeGasto => ({
  movement: "compra",
  amount_cents: -1000,
  hidden: 0,
  removed_at: null,
  spend_type: null,
  ...extra,
});

describe("predicados: contam nos cálculos, saída do ciclo e gasto do anel", () => {
  it("oculta ou removida não conta em nada", () => {
    expect(countsInCalculations(linha({ hidden: 1 }))).toBe(false);
    expect(countsInCalculations(linha({ removed_at: "2026-11-09T00:00:00.000Z" }))).toBe(false);
    expect(isCycleOutflow(linha({ hidden: 1 }))).toBe(false);
    expect(isSpentInLimit(linha({ removed_at: "2026-11-09T00:00:00.000Z" }))).toBe(false);
    expect(countsInCalculations(linha({}))).toBe(true);
  });

  it("saída que conta: compra, pix, ted, débito, boleto e outro, sempre com valor negativo", () => {
    for (const movement of ["compra", "pix_enviado", "ted_enviada", "debito", "boleto", "outro"]) {
      expect(isCycleOutflow(linha({ movement, amount_cents: -500 })), movement).toBe(true);
      expect(isCycleOutflow(linha({ movement, amount_cents: 500 })), `${movement} positivo`).toBe(false);
    }
  });

  it("o estorno abate: conta com valor positivo", () => {
    expect(isCycleOutflow(linha({ movement: "estorno", amount_cents: 1500 }))).toBe(true);
    expect(isSpentInLimit(linha({ movement: "estorno", amount_cents: 1500 }))).toBe(true);
  });

  it("pagamento de fatura, transferência interna, rendimento e entradas ficam de fora de todos os tipos", () => {
    for (const movement of [
      "pagamento_fatura",
      "transferencia_interna",
      "rendimento",
      "pix_recebido",
      "ted_recebida",
    ]) {
      expect(isCycleOutflow(linha({ movement, amount_cents: 500 })), movement).toBe(false);
      expect(isCycleOutflow(linha({ movement, amount_cents: -500 })), `${movement} negativo`).toBe(false);
    }
  });

  it("Metas e Investimentos saem do gasto do anel, mas continuam na saída do ciclo; tipo nulo conta como prazeres", () => {
    expect(isCycleOutflow(linha({ spend_type: "metas" }))).toBe(true);
    expect(isSpentInLimit(linha({ spend_type: "metas" }))).toBe(false);
    expect(isSpentInLimit(linha({ spend_type: "investimentos" }))).toBe(false);
    expect(isSpentInLimit(linha({ spend_type: "fixos" }))).toBe(true);
    expect(isSpentInLimit(linha({ spend_type: null }))).toBe(true);
    expect(isSpentInLimit(linha({ spend_type: "prazeres" }))).toBe(true);
  });

  it("o predicado do gasto do anel é a saída do ciclo e o tipo fora dele, a matriz inteira", () => {
    let contados = 0;
    for (const movement of MOVIMENTOS) {
      for (const amount_cents of [-1, 1]) {
        for (const hidden of [0, 1]) {
          for (const removed_at of [null, "2026-11-09T00:00:00.000Z"]) {
            for (const spend_type of [
              null,
              "fixos",
              "conforto",
              "educacao",
              "extras",
              "prazeres",
              "metas",
              "investimentos",
            ]) {
              const l = linha({ movement, amount_cents, hidden, removed_at, spend_type });
              const espelho = isSpentInLimit(l);
              expect(espelho).toBe(
                isCycleOutflow(l) && spend_type !== "metas" && spend_type !== "investimentos",
              );
              if (espelho) contados++;
            }
          }
        }
      }
    }
    expect(contados).toBeGreaterThan(0);
  });

  it("as strings SQL usam o alias t e carregam os mesmos termos", () => {
    expect(COUNTS_SQL).toBe("t.hidden = 0 AND t.removed_at IS NULL");
    expect(CYCLE_OUTFLOW_SQL).toContain(COUNTS_SQL);
    expect(CYCLE_OUTFLOW_SQL).toContain("t.movement = 'estorno'");
    expect(SPENT_IN_LIMIT_SQL).toContain(
      "COALESCE(t.spend_type, 'prazeres') NOT IN ('metas', 'investimentos')",
    );
  });
});
