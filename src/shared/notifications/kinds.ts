// Catálogo das notificações (TASK-0701): os 11 tipos, na ordem das preferências de Configurações. O título e o
// subtítulo são os de Configurações; ícone e cores são os do protótipo (Notificacoes.dc.html). O link leva o nome
// dos campos a preencher (:bankItemId, :transactionId, :cardId): quem gera a notificação troca pelo id do objeto.

export const NOTIFICATION_KINDS = [
  "pendencias",
  "insight",
  "negativo",
  "meta_dia",
  "vencimento",
  "balanco",
  "consentimento",
  "pix_recebido",
  "fatura_paga",
  "renda_dolar",
  "aviso_ia",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type IconeDeNotificacao = "alerta" | "brilho" | "relogio" | "banco" | "check" | "entrada";

export type ItemDoCatalogo = {
  kind: NotificationKind;
  titulo: string;
  subtitulo: string;
  icone: IconeDeNotificacao;
  // Fundo e cor do ícone (o quadrado de 40 px).
  fundo: string;
  cor: string;
  link: string;
};

export const NOTIFICATION_CATALOG: Record<NotificationKind, ItemDoCatalogo> = {
  pendencias: {
    kind: "pendencias",
    titulo: "Transações sem categoria",
    subtitulo: "Lembra enquanto houver Pix e compras pendentes",
    icone: "alerta",
    fundo: "#FFF5E4",
    cor: "#E08A00",
    link: "/para-categorizar",
  },
  insight: {
    kind: "insight",
    titulo: "Insight do dia",
    subtitulo: "Resumo com alerta quando o ritmo sobe",
    icone: "brilho",
    fundo: "#10261E",
    cor: "#9DFFD6",
    link: "/inicio",
  },
  negativo: {
    kind: "negativo",
    titulo: "Ciclo no negativo",
    subtitulo: "Quando faturas e contas passam do limite",
    icone: "alerta",
    fundo: "#FFF0F1",
    cor: "#E5484D",
    link: "/inicio",
  },
  meta_dia: {
    kind: "meta_dia",
    titulo: "Meta do dia",
    subtitulo: "Quando o que dá para gastar hoje fica abaixo da meta",
    icone: "alerta",
    fundo: "#FFF5E4",
    cor: "#E08A00",
    link: "/inicio",
  },
  vencimento: {
    kind: "vencimento",
    titulo: "Vencimentos",
    subtitulo: "Faturas e contas 3 dias antes",
    icone: "relogio",
    fundo: "#FFF0F1",
    cor: "#E5484D",
    link: "/contas",
  },
  balanco: {
    kind: "balanco",
    titulo: "Lembrete do balanço",
    // Padrão (início no dia 11). Quem mostra usa subtituloDoTipo, que lê o dia de início do lar.
    subtitulo: "Dia 10, para fazer a transferência",
    icone: "check",
    fundo: "#E7F7EF",
    cor: "#1E9E63",
    link: "/contas",
  },
  consentimento: {
    kind: "consentimento",
    titulo: "Renovar bancos",
    subtitulo: "30 dias antes do consentimento expirar",
    icone: "banco",
    fundo: "#FFF5E4",
    cor: "#E08A00",
    link: "/configuracoes/bancos/:bankItemId",
  },
  pix_recebido: {
    kind: "pix_recebido",
    titulo: "Pix recebido",
    subtitulo: "Quando chega um Pix sem regra, para classificar",
    icone: "entrada",
    fundo: "#E6F6EE",
    cor: "#0A7D50",
    link: "/pix-recebido/:transactionId",
  },
  fatura_paga: {
    kind: "fatura_paga",
    titulo: "Fatura paga",
    subtitulo: "Quando o pagamento da fatura aparece",
    icone: "check",
    fundo: "#E7F7EF",
    cor: "#1E9E63",
    link: "/cartoes/:cardId",
  },
  renda_dolar: {
    kind: "renda_dolar",
    titulo: "Salário em dólar",
    subtitulo: "Quando o salário em dólar chega",
    icone: "entrada",
    fundo: "#E6F6EE",
    cor: "#0A7D50",
    link: "/renda",
  },
  aviso_ia: {
    kind: "aviso_ia",
    titulo: "Avisos da assistente",
    subtitulo: "Quando um aviso combinado com a assistente dispara",
    icone: "alerta",
    fundo: "#FFF5E4",
    cor: "#E08A00",
    link: "/inicio",
  },
};

// Subtítulo que depende do dia de início do ciclo: no balanço, o dia anterior ao início (início no dia 1: o último dia).
export function subtituloDoTipo(kind: NotificationKind, diaDeInicio: number): string {
  if (kind !== "balanco") return NOTIFICATION_CATALOG[kind].subtitulo;
  if (diaDeInicio === 1) return "No último dia do ciclo, para fazer a transferência";
  return `Dia ${diaDeInicio - 1}, para fazer a transferência`;
}

export function ehTipoDeNotificacao(valor: unknown): valor is NotificationKind {
  return typeof valor === "string" && (NOTIFICATION_KINDS as readonly string[]).includes(valor);
}
