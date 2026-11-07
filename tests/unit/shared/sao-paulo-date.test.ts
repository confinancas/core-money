import { describe, expect, it } from "vitest";
import { saoPauloHour, todayInSaoPaulo, toSaoPauloDate } from "../../../src/shared/sao-paulo-date";

describe("toSaoPauloDate", () => {
  it.each([
    ["2026-11-10T02:59:59.000Z", "2026-11-09"],
    ["2026-11-10T03:00:00.000Z", "2026-11-10"],
    ["2026-11-10T00:00:00.000Z", "2026-11-10"],
    ["2027-01-01T01:00:00.000Z", "2026-12-31"],
  ])("converte o instante %s para o dia de São Paulo %s", (iso, esperado) => {
    expect(toSaoPauloDate(iso)).toBe(esperado);
  });

  it("trata T00:00:00Z como data de calendário, sem converter o fuso", () => {
    expect(toSaoPauloDate("2026-11-10T00:00:00Z")).toBe("2026-11-10");
  });

  it("trata a data sem horário como calendário", () => {
    expect(toSaoPauloDate("2026-11-10")).toBe("2026-11-10");
  });

  it("recusa texto que não é data", () => {
    expect(() => toSaoPauloDate("não é data")).toThrow(TypeError);
  });
});

describe("todayInSaoPaulo", () => {
  it("às 23:59 de São Paulo ainda é o dia anterior em UTC", () => {
    expect(todayInSaoPaulo(new Date("2026-11-10T02:59:00.000Z"))).toBe("2026-11-09");
  });

  it("às 00:00 de São Paulo já é o dia novo", () => {
    expect(todayInSaoPaulo(new Date("2026-11-10T03:00:00.000Z"))).toBe("2026-11-10");
  });
});

describe("saoPauloHour", () => {
  it("é 23 às 23:59 de São Paulo e 0 à meia-noite", () => {
    expect(saoPauloHour(new Date("2026-11-10T02:59:00.000Z"))).toBe(23);
    expect(saoPauloHour(new Date("2026-11-10T03:00:00.000Z"))).toBe(0);
  });

  it("converte a tarde de São Paulo", () => {
    expect(saoPauloHour("2026-11-10T17:30:00.000Z")).toBe(14);
  });
});
