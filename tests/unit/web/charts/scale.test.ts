import { describe, expect, it } from "vitest";
import { barHeightPx, compactBRL, pctChange, scaleMax } from "../../../../src/web/components/charts/scale";

describe("compactBRL", () => {
  it("formata centavos em reais compactos, com vírgula decimal", () => {
    expect(compactBRL(48_000)).toBe("480");
    expect(compactBRL(85_000)).toBe("850");
    expect(compactBRL(290_000)).toBe("2,9K");
    expect(compactBRL(2_422_000)).toBe("24K");
    expect(compactBRL(120_000_000)).toBe("1,2M");
  });

  it("não deixa 999,60 virar 1000: vira 1,0K", () => {
    expect(compactBRL(99_960)).toBe("1,0K");
  });

  it("dez mil ou mais, em mil sem casa decimal", () => {
    expect(compactBRL(1_000_000)).toBe("10K");
    expect(compactBRL(9_960_000)).toBe("100K");
  });

  it("zero e valores pequenos", () => {
    expect(compactBRL(0)).toBe("0");
    expect(compactBRL(50)).toBe("1");
  });
});

describe("scaleMax", () => {
  it("usa o maior valor com 15% de folga", () => {
    expect(scaleMax([100, 250, 80])).toBeCloseTo(287.5);
  });

  it("sem valores positivos, o teto é zero", () => {
    expect(scaleMax([])).toBe(0);
    expect(scaleMax([0, 0])).toBe(0);
  });

  it("a folga pode ser trocada", () => {
    expect(scaleMax([200], 1)).toBe(200);
  });
});

describe("barHeightPx", () => {
  it("proporcional ao teto, dentro dos limites", () => {
    expect(barHeightPx(50, 100, 120, 6)).toBe(60);
    expect(barHeightPx(100, 100, 120, 6)).toBe(120);
  });

  it("uma barra pequena nunca fica abaixo do mínimo", () => {
    expect(barHeightPx(1, 1000, 120, 6)).toBe(6);
    expect(barHeightPx(0, 1000, 120, 6)).toBe(6);
  });

  it("sem teto, a barra fica no mínimo", () => {
    expect(barHeightPx(500, 0, 120, 6)).toBe(6);
  });

  it("nunca passa do máximo, mesmo com valor acima do teto", () => {
    expect(barHeightPx(900, 100, 120, 6)).toBe(120);
  });
});

describe("pctChange", () => {
  it("variação com uma casa decimal: setembro 2.870,40 contra agosto 3.120,00 dá -8,0%", () => {
    expect(pctChange(287_040, 312_000)).toBe(-8);
  });

  it("alta com uma casa decimal", () => {
    expect(pctChange(112_300, 100_000)).toBe(12.3);
  });

  it("sem base (anterior zero), não há variação", () => {
    expect(pctChange(50_000, 0)).toBeNull();
  });

  it("igual ao anterior dá zero", () => {
    expect(pctChange(1000, 1000)).toBe(0);
  });
});
