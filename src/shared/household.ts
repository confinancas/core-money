import { z } from "zod";

export type BrandId = "matrimoney" | "meumoney";
export type MemberRole = "titular" | "conjuge";
export type PlannedSpendType = "fixos" | "conforto" | "educacao" | "extras" | "metas" | "prazeres";
export type PlannedPercentages = Record<PlannedSpendType, number>;

export const CYCLE_START_DAY = { min: 1, max: 28 } as const;

export const HOUSEHOLD_DEFAULTS = {
  cycleStartDay: 11,
  percentages: { fixos: 35, conforto: 10, educacao: 5, extras: 5, metas: 10, prazeres: 10 },
} as const;

const PERCENTUAL_TOTAL = 100;

const soma = (p: PlannedPercentages): number => Object.values(p).reduce((total, valor) => total + valor, 0);

// Investimentos não tem coluna: é a sobra do que os seis tipos planejados não usam.
export function investmentsPct(p: PlannedPercentages): number {
  return PERCENTUAL_TOTAL - soma(p);
}

const MENSAGEM_NOME = "Informe um nome de 1 a 40 caracteres.";
const MENSAGEM_CICLO = "O ciclo começa entre o dia 1 e o dia 28.";
const MENSAGEM_PERCENTUAL = "Cada tipo de gasto vai de 0% a 100%, em números inteiros.";
const MENSAGEM_SOMA = "A soma dos tipos de gasto passa de 100%. Reduza algum para continuar.";
const MENSAGEM_NADA = "Nada para salvar.";

export const memberNameSchema = z
  .string({ error: MENSAGEM_NOME })
  .trim()
  .min(1, MENSAGEM_NOME)
  .max(40, MENSAGEM_NOME);

const percentualSchema = z
  .number({ error: MENSAGEM_PERCENTUAL })
  .int({ error: MENSAGEM_PERCENTUAL })
  .min(0, { error: MENSAGEM_PERCENTUAL })
  .max(100, { error: MENSAGEM_PERCENTUAL });

const percentagesSchema = z
  .strictObject(
    {
      fixos: percentualSchema,
      conforto: percentualSchema,
      educacao: percentualSchema,
      extras: percentualSchema,
      metas: percentualSchema,
      prazeres: percentualSchema,
    },
    { error: MENSAGEM_PERCENTUAL },
  )
  .refine((p) => soma(p) <= PERCENTUAL_TOTAL, { error: MENSAGEM_SOMA });

export const householdPatchSchema = z
  .strictObject({
    cycleStartDay: z
      .number({ error: MENSAGEM_CICLO })
      .int({ error: MENSAGEM_CICLO })
      .min(CYCLE_START_DAY.min, { error: MENSAGEM_CICLO })
      .max(CYCLE_START_DAY.max, { error: MENSAGEM_CICLO })
      .optional(),
    percentages: percentagesSchema.optional(),
  })
  .refine((p) => p.cycleStartDay !== undefined || p.percentages !== undefined, { error: MENSAGEM_NADA });

export type HouseholdPatch = z.infer<typeof householdPatchSchema>;

export type PercentagesDto = PlannedPercentages & { investimentos: number };

export type HouseholdDto = {
  id: string;
  brand: BrandId;
  cycleStartDay: number;
  percentages: PercentagesDto;
  paidPlan: boolean;
  createdAt: string;
};

export type MemberDto = {
  id: string;
  name: string;
  role: MemberRole;
  isMe: boolean;
};

export type HouseholdResponse = {
  household: HouseholdDto;
  members: MemberDto[];
};
