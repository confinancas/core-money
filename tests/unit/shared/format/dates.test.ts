import { describe, expect, it } from "vitest";
import {
  formatDayMonth,
  monthAbbrPt,
  monthNamePt,
  monthYearShortPt,
  relativeDayPt,
  weekdayPt,
} from "../../../../src/shared/format/dates";

describe("monthNamePt", () => {
  it("devolve o mês por extenso, em minúsculas, da chave do ciclo", () => {
    expect(monthNamePt("2026-10")).toBe("outubro");
    expect(monthNamePt("2026-01")).toBe("janeiro");
    expect(monthNamePt("2026-03")).toBe("março");
    expect(monthNamePt("2026-12")).toBe("dezembro");
  });

  it("aceita também uma data de calendário e recusa o que não é mês", () => {
    expect(monthNamePt("2026-11-03")).toBe("novembro");
    expect(() => monthNamePt("2026-13")).toThrow(RangeError);
    expect(() => monthNamePt("novembro")).toThrow(RangeError);
  });
});

describe("monthAbbrPt", () => {
  it("abrevia o mês da data com a inicial maiúscula", () => {
    expect(monthAbbrPt("2026-10-31")).toBe("Out");
    expect(monthAbbrPt("2026-01-01")).toBe("Jan");
    expect(monthAbbrPt("2026-05-09")).toBe("Mai");
  });
});

describe("monthYearShortPt", () => {
  it("devolve o rótulo mmm/aa das setas do cartão", () => {
    expect(monthYearShortPt("2026-10")).toBe("out/26");
    expect(monthYearShortPt("2027-01")).toBe("jan/27");
  });
});

describe("formatDayMonth", () => {
  it("usa DD/MM com zero à esquerda", () => {
    expect(formatDayMonth("2026-11-03")).toBe("03/11");
    expect(formatDayMonth("2026-12-25")).toBe("25/12");
  });

  it("recusa data que não é de calendário", () => {
    expect(() => formatDayMonth("2026-02-30")).toThrow(RangeError);
    expect(() => formatDayMonth("03/11")).toThrow(RangeError);
  });
});

describe("relativeDayPt", () => {
  it("diz Hoje para o mesmo dia e Ontem para o dia anterior", () => {
    expect(relativeDayPt("2026-11-10", "2026-11-10")).toBe("Hoje");
    expect(relativeDayPt("2026-11-09", "2026-11-10")).toBe("Ontem");
  });

  it("nos outros dias, DD/MM", () => {
    expect(relativeDayPt("2026-11-08", "2026-11-10")).toBe("08/11");
    expect(relativeDayPt("2026-11-11", "2026-11-10")).toBe("11/11");
  });

  it("atravessa a virada do ano: ontem é 31/12 para 01/01", () => {
    expect(relativeDayPt("2026-12-31", "2027-01-01")).toBe("Ontem");
    expect(relativeDayPt("2026-12-30", "2027-01-01")).toBe("30/12");
  });

  it("atravessa fevereiro bissexto", () => {
    expect(relativeDayPt("2028-02-29", "2028-03-01")).toBe("Ontem");
    expect(relativeDayPt("2028-02-28", "2028-03-01")).toBe("28/02");
  });
});

describe("weekdayPt", () => {
  it("devolve o dia da semana com a inicial maiúscula", () => {
    // 2026-11-07 é um sábado, 2026-11-08 um domingo.
    expect(weekdayPt("2026-11-07")).toBe("Sábado");
    expect(weekdayPt("2026-11-08")).toBe("Domingo");
    expect(weekdayPt("2026-11-09")).toBe("Segunda-feira");
  });
});
