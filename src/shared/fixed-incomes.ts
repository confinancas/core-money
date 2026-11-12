// Renda fixa (TASK-0901): os salários e outras entradas com dia certo. Valores em centavos inteiros na moeda
// (US$ 2.000,00 = 200000). A validação é a mesma na API e no formulário.

import type { UltimaCotacao } from "./income";

export const CURRENCIES = ["BRL", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const ARRIVALS = ["auto", "partes", "manual"] as const;
export type Arrival = (typeof ARRIVALS)[number];

// Como chega (os três chips do editor), o rótulo curto da lista e o subtítulo de Configurações.
export const ARRIVAL_CHIP_LABELS: Record<Arrival, string> = {
  auto: "Na conta, pelo Open Finance",
  partes: "Em partes: conta + Pix de terceiros",
  manual: "Eu lanço na mão",
};

export const ARRIVAL_SHORT_LABELS: Record<Arrival, string> = {
  auto: "automático",
  partes: "em partes",
  manual: "manual",
};

export const ARRIVAL_HELP: Record<Arrival, string> = {
  auto: "O app reconhece pelo texto do extrato e marca como recebido.",
  partes:
    "Cada parte que chegar (o depósito na conta, os Pix de terceiros) é somada até completar o previsto.",
  manual: "Vocês confirmam quando cair. Útil para o que não passa pelo banco.",
};

export const ARRIVAL_SETTINGS_LABELS: Record<Arrival, string> = {
  auto: "Automático pelo Open Finance",
  partes: "Em partes: conta + Pix de terceiros",
  manual: "Manual",
};

export const FIXED_INCOME_LIMITS = {
  nomeMax: 40,
  textoMin: 3,
  textoMax: 60,
  valorMaxCents: 10_000_000_000,
  diaMin: 1,
  diaMax: 31,
} as const;

// Campos da validação (os nomes são os do corpo da API e os do formulário).
export type FixedIncomeField = "name" | "currency" | "amountCents" | "usualDay" | "arrival" | "statementText";

export type FixedIncomeValues = {
  name: string;
  currency: Currency;
  amountCents: number;
  usualDay: number;
  arrival: Arrival;
  statementText: string | null;
  // Só vale no dólar. Em real o valor gravado é sempre falso (o banco guarda 0).
  keptUsdIsInvestment: boolean;
};

export type ExistingFixedIncome = { id: string; name: string };

export type FixedIncomeValidation =
  | { ok: true; values: FixedIncomeValues }
  | { ok: false; fields: Partial<Record<FixedIncomeField, string>> };

// Sem acento e sem caixa: "salário CLT" e "Salario clt" são o mesmo nome.
export function chaveDoNome(nome: string): string {
  return nome.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
}

// Valida uma renda fixa inteira (criar ou o resultado de uma edição). existentes são as rendas ativas do lar;
// idEmEdicao fica de fora da comparação de nomes.
export function validateFixedIncomeInput(
  input: unknown,
  existentes: readonly ExistingFixedIncome[],
  idEmEdicao?: string,
): FixedIncomeValidation {
  const dados: Record<string, unknown> = typeof input === "object" && input !== null ? { ...input } : {};
  const fields: Partial<Record<FixedIncomeField, string>> = {};

  const nome = typeof dados.name === "string" ? dados.name.trim() : "";
  if (nome === "") {
    fields.name = "Dê um nome à renda.";
  } else if (nome.length > FIXED_INCOME_LIMITS.nomeMax) {
    fields.name = `Use até ${FIXED_INCOME_LIMITS.nomeMax} caracteres.`;
  } else if (
    existentes.some(
      (existente) => existente.id !== idEmEdicao && chaveDoNome(existente.name) === chaveDoNome(nome),
    )
  ) {
    fields.name = "Já existe uma renda fixa com esse nome.";
  }

  const moeda = dados.currency;
  const currency = (CURRENCIES as readonly unknown[]).includes(moeda) ? (moeda as Currency) : null;
  if (currency === null) fields.currency = "Escolha a moeda.";

  const valor = dados.amountCents;
  const amountCents =
    typeof valor === "number" &&
    Number.isSafeInteger(valor) &&
    valor > 0 &&
    valor <= FIXED_INCOME_LIMITS.valorMaxCents
      ? valor
      : null;
  if (amountCents === null) fields.amountCents = "Informe o valor por ciclo.";

  const dia = dados.usualDay;
  const usualDay =
    typeof dia === "number" &&
    Number.isInteger(dia) &&
    dia >= FIXED_INCOME_LIMITS.diaMin &&
    dia <= FIXED_INCOME_LIMITS.diaMax
      ? dia
      : null;
  if (usualDay === null) fields.usualDay = "Dia inválido.";

  const forma = dados.arrival;
  const arrival = (ARRIVALS as readonly unknown[]).includes(forma) ? (forma as Arrival) : null;
  if (arrival === null) fields.arrival = "Escolha como chega.";

  const textoBruto = typeof dados.statementText === "string" ? dados.statementText.trim() : "";
  let statementText: string | null = null;
  if (textoBruto === "") {
    if (arrival === "auto")
      fields.statementText = "Para reconhecer sozinho, diga o texto que aparece no extrato.";
  } else if (
    textoBruto.length < FIXED_INCOME_LIMITS.textoMin ||
    textoBruto.length > FIXED_INCOME_LIMITS.textoMax
  ) {
    fields.statementText = `Use de ${FIXED_INCOME_LIMITS.textoMin} a ${FIXED_INCOME_LIMITS.textoMax} caracteres.`;
  } else {
    statementText = textoBruto;
  }

  if (
    Object.keys(fields).length > 0 ||
    currency === null ||
    amountCents === null ||
    usualDay === null ||
    arrival === null
  ) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    values: {
      name: nome,
      currency,
      amountCents,
      usualDay,
      arrival,
      statementText,
      keptUsdIsInvestment: currency === "USD" ? dados.keptUsdIsInvestment !== false : false,
    },
  };
}

// O previsto por ciclo, separado por moeda, só das rendas ativas (arquivadas não entram).
export function expectedPerCycle(
  rendas: readonly { currency: Currency; amountCents: number; archivedAt?: string | null }[],
): {
  brlCents: number;
  usdCents: number;
} {
  let brlCents = 0;
  let usdCents = 0;
  for (const renda of rendas) {
    if (renda.archivedAt) continue;
    if (renda.currency === "BRL") brlCents += renda.amountCents;
    else usdCents += renda.amountCents;
  }
  return { brlCents, usdCents };
}

export type FixedIncomeDto = {
  id: string;
  name: string;
  currency: Currency;
  amountCents: number;
  usualDay: number;
  arrival: Arrival;
  statementText: string | null;
  keptUsdIsInvestment: boolean;
  // A cotação do recebimento mais recente da renda (TASK-0902). Nulo sem recebimento com cotação.
  lastFx: UltimaCotacao | null;
};

export type ExpectedPerCycleDto = {
  brlCents: number;
  usdCents: number;
  // Dólar convertido em real, pela cotação de cada renda (TASK-0902). Nulo se alguma renda em dólar ainda não tem cotação.
  usdInBrlCents: number | null;
};

export type FixedIncomesResponse = {
  fixedIncomes: FixedIncomeDto[];
  expectedPerCycle: ExpectedPerCycleDto;
};
