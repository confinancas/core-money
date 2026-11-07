// Molduras e abas do menu. A tabela de rotas (src/web/routes.tsx) diz a moldura e a aba de cada rota.

export const FRAMES = ["bare", "tab", "detail", "full"] as const;
export type Frame = (typeof FRAMES)[number];

export const ABAS = ["inicio", "cartoes", "contas", "renda", "relatorio", "configuracoes", "ia"] as const;
export type Aba = (typeof ABAS)[number];

export type RotaMeta = {
  frame: Frame;
  tab?: Aba;
  title: string;
  // Rota que só existe com o assistente ligado.
  requer?: "assistente";
};

const CAMINHO_DA_ABA: Record<Aba, string> = {
  inicio: "/inicio",
  cartoes: "/cartoes",
  contas: "/contas",
  renda: "/renda",
  relatorio: "/relatorio",
  configuracoes: "/configuracoes",
  ia: "/assistente",
};

export function isAba(valor: unknown): valor is Aba {
  return typeof valor === "string" && (ABAS as readonly string[]).includes(valor);
}

export function caminhoDaAba(aba: Aba): string {
  return CAMINHO_DA_ABA[aba];
}

// Para onde voltam a seta e o X: a aba marcada (a IA volta ao início), ou o início sem aba.
export function destinoDeVoltar(aba: Aba | null): string {
  return aba === null || aba === "ia" ? "/inicio" : CAMINHO_DA_ABA[aba];
}

// Aba marcada no menu. Rotas de aba usam a própria; detalhe e tela cheia usam state.fromTab quando é uma aba válida.
export function resolveActiveTab(meta: RotaMeta, estado: unknown): Aba | null {
  if (meta.frame === "bare") return null;
  if (meta.frame === "tab") return meta.tab ?? null;
  const origem =
    typeof estado === "object" && estado !== null ? (estado as { fromTab?: unknown }).fromTab : undefined;
  if (isAba(origem)) return origem;
  return meta.tab ?? null;
}
