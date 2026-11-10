import { describe, expect, it } from "vitest";
import {
  type FaturaDoBanco,
  faturaAtual,
  mediaDasSeis,
  melhorDia,
  montarSerie,
  rotuloDoCartao,
  selo,
  totalDaNovaAberta,
} from "../../../../src/worker/cards/montagem";

const cicloDe = (data: string): string => data.slice(0, 7);

const fatura = (
  id: string,
  closesOn: string,
  status: string,
  extra: Partial<FaturaDoBanco> = {},
): FaturaDoBanco => ({
  id,
  cardId: "c1",
  closesOn,
  dueOn: extra.dueOn ?? null,
  status,
  paidOn: extra.paidOn ?? null,
  cycleKey: extra.cycleKey ?? null,
});

describe("montarSerie", () => {
  it("ignora as faturas futuras gravadas pelo banco: a projeção é a fonte das futuras", () => {
    const serie = montarSerie(
      [fatura("aberta", "2026-11-03", "aberta"), fatura("banco-futura", "2026-12-03", "futura")],
      new Map([["banco-futura", 99_900]]),
      [],
      cicloDe,
    );
    expect(serie.faturas.map((f) => f.billId)).toEqual(["aberta"]);
    expect(serie.futurasCents).toBe(0);
  });

  it("a chave do ciclo vem da fatura; sem ela, do calendário (cicloDe)", () => {
    const serie = montarSerie(
      [fatura("a", "2026-10-03", "paga", { cycleKey: "2026-09" }), fatura("b", "2026-11-03", "aberta")],
      new Map(),
      [],
      cicloDe,
    );
    expect(serie.faturas.map((f) => f.cycleKey)).toEqual(["2026-09", "2026-11"]);
  });
});

describe("selo e fatura do topo", () => {
  it("fechada a pagar: o selo é vence e o topo é a fechada, com a nova aberta à parte", () => {
    const serie = montarSerie(
      [
        fatura("f", "2026-10-06", "fechada", { dueOn: "2026-11-14" }),
        fatura("a", "2026-11-06", "aberta", { dueOn: "2026-12-14" }),
      ],
      new Map([
        ["f", 198_000],
        ["a", 41_000],
      ]),
      [],
      cicloDe,
    );
    expect(selo(serie)).toEqual({ kind: "vence", dueOn: "2026-11-14" });
    expect(faturaAtual(serie)).toMatchObject({ state: "fechada", billId: "f", totalCents: 198_000 });
    expect(totalDaNovaAberta(serie)).toBe(41_000);
  });

  it("sem fechada a pagar: o topo é a aberta, sem total da nova aberta, e o selo é a última paga", () => {
    const serie = montarSerie(
      [
        fatura("p1", "2026-08-03", "paga", { cycleKey: "2026-08" }),
        fatura("p2", "2026-09-03", "paga", { cycleKey: "2026-09" }),
        fatura("a", "2026-11-03", "aberta"),
      ],
      new Map(),
      [],
      cicloDe,
    );
    expect(faturaAtual(serie)).toMatchObject({ state: "aberta", billId: "a" });
    expect(totalDaNovaAberta(serie)).toBeNull();
    expect(selo(serie)).toEqual({ kind: "paga", cycleKey: "2026-09" });
  });

  it("fechada a pagar sem vencimento não tem selo", () => {
    const serie = montarSerie([fatura("f", "2026-10-06", "fechada")], new Map(), [], cicloDe);
    expect(selo(serie)).toBeNull();
  });

  it("sem nenhuma fatura, não há topo nem selo", () => {
    const serie = montarSerie([], new Map(), [], cicloDe);
    expect(faturaAtual(serie)).toBeNull();
    expect(selo(serie)).toBeNull();
  });
});

describe("mediaDasSeis", () => {
  it("usa só as seis últimas paga ou fechada, e conta quantas entraram", () => {
    const faturas = [1, 2, 3, 4, 5, 6, 7].map((mes) =>
      fatura(`m${mes}`, `2026-${String(mes).padStart(2, "0")}-03`, "paga", {
        cycleKey: `2026-${String(mes).padStart(2, "0")}`,
      }),
    );
    const totais = new Map(faturas.map((f, i) => [f.id, (i + 1) * 100_000]));
    const serie = montarSerie(faturas, totais, [], cicloDe);
    // Meses 2 a 7: (2+3+4+5+6+7) × 100.000 / 6 = 450.000.
    expect(mediaDasSeis(serie)).toEqual({ avgCents: 450_000, meses: 6 });
  });

  it("arredonda e não conta a aberta", () => {
    const serie = montarSerie(
      [fatura("p", "2026-10-03", "paga"), fatura("a", "2026-11-03", "aberta")],
      new Map([
        ["p", 100_001],
        ["a", 900_000],
      ]),
      [],
      cicloDe,
    );
    expect(mediaDasSeis(serie)).toEqual({ avgCents: 100_001, meses: 1 });
  });

  it("sem fatura paga ou fechada, zero", () => {
    expect(mediaDasSeis(montarSerie([fatura("a", "2026-11-03", "aberta")], new Map(), [], cicloDe))).toEqual({
      avgCents: 0,
      meses: 0,
    });
  });
});

describe("melhorDia", () => {
  const aberta = (closesOn: string) =>
    montarSerie([fatura("a", closesOn, "aberta")], new Map(), [], cicloDe).aberta;

  it("sem best_day, o dia seguinte ao fechamento", () => {
    expect(melhorDia(null, aberta("2026-11-03"))).toBe("2026-11-04");
  });

  it("best_day igual ao dia do fechamento vai para o mês seguinte", () => {
    expect(melhorDia(3, aberta("2026-11-03"))).toBe("2026-12-03");
  });

  it("best_day depois do fechamento fica no mesmo mês", () => {
    expect(melhorDia(4, aberta("2026-11-03"))).toBe("2026-11-04");
    expect(melhorDia(20, aberta("2026-11-03"))).toBe("2026-11-20");
  });

  it("o mês seguinte prende o dia no último do mês", () => {
    expect(melhorDia(31, aberta("2026-11-03"))).toBe("2026-11-30");
    expect(melhorDia(31, aberta("2026-12-03"))).toBe("2026-12-31");
  });

  it("virada de ano: dezembro com best_day antes do fechamento vai para janeiro", () => {
    expect(melhorDia(1, aberta("2026-12-03"))).toBe("2027-01-01");
  });

  it("sem fatura aberta, não há melhor dia", () => {
    expect(melhorDia(5, null)).toBeNull();
  });
});

describe("rotuloDoCartao", () => {
  it("só o banco, e com o final quando o banco se repete no lar", () => {
    expect(rotuloDoCartao("Nubank", "4417", false)).toBe("Nubank");
    expect(rotuloDoCartao("Nubank", "4417", true)).toBe("Nubank · final 4417");
  });
});
