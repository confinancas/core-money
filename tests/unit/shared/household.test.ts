import { describe, expect, it } from "vitest";
import {
  HOUSEHOLD_DEFAULTS,
  householdPatchSchema,
  investmentsPct,
  memberNameSchema,
} from "../../../src/shared/household";

const PERCENTUAIS_VALIDOS = { fixos: 35, conforto: 10, educacao: 5, extras: 5, metas: 10, prazeres: 10 };

const mensagens = (valor: unknown): Record<string, string> => {
  const resultado = householdPatchSchema.safeParse(valor);
  if (resultado.success) return {};
  const campos: Record<string, string> = {};
  for (const issue of resultado.error.issues) campos[String(issue.path[0] ?? "")] ??= issue.message;
  return campos;
};

describe("investmentsPct", () => {
  it("é 25 com os padrões (100 menos os 75 dos seis tipos)", () => {
    expect(investmentsPct(HOUSEHOLD_DEFAULTS.percentages)).toBe(25);
  });

  it("é zero quando os seis tipos somam 100", () => {
    expect(investmentsPct({ fixos: 50, conforto: 20, educacao: 10, extras: 5, metas: 10, prazeres: 5 })).toBe(
      0,
    );
  });

  it("é 100 quando os seis tipos são zero", () => {
    expect(investmentsPct({ fixos: 0, conforto: 0, educacao: 0, extras: 0, metas: 0, prazeres: 0 })).toBe(
      100,
    );
  });
});

describe("householdPatchSchema", () => {
  it("aceita só o dia do ciclo, só os percentuais ou os dois", () => {
    expect(householdPatchSchema.safeParse({ cycleStartDay: 5 }).success).toBe(true);
    expect(householdPatchSchema.safeParse({ percentages: PERCENTUAIS_VALIDOS }).success).toBe(true);
    expect(
      householdPatchSchema.safeParse({ cycleStartDay: 5, percentages: PERCENTUAIS_VALIDOS }).success,
    ).toBe(true);
  });

  it("aceita os dias de fronteira 1 e 28", () => {
    expect(householdPatchSchema.safeParse({ cycleStartDay: 1 }).success).toBe(true);
    expect(householdPatchSchema.safeParse({ cycleStartDay: 28 }).success).toBe(true);
  });

  it.each([[0], [29], [11.5], ["11"], [null]])("recusa o dia do ciclo %o com a mensagem do ciclo", (dia) => {
    expect(mensagens({ cycleStartDay: dia })).toEqual({
      cycleStartDay: "O ciclo começa entre o dia 1 e o dia 28.",
    });
  });

  it("aceita percentuais que somam 80 (investimentos sobra 20)", () => {
    const resultado = householdPatchSchema.safeParse({
      percentages: { fixos: 30, conforto: 10, educacao: 5, extras: 5, metas: 10, prazeres: 20 },
    });
    expect(resultado.success).toBe(true);
  });

  it("recusa percentuais que somam 101 com a mensagem da soma em percentages", () => {
    expect(
      mensagens({
        percentages: { fixos: 36, conforto: 10, educacao: 5, extras: 5, metas: 10, prazeres: 35 },
      }),
    ).toEqual({
      percentages: "A soma dos tipos de gasto passa de 100%. Reduza algum para continuar.",
    });
  });

  it("recusa um percentual fora de 0 a 100 ou fracionário", () => {
    const mensagemDoPercentual = "Cada tipo de gasto vai de 0% a 100%, em números inteiros.";
    expect(mensagens({ percentages: { ...PERCENTUAIS_VALIDOS, fixos: 101 } })).toEqual({
      percentages: mensagemDoPercentual,
    });
    expect(mensagens({ percentages: { ...PERCENTUAIS_VALIDOS, fixos: -1 } })).toEqual({
      percentages: mensagemDoPercentual,
    });
    expect(mensagens({ percentages: { ...PERCENTUAIS_VALIDOS, fixos: 10.5 } })).toEqual({
      percentages: mensagemDoPercentual,
    });
  });

  it("recusa percentuais com uma chave faltando", () => {
    const semMetas = { fixos: 35, conforto: 10, educacao: 5, extras: 5, prazeres: 10 };
    expect(mensagens({ percentages: semMetas })).toEqual({
      percentages: "Cada tipo de gasto vai de 0% a 100%, em números inteiros.",
    });
  });

  it("recusa investimentos enviado, com um campo desconhecido", () => {
    expect(
      householdPatchSchema.safeParse({ percentages: { ...PERCENTUAIS_VALIDOS, investimentos: 25 } }).success,
    ).toBe(false);
    expect(householdPatchSchema.safeParse({ cycleStartDay: 5, campoQualquer: 1 }).success).toBe(false);
  });

  it("recusa o patch vazio", () => {
    expect(householdPatchSchema.safeParse({}).success).toBe(false);
  });
});

describe("memberNameSchema", () => {
  it.each([[""], ["   "], ["a".repeat(41)]])("recusa o nome %j", (nome) => {
    expect(memberNameSchema.safeParse(nome).success).toBe(false);
  });

  it("aceita 40 caracteres e tira os espaços das pontas", () => {
    expect(memberNameSchema.safeParse("a".repeat(40)).success).toBe(true);
    const resultado = memberNameSchema.safeParse("  [TEST] Pessoa A  ");
    expect(resultado.success && resultado.data).toBe("[TEST] Pessoa A");
  });
});
