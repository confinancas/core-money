import { describe, expect, it } from "vitest";
import { textoDaUltimaAtualizacao } from "../../../../src/shared/sync-text";
import { dailyWindows } from "../../../../src/worker/sync/plan";
import { shouldSchedule } from "../../../../src/worker/sync/regras";

// Sincronização diária (TASK-0205): janelas, regra de agendamento e o texto "Última: …". Funções puras, sem D1.

describe("dailyWindows: conta BANK", () => {
  it("sem última sincronização: de hoje menos 10 dias até hoje", () => {
    expect(dailyWindows("BANK", null, "2026-11-10")).toEqual([{ from: "2026-10-31", to: "2026-11-10" }]);
  });

  it("última sincronização antes de hoje: parte dela menos 10 dias", () => {
    expect(dailyWindows("BANK", "2026-11-08", "2026-11-10")).toEqual([
      { from: "2026-10-29", to: "2026-11-10" },
    ]);
  });

  it("última sincronização hoje (ou depois): conta a partir de hoje, não do futuro", () => {
    expect(dailyWindows("BANK", "2026-11-10", "2026-11-10")).toEqual([
      { from: "2026-10-31", to: "2026-11-10" },
    ]);
    expect(dailyWindows("BANK", "2026-11-12", "2026-11-10")).toEqual([
      { from: "2026-10-31", to: "2026-11-10" },
    ]);
  });

  it("limite de 60 dias: uma última sincronização muito antiga não puxa mais que 60 dias", () => {
    // Hoje menos 60 dias é 11/09/2026.
    expect(dailyWindows("BANK", "2026-08-01", "2026-11-10")).toEqual([
      { from: "2026-09-11", to: "2026-11-10" },
    ]);
  });

  it("virada de ano: a conta atravessa 31/12 sem pular o ano", () => {
    expect(dailyWindows("BANK", "2027-01-02", "2027-01-03")).toEqual([
      { from: "2026-12-23", to: "2027-01-03" },
    ]);
  });
});

describe("dailyWindows: cartão", () => {
  it("45 dias até hoje (fatura aberta e última fechada) e as parcelas futuras de amanhã até +400 dias", () => {
    expect(dailyWindows("CREDIT", null, "2026-11-10")).toEqual([
      { from: "2026-09-26", to: "2026-11-10" },
      { from: "2026-11-11", to: "2027-12-15" },
    ]);
  });

  it("a última sincronização não muda a janela do cartão", () => {
    expect(dailyWindows("CREDIT", "2026-11-01", "2026-11-10")).toEqual(
      dailyWindows("CREDIT", null, "2026-11-10"),
    );
  });
});

describe("shouldSchedule: a regra de agendamento, nas quatro combinações", () => {
  it("não rodou hoje e não há aberta: agenda", () => {
    expect(shouldSchedule(false, false)).toBe(true);
  });

  it("já rodou hoje: não agenda", () => {
    expect(shouldSchedule(true, false)).toBe(false);
  });

  it("há execução aberta: não agenda", () => {
    expect(shouldSchedule(false, true)).toBe(false);
  });

  it("já rodou hoje e há aberta: não agenda", () => {
    expect(shouldSchedule(true, true)).toBe(false);
  });
});

describe("textoDaUltimaAtualizacao: o subtítulo de Configurações", () => {
  // 12:00 UTC é 09:00 em São Paulo.
  const agora = new Date("2026-11-10T15:00:00.000Z");

  it("nunca atualizou: 'Ainda não atualizou'", () => {
    expect(textoDaUltimaAtualizacao(null, agora)).toBe("Ainda não atualizou");
  });

  it("hoje: 'Última: hoje às HH:MM' (hora de São Paulo)", () => {
    // 12:10 UTC = 09:10 em São Paulo.
    expect(textoDaUltimaAtualizacao("2026-11-10T12:10:00.000Z", agora)).toBe("Última: hoje às 09:10");
  });

  it("ontem: 'Última: ontem às HH:MM'", () => {
    expect(textoDaUltimaAtualizacao("2026-11-09T12:10:00.000Z", agora)).toBe("Última: ontem às 09:10");
  });

  it("outra data: 'Última: DD/MM às HH:MM'", () => {
    expect(textoDaUltimaAtualizacao("2026-11-03T12:10:00.000Z", agora)).toBe("Última: 03/11 às 09:10");
  });

  it("a meia-noite de São Paulo é o dia de São Paulo, não o de UTC", () => {
    // 02:50 UTC de 11/11 é 23:50 de 10/11 em São Paulo: hoje, para quem está em 10/11 às 23:55.
    const duasHorasAntes = new Date("2026-11-11T02:55:00.000Z");
    expect(textoDaUltimaAtualizacao("2026-11-11T02:50:00.000Z", duasHorasAntes)).toBe(
      "Última: hoje às 23:50",
    );
  });
});
