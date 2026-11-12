import { describe, expect, it } from "vitest";
import {
  DIAS_DO_FUTURO,
  fatiasDeFaturas,
  futureWindow,
  historyWindows,
  lerCursor,
  MESES,
  progressPct,
  somaDias,
  somaMeses,
  totalDeFatias,
} from "../../../../src/worker/sync/plan";

// Confere que as janelas são contíguas, sem buraco nem sobreposição, e que cobrem [inicio, fim] inteiro.
function conferirCobertura(janelas: { from: string; to: string }[], inicio: string, fim: string) {
  expect(janelas[0]?.to).toBe(fim);
  expect(janelas.at(-1)?.from).toBe(inicio);
  for (let i = 0; i < janelas.length - 1; i++) {
    const atual = janelas[i];
    const proxima = janelas[i + 1];
    expect(atual && proxima && somaDias(proxima.to, 1)).toBe(atual?.from);
  }
  for (const janela of janelas) expect(janela.from <= janela.to).toBe(true);
}

describe("historyWindows", () => {
  it("cobre 12 meses em janelas contíguas, a primeira termina hoje e a mais nova vem primeiro", () => {
    const hoje = "2026-11-11";
    const janelas = historyWindows(hoje, MESES);
    conferirCobertura(janelas, "2025-11-12", "2026-11-11");
    expect(janelas[0]).toEqual({ from: "2026-10-13", to: "2026-11-11" });
    expect(janelas.every((janela) => janela.to.length === 10)).toBe(true);
  });

  it("atravessa a virada do ano sem buraco", () => {
    const janelas = historyWindows("2026-01-10", 12);
    conferirCobertura(janelas, "2025-01-11", "2026-01-10");
    expect(
      janelas.some((janela) => janela.from.startsWith("2025-12") && janela.to.startsWith("2026-01")),
    ).toBe(true);
  });

  it("trata 29 de fevereiro: 12 meses antes de 2028-02-29 começam em 2027-03-01", () => {
    const janelas = historyWindows("2028-02-29", 12);
    conferirCobertura(janelas, "2027-03-01", "2028-02-29");
  });

  it("não tem janela com menos de um dia e cada janela tem no máximo 30 dias", () => {
    const janelas = historyWindows("2026-03-31", 12);
    for (const janela of janelas) {
      const dias =
        (Date.parse(`${janela.to}T00:00:00Z`) - Date.parse(`${janela.from}T00:00:00Z`)) / 86_400_000;
      expect(dias).toBeGreaterThanOrEqual(0);
      expect(dias).toBeLessThanOrEqual(29);
    }
  });
});

describe("somaMeses e somaDias", () => {
  it("retrocede um mês no fim do mês com o último dia do destino", () => {
    expect(somaMeses("2026-03-31", -1)).toBe("2026-02-28");
    expect(somaMeses("2028-03-31", -1)).toBe("2028-02-29");
  });

  it("soma dias atravessando o ano", () => {
    expect(somaDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(somaDias("2027-01-01", -1)).toBe("2026-12-31");
  });
});

describe("futureWindow", () => {
  it("vai de amanhã até +400 dias", () => {
    const janela = futureWindow("2026-11-11");
    expect(janela.from).toBe("2026-11-12");
    expect(janela.to).toBe(somaDias("2026-11-11", DIAS_DO_FUTURO));
  });
});

describe("progressPct", () => {
  it("zero quando não há total nem feito", () => {
    expect(progressPct(0, 0)).toBe(0);
    expect(progressPct(0, 14)).toBe(0);
  });

  it("1 de 14 vira 7%", () => {
    expect(progressPct(1, 14)).toBe(7);
  });

  it("14 de 14 fica em 99: o 100 só entra no fim da execução", () => {
    expect(progressPct(14, 14)).toBe(99);
  });
});

describe("fatias de faturas e total", () => {
  it("três cartões por fatia, e pelo menos uma fatia", () => {
    expect(fatiasDeFaturas(0)).toBe(1);
    expect(fatiasDeFaturas(3)).toBe(1);
    expect(fatiasDeFaturas(4)).toBe(2);
  });

  it("total = inicio + faturas + janelas (2 + janelas com um cartão)", () => {
    expect(totalDeFatias(1, 20)).toBe(22);
  });
});

describe("lerCursor", () => {
  it("preenche o que a primeira gravação ainda não tem", () => {
    expect(lerCursor('{"seq":0,"phase":"inicio"}')).toEqual({
      seq: 0,
      phase: "inicio",
      accounts: [],
      a: 0,
      w: 0,
      pageCursor: null,
      offset: 0,
      inserted: 0,
      lidas: 0,
      conferir: false,
      instavelNoPluggy: false,
    });
  });
});
