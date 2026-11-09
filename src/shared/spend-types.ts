// Tipos de gasto (valores de spend_type no modelo de dados), na ordem da barra do manual e da tela TiposGasto.
// SPEND_TYPE_DEFS é a fonte: rótulo, cor, se entra no limite, o campo do percentual no lar (pct_*) e o texto da tela.
// Investimentos não tem coluna: é a sobra (investmentsPct).

export const SPEND_TYPE_DEFS = [
  {
    id: "fixos",
    label: "Custos fixos",
    color: "#3D7BF7",
    inLimit: true,
    savings: false,
    pctKey: "fixos",
    pctField: "pct_fixed",
    fixo: true,
    descricao: "Todo mês e necessário: aluguel, academia, contas",
  },
  {
    id: "conforto",
    label: "Conforto",
    color: "#13B5A6",
    inLimit: true,
    savings: false,
    pctKey: "conforto",
    pctField: "pct_comfort",
    fixo: false,
    descricao: "Recorrente, mas dá para viver sem: carro alugado, assinaturas",
  },
  {
    id: "educacao",
    label: "Educação",
    color: "#A35BF0",
    inLimit: true,
    savings: false,
    pctKey: "educacao",
    pctField: "pct_education",
    fixo: true,
    descricao: "Faculdade, cursos, livros",
  },
  {
    id: "extras",
    label: "Custos extras",
    color: "#C4995B",
    inLimit: true,
    savings: false,
    pctKey: "extras",
    pctField: "pct_extras",
    fixo: false,
    descricao: "Necessário, mas não previsto: farmácia, conserto do carro",
  },
  {
    id: "prazeres",
    label: "Prazeres",
    color: "#F0559A",
    inLimit: true,
    savings: false,
    pctKey: "prazeres",
    pctField: "pct_pleasures",
    fixo: false,
    descricao: "Quase todo o resto: restaurantes, lazer, compras",
  },
  {
    id: "metas",
    label: "Metas",
    color: "#F7931E",
    inLimit: false,
    savings: true,
    pctKey: "metas",
    pctField: "pct_goals",
    fixo: false,
    descricao: "Objetivo que pede planejamento: viagem, procedimento estético, compra de valor alto",
  },
  {
    id: "investimentos",
    label: "Investimentos",
    color: "#1E9E63",
    inLimit: false,
    savings: true,
    pctKey: null,
    pctField: null,
    fixo: false,
    descricao: "O que sobra: Pix para a corretora e o salário que fica em dólar",
  },
] as const;

// Compatível com a TASK-0004: a lista com id, rótulo, cor, inLimit e savings, na mesma ordem.
export const SPEND_TYPES = SPEND_TYPE_DEFS;

export type SpendType = (typeof SPEND_TYPE_DEFS)[number]["id"];
export type SpendTypeDef = (typeof SPEND_TYPE_DEFS)[number];

// Os seis tipos com percentual no lar (pct_*). Investimentos é a sobra e não tem coluna.
export type PlannedSpendType = Exclude<SpendType, "investimentos">;
export type PlannedPercentages = Record<PlannedSpendType, number>;

export const PLANNED_SPEND_TYPES: readonly PlannedSpendType[] = [
  "fixos",
  "conforto",
  "educacao",
  "extras",
  "prazeres",
  "metas",
];

export const SAVINGS_GROUP_LABEL = "Dinheiro guardado";

// Regras automáticas (TASK-0802): a conta destino da corretora vira Investimentos; a caixinha de reserva, Metas.
export type TipoDeRegraAutomatica = "corretora" | "caixinha";
export const TIPO_DA_REGRA_AUTOMATICA: Readonly<Record<TipoDeRegraAutomatica, SpendType>> = {
  corretora: "investimentos",
  caixinha: "metas",
};

const PERCENTUAL_TOTAL = 100;
const TIPOS_FORA_DO_CARTAO: readonly SpendType[] = ["metas", "investimentos"];

// Soma dos seis tipos planejados (o que o casal reservou, sem a sobra).
export function sumPlanned(percentages: PlannedPercentages): number {
  return PLANNED_SPEND_TYPES.reduce((total, tipo) => total + percentages[tipo], 0);
}

// Investimentos: 100 menos a soma dos seis. Pode ficar negativo quando a soma passa de 100 (a tela avisa).
export function investmentsPct(percentages: PlannedPercentages): number {
  return PERCENTUAL_TOTAL - sumPlanned(percentages);
}

// Limite: a soma dos cinco tipos que entram no limite (Fixos, Conforto, Educação, Extras e Prazeres).
export function limitPct(percentages: PlannedPercentages): number {
  return SPEND_TYPE_DEFS.filter((tipo) => tipo.inLimit).reduce(
    (total, tipo) => total + (tipo.pctKey === null ? 0 : percentages[tipo.pctKey]),
    0,
  );
}

// Tipos que uma saída pode ter. Compra no cartão nunca é Metas nem Investimentos (o manual).
export function allowedSpendTypes({ isCard }: { isCard: boolean }): SpendType[] {
  return SPEND_TYPE_DEFS.map((tipo) => tipo.id).filter((id) => !isCard || !TIPOS_FORA_DO_CARTAO.includes(id));
}
