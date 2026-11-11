import { describe, expect, it } from "vitest";
import { quandoRotulo } from "@/screens/notificacoes/quando";

// Hora das notificações no dia de São Paulo (UTC-3, sem horário de verão desde 2019).
// 10/11/2026 15:00 em São Paulo = 18:00 UTC.
const AGORA = new Date("2026-11-10T18:00:00.000Z");

describe("quandoRotulo: hora no fuso de São Paulo", () => {
  it("hoje: Hoje e a hora", () => {
    expect(quandoRotulo("2026-11-10T11:00:00.000Z", AGORA)).toBe("Hoje · 08:00");
  });

  it("ontem: Ontem e a hora", () => {
    expect(quandoRotulo("2026-11-09T21:05:00.000Z", AGORA)).toBe("Ontem · 18:05");
  });

  it("outro dia do mesmo ano: DD/MM e a hora", () => {
    expect(quandoRotulo("2026-10-10T12:00:00.000Z", AGORA)).toBe("10/10 · 09:00");
  });

  it("outro ano: DD/MM/AAAA e a hora", () => {
    expect(quandoRotulo("2025-10-10T12:00:00.000Z", AGORA)).toBe("10/10/2025 · 09:00");
  });

  it("virada do dia em São Paulo: 23:59 de ontem é Ontem, mesmo com a UTC já no dia seguinte", () => {
    // 10/11 00:01 em São Paulo (03:01 UTC): o instante 09/11 23:59 em São Paulo é de ontem.
    const depois = new Date("2026-11-10T03:01:00.000Z");
    expect(quandoRotulo("2026-11-10T02:59:00.000Z", depois)).toBe("Ontem · 23:59");
  });

  it("virada do dia em São Paulo: 00:00 já é Hoje", () => {
    const depois = new Date("2026-11-10T03:01:00.000Z");
    expect(quandoRotulo("2026-11-10T03:00:00.000Z", depois)).toBe("Hoje · 00:00");
  });

  it("o dia de ontem atravessa a virada do mês", () => {
    const inicioDoMes = new Date("2026-12-01T12:00:00.000Z");
    expect(quandoRotulo("2026-11-30T20:00:00.000Z", inicioDoMes)).toBe("Ontem · 17:00");
  });

  it("data inválida lança erro", () => {
    expect(() => quandoRotulo("não é data", AGORA)).toThrow(TypeError);
  });
});
