// Tipos de gasto (valores de spend_type no modelo de dados), na ordem do manual.

export const SPEND_TYPES = [
  { id: "fixos", label: "Custos fixos", color: "#3D7BF7", inLimit: true, savings: false },
  { id: "conforto", label: "Conforto", color: "#13B5A6", inLimit: true, savings: false },
  { id: "educacao", label: "Educação", color: "#A35BF0", inLimit: true, savings: false },
  { id: "extras", label: "Custos extras", color: "#C4995B", inLimit: true, savings: false },
  { id: "prazeres", label: "Prazeres", color: "#F0559A", inLimit: true, savings: false },
  { id: "metas", label: "Metas", color: "#F7931E", inLimit: false, savings: true },
  { id: "investimentos", label: "Investimentos", color: "#1E9E63", inLimit: false, savings: true },
] as const;

export type SpendType = (typeof SPEND_TYPES)[number]["id"];

export const SAVINGS_GROUP_LABEL = "Dinheiro guardado";
