import { describe, expect, it } from "vitest";
import {
  chaveDoNome,
  type ExistingFixedIncome,
  expectedPerCycle,
  validateFixedIncomeInput,
} from "../../src/shared/fixed-incomes";

// Renda fixa (TASK-0901): cada linha da tabela de validação da spec, e o previsto por ciclo (só ativas, por moeda).
// Nomes e textos são [TEST].

const base = {
  name: "[TEST] Salário CLT",
  currency: "BRL",
  amountCents: 500000,
  usualDay: 5,
  arrival: "auto",
  statementText: "SALARIO",
  keptUsdIsInvestment: true,
};
const comCampo = (campo: string, valor: unknown) => ({ ...base, [campo]: valor });
const semNomes: ExistingFixedIncome[] = [];
const CAMPOS_OBRIGATORIOS = ["amountCents", "arrival", "currency", "name", "usualDay"];

function erroDe(entrada: unknown, existentes: ExistingFixedIncome[] = semNomes, id?: string) {
  const resultado = validateFixedIncomeInput(entrada, existentes, id);
  if (resultado.ok) throw new Error("esperava erro de validação");
  return resultado.fields;
}

describe("validateFixedIncomeInput: tabela de validação", () => {
  it("aceita a renda CLT da spec e devolve os valores normalizados", () => {
    const resultado = validateFixedIncomeInput(base, semNomes);

    expect(resultado).toEqual({
      ok: true,
      values: {
        name: "[TEST] Salário CLT",
        currency: "BRL",
        amountCents: 500000,
        usualDay: 5,
        arrival: "auto",
        statementText: "SALARIO",
        keptUsdIsInvestment: false,
      },
    });
  });

  it("nome vazio ou só espaços: 'Dê um nome à renda.'", () => {
    expect(erroDe(comCampo("name", "   "))).toEqual({ name: "Dê um nome à renda." });
    expect(erroDe(comCampo("name", undefined))).toEqual({ name: "Dê um nome à renda." });
  });

  it("nome com mais de 40 caracteres: 'Use até 40 caracteres.'; 40 passa", () => {
    expect(erroDe(comCampo("name", "a".repeat(41)))).toEqual({ name: "Use até 40 caracteres." });
    expect(validateFixedIncomeInput(comCampo("name", "a".repeat(40)), semNomes).ok).toBe(true);
  });

  it("nome igual ao de outra renda ativa, sem acento e sem caixa: 'Já existe uma renda fixa com esse nome.'", () => {
    const existentes = [{ id: "outra", name: "Salário CLT" }];

    expect(erroDe(comCampo("name", "salario clt"), existentes)).toEqual({
      name: "Já existe uma renda fixa com esse nome.",
    });
  });

  it("na edição, a própria renda não conta como repetida", () => {
    const existentes = [{ id: "minha", name: "Salário CLT" }];

    expect(validateFixedIncomeInput(comCampo("name", "salário clt"), existentes, "minha").ok).toBe(true);
  });

  it("moeda fora de BRL e USD: 'Escolha a moeda.'", () => {
    expect(erroDe(comCampo("currency", "EUR"))).toEqual({ currency: "Escolha a moeda." });
  });

  it("valor ausente, zero, negativo, fracionado ou acima de 100.000.000,00: 'Informe o valor por ciclo.'", () => {
    for (const valor of [undefined, null, 0, -1, 1.5, 10_000_000_001, "5000"]) {
      expect(erroDe(comCampo("amountCents", valor))).toEqual({ amountCents: "Informe o valor por ciclo." });
    }
  });

  it("valor exatamente em 100.000.000,00 passa", () => {
    expect(validateFixedIncomeInput(comCampo("amountCents", 10_000_000_000), semNomes).ok).toBe(true);
  });

  it("dia fora de 1 a 31: 'Dia inválido.'; 1 e 31 passam", () => {
    for (const dia of [0, 32, 5.5, undefined]) {
      expect(erroDe(comCampo("usualDay", dia))).toEqual({ usualDay: "Dia inválido." });
    }
    expect(validateFixedIncomeInput(comCampo("usualDay", 1), semNomes).ok).toBe(true);
    expect(validateFixedIncomeInput(comCampo("usualDay", 31), semNomes).ok).toBe(true);
  });

  it("forma fora da lista: 'Escolha como chega.'", () => {
    expect(erroDe(comCampo("arrival", "pix"))).toEqual({ arrival: "Escolha como chega." });
  });

  it("automático sem texto do extrato: 'Para reconhecer sozinho, diga o texto que aparece no extrato.'", () => {
    expect(erroDe(comCampo("statementText", "   "))).toEqual({
      statementText: "Para reconhecer sozinho, diga o texto que aparece no extrato.",
    });
    expect(erroDe(comCampo("statementText", undefined))).toEqual({
      statementText: "Para reconhecer sozinho, diga o texto que aparece no extrato.",
    });
  });

  it("texto com menos de 3 ou mais de 60 caracteres (depois do trim): 'Use de 3 a 60 caracteres.'", () => {
    expect(erroDe(comCampo("statementText", "AB"))).toEqual({ statementText: "Use de 3 a 60 caracteres." });
    expect(erroDe(comCampo("statementText", "x".repeat(61)))).toEqual({
      statementText: "Use de 3 a 60 caracteres.",
    });
    expect(erroDe(comCampo("statementText", "  AB  "))).toEqual({
      statementText: "Use de 3 a 60 caracteres.",
    });
  });

  it("texto de 3 e de 60 caracteres passa, sem os espaços das pontas", () => {
    const tres = validateFixedIncomeInput(comCampo("statementText", "  ABC  "), semNomes);
    expect(tres.ok && tres.values.statementText).toBe("ABC");
    expect(validateFixedIncomeInput(comCampo("statementText", "x".repeat(60)), semNomes).ok).toBe(true);
  });

  it("manual sem texto do extrato passa, e grava nulo", () => {
    const resultado = validateFixedIncomeInput({ ...base, arrival: "manual", statementText: "" }, semNomes);

    expect(resultado.ok && resultado.values.statementText).toBe(null);
  });

  it("junta os erros de todos os campos de uma vez", () => {
    const erros = erroDe({
      name: "",
      currency: "XXX",
      amountCents: 0,
      usualDay: 40,
      arrival: "x",
      statementText: "",
    });

    expect(Object.keys(erros).sort()).toEqual(CAMPOS_OBRIGATORIOS);
  });

  it("entrada que não é objeto: todos os campos obrigatórios com erro", () => {
    expect(Object.keys(erroDe(null)).sort()).toEqual(CAMPOS_OBRIGATORIOS);
  });
});

