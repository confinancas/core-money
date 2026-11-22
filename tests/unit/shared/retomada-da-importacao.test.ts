import { describe, expect, it } from "vitest";
import { fraseDaRetomada, quandoAImportacaoContinua } from "../../../src/shared/retomada-da-importacao";
import { pausaPeloTeto } from "../../../src/worker/sync/orcamento";

// Quando a importação volta (TASK-0209): a cota renova às 21h de São Paulo (00:00 UTC). A pausa das 15h volta hoje; a
// das 22h e a das 23h59 voltam amanhã. Dias de 2026-11-09 e 2026-11-10 em São Paulo (UTC-3).
const VIRADA_DO_DIA_9 = "2026-11-10T00:00:00.000Z"; // 21h de 9 de novembro em São Paulo
const VIRADA_DO_DIA_10 = "2026-11-11T00:00:00.000Z"; // 21h de 10 de novembro

describe("quandoAImportacaoContinua", () => {
  it("pausa às 15h volta hoje, às 21h", () => {
    expect(quandoAImportacaoContinua(VIRADA_DO_DIA_9, new Date("2026-11-09T18:00:00.000Z"))).toBe("hoje");
  });

  it("pausa às 20h59 ainda volta hoje, às 21h", () => {
    expect(quandoAImportacaoContinua(VIRADA_DO_DIA_9, new Date("2026-11-09T23:59:00.000Z"))).toBe("hoje");
  });

  it("pausa às 22h volta amanhã, às 21h", () => {
    expect(quandoAImportacaoContinua(VIRADA_DO_DIA_10, new Date("2026-11-10T01:00:00.000Z"))).toBe("amanhã");
  });

  it("pausa às 23h59 volta amanhã, às 21h, mesmo sendo o dia seguinte em UTC", () => {
    expect(quandoAImportacaoContinua(VIRADA_DO_DIA_10, new Date("2026-11-10T02:59:00.000Z"))).toBe("amanhã");
  });
});

describe("fraseDaRetomada", () => {
  it("escreve a frase com hoje ou amanhã e 21h", () => {
    expect(fraseDaRetomada(VIRADA_DO_DIA_9, new Date("2026-11-09T18:00:00.000Z"))).toBe(
      "A importação continua hoje às 21h.",
    );
    expect(fraseDaRetomada(VIRADA_DO_DIA_10, new Date("2026-11-10T01:00:00.000Z"))).toBe(
      "A importação continua amanhã às 21h.",
    );
  });
});

describe("regra do teto (orcamento): o plano pago não pausa", () => {
  it("no plano pago nunca pausa, nem com 60 mil nem com 100 mil escritas", () => {
    expect(pausaPeloTeto({ escritas: 60_000, paidPlan: true })).toBe(false);
    expect(pausaPeloTeto({ escritas: 100_000, paidPlan: true })).toBe(false);
  });

  it("no plano gratuito pausa em 60 mil e não pausa em 59.999", () => {
    expect(pausaPeloTeto({ escritas: 60_000, paidPlan: false })).toBe(true);
    expect(pausaPeloTeto({ escritas: 59_999, paidPlan: false })).toBe(false);
  });
});
