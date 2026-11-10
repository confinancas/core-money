import { describe, expect, it } from "vitest";
import {
  billsWindow,
  type LinhaParcelada,
  projectFutureBills,
} from "../../../../src/shared/cards/installments";

// Ciclo de teste: a chave é o mês do fechamento (o calendário de verdade fica a cargo de quem chama).
const cicloDe = (data: string): string => data.slice(0, 7);
const base = { closesOn: "2026-11-03", dueOn: "2026-11-10" };

const amazon: LinhaParcelada = {
  name: "[TEST] Amazon",
  installmentNumber: 2,
  installmentTotal: 6,
  amountCents: -14990,
  hidden: false,
};
const decathlon: LinhaParcelada = {
  name: "[TEST] Decathlon",
  installmentNumber: 1,
  installmentTotal: 3,
  amountCents: -26630,
  hidden: false,
};

describe("projectFutureBills", () => {
  it("cenário 3: Amazon 2 de 6 e Decathlon 1 de 3 geram 4 faturas futuras que somam 1.132,20", () => {
    const futuras = projectFutureBills(base, [amazon, decathlon], cicloDe);

    expect(futuras.map((f) => f.totalCents)).toEqual([41620, 41620, 14990, 14990]);
    expect(futuras.reduce((soma, f) => soma + f.totalCents, 0)).toBe(113220);
    expect(futuras.map((f) => f.closesOn)).toEqual(["2026-12-03", "2027-01-03", "2027-02-03", "2027-03-03"]);
    expect(futuras.map((f) => f.dueOn)).toEqual(["2026-12-10", "2027-01-10", "2027-02-10", "2027-03-10"]);
    expect(futuras.map((f) => f.cycleKey)).toEqual(["2026-12", "2027-01", "2027-02", "2027-03"]);
  });

  it("a fatura 1 traz as parcelas 3/6 e 2/3, ordenadas pelo nome", () => {
    const [primeira] = projectFutureBills(base, [decathlon, amazon], cicloDe);
    expect(primeira?.items).toEqual([
      { name: "[TEST] Amazon", installment: 3, of: 6 },
      { name: "[TEST] Decathlon", installment: 2, of: 3 },
    ]);
  });

  it("a parcela que já é a última (k = n) não projeta nada", () => {
    const ultima = { ...amazon, installmentNumber: 6, installmentTotal: 6 };
    expect(projectFutureBills(base, [ultima], cicloDe)).toEqual([]);
  });

  it("uma compra à vista (sem parcelas) não projeta nada", () => {
    const avista = { ...amazon, installmentNumber: 1, installmentTotal: 1 };
    expect(projectFutureBills(base, [avista], cicloDe)).toEqual([]);
  });

  it("oculto não projeta parcela", () => {
    expect(projectFutureBills(base, [{ ...amazon, hidden: true }], cicloDe)).toEqual([]);
  });

  it("sem fatura-base (null), não há futuras", () => {
    expect(projectFutureBills(null, [amazon, decathlon], cicloDe)).toEqual([]);
  });

  it("sem linhas, não há futuras", () => {
    expect(projectFutureBills(base, [], cicloDe)).toEqual([]);
  });

  it("fechamento dia 31 em fevereiro prende no último dia do mês", () => {
    const janeiro = { closesOn: "2026-01-31", dueOn: "2026-02-07" };
    const [primeira] = projectFutureBills(janeiro, [amazon], cicloDe);
    expect(primeira?.closesOn).toBe("2026-02-28");
    expect(primeira?.dueOn).toBe("2026-03-07");
  });

  it("fechamento dia 31 num ano bissexto usa 29/02", () => {
    const janeiro = { closesOn: "2028-01-31", dueOn: null };
    const [primeira] = projectFutureBills(janeiro, [amazon], cicloDe);
    expect(primeira?.closesOn).toBe("2028-02-29");
    expect(primeira?.dueOn).toBeNull();
  });

  it("vencimento sem data continua sem data em todas as futuras", () => {
    const futuras = projectFutureBills({ closesOn: "2026-11-03", dueOn: null }, [amazon], cicloDe);
    expect(futuras.every((f) => f.dueOn === null)).toBe(true);
  });

  it("parcela de valor positivo (estorno parcelado) usa o módulo e não inverte a soma", () => {
    const positiva = { ...amazon, amountCents: 14990 };
    const [primeira] = projectFutureBills(base, [positiva], cicloDe);
    expect(primeira?.totalCents).toBe(14990);
  });

  it("virada de ano: fatura base em dezembro projeta em janeiro com o mesmo dia", () => {
    const dezembro = { closesOn: "2026-12-03", dueOn: "2026-12-10" };
    const [primeira] = projectFutureBills(dezembro, [amazon], cicloDe);
    expect(primeira?.closesOn).toBe("2027-01-03");
    expect(primeira?.dueOn).toBe("2027-01-10");
  });
});

describe("billsWindow", () => {
  const faturas = ["f0", "f1", "f2", "f3", "f4", "f5", "f6"];

  it("no meio da série: duas antes, a selecionada e duas depois", () => {
    expect(billsWindow(faturas, 3)).toEqual(["f1", "f2", "f3", "f4", "f5"]);
  });

  it("no começo: as posições antes da série ficam vazias (null)", () => {
    expect(billsWindow(faturas, 0)).toEqual([null, null, "f0", "f1", "f2"]);
    expect(billsWindow(faturas, 1)).toEqual([null, "f0", "f1", "f2", "f3"]);
  });

  it("no fim: as posições depois da série ficam vazias (null)", () => {
    expect(billsWindow(faturas, 6)).toEqual(["f4", "f5", "f6", null, null]);
    expect(billsWindow(faturas, 5)).toEqual(["f3", "f4", "f5", "f6", null]);
  });

  it("série vazia: cinco posições vazias", () => {
    expect(billsWindow([], 0)).toEqual([null, null, null, null, null]);
  });
});