describe("validateFixedIncomeInput: o que fica em dólar", () => {
  it("em real o valor gravado é falso, mesmo que a entrada peça verdadeiro", () => {
    const resultado = validateFixedIncomeInput(comCampo("keptUsdIsInvestment", true), semNomes);

    expect(resultado.ok && resultado.values.keptUsdIsInvestment).toBe(false);
  });

  it("em dólar, sem a informação, o que fica é Investimento (verdadeiro)", () => {
    const resultado = validateFixedIncomeInput(
      { ...base, currency: "USD", keptUsdIsInvestment: undefined },
      semNomes,
    );

    expect(resultado.ok && resultado.values.keptUsdIsInvestment).toBe(true);
  });

  it("em dólar, quando a pessoa desliga, grava falso", () => {
    const resultado = validateFixedIncomeInput(
      { ...base, currency: "USD", keptUsdIsInvestment: false },
      semNomes,
    );

    expect(resultado.ok && resultado.values.keptUsdIsInvestment).toBe(false);
  });
});

describe("chaveDoNome", () => {
  it("tira acento e caixa, e junta espaços", () => {
    expect(chaveDoNome("  Salário   CLT ")).toBe("salario clt");
    expect(chaveDoNome("Pró-labore")).toBe("pro-labore");
  });
});

describe("expectedPerCycle", () => {
  it("soma só as rendas ativas, separado por moeda", () => {
    const previsto = expectedPerCycle([
      { currency: "BRL", amountCents: 500000 },
      { currency: "USD", amountCents: 200000 },
      { currency: "BRL", amountCents: 100000, archivedAt: "2026-11-01T00:00:00.000Z" },
      { currency: "USD", amountCents: 300000, archivedAt: "2026-11-02T00:00:00.000Z" },
      { currency: "BRL", amountCents: 25050, archivedAt: null },
    ]);

    expect(previsto).toEqual({ brlCents: 525050, usdCents: 200000 });
  });

  it("sem rendas, zero nos dois", () => {
    expect(expectedPerCycle([])).toEqual({ brlCents: 0, usdCents: 0 });
  });
});
