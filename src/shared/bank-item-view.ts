// Regras de texto e de pílula da tela do banco conectado (TASK-0206). Funções puras, sem React e sem o D1: a tela e o
// teste de unidade usam as mesmas linhas da spec. Datas de calendário saem do dia de São Paulo.
import { todayInSaoPaulo, toSaoPauloDate } from "./sao-paulo-date";

export type Tom = "sucesso" | "aviso" | "falta" | "neutro";
export type Pilula = { texto: string; tom: Tom };

const DIA = 24 * 60 * 60 * 1000;
const DIAS_DA_VALIDADE = 365;

// Dia de calendário (AAAA-MM-DD) e dias entre dois dias de calendário, sem fuso.
function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA);
}

function dd(dia: string): string {
  return dia.slice(8, 10);
}

function mm(dia: string): string {
  return dia.slice(5, 7);
}

function aaaa(dia: string): string {
  return dia.slice(0, 4);
}

// Autorizado em = validade menos 12 meses (mesmo dia; em 29/02, 28/02).
function autorizadoEm(validade: string): string {
  const ano = Number(aaaa(validade)) - 1;
  const mes = mm(validade);
  const dia = Number(dd(validade));
  const ultimoDia = new Date(Date.UTC(ano, Number(mes), 0)).getUTCDate();
  return `${ano}-${mes}-${String(Math.min(dia, ultimoDia)).padStart(2, "0")}`;
}

export type VisaoDoConsentimento = {
  titulo: string;
  texto: string;
  tom: Tom;
  // Dias de hoje (São Paulo) até a validade; nulo sem data.
  diasRestantes: number | null;
  // Barra de 0 a 100 (diasRestantes / 365).
  barraPct: number;
  // "Autorizado em DD/MM/AAAA · vale 12 meses"; nulo sem data (a linha some).
  linhaDeBaixo: string | null;
};

// Consentimento (TASK-0206): o título, o texto e a barra. Vencido: texto de vencido, na cor de aviso.
export function consentView(
  expiraEm: string | null,
  hoje: string,
  nomeDoBanco: string,
): VisaoDoConsentimento {
  if (expiraEm === null) {
    return {
      titulo: "Validade não informada",
      texto: "O Meu Pluggy não disse até quando vale.",
      tom: "neutro",
      diasRestantes: null,
      barraPct: 0,
      linhaDeBaixo: null,
    };
  }
  // Pluggy manda a validade à meia-noite UTC: a data é a de calendário (toSaoPauloDate), não o dia de São Paulo.
  const data = toSaoPauloDate(expiraEm);
  const restam = diasEntre(hoje, data);
  const barraPct = Math.max(0, Math.min(1, restam / DIAS_DA_VALIDADE)) * 100;
  const autorizado = autorizadoEm(data);
  const linhaDeBaixo = `Autorizado em ${dd(autorizado)}/${mm(autorizado)}/${aaaa(autorizado)} · vale 12 meses`;

  if (restam < 0) {
    return {
      titulo: "Consentimento vencido",
      texto: `O ${nomeDoBanco} parou de atualizar. Renove no Meu Pluggy para voltar.`,
      tom: "aviso",
      diasRestantes: restam,
      barraPct,
      linhaDeBaixo,
    };
  }
  if (restam <= 30) {
    const faltam = restam === 0 ? "Vence hoje." : restam === 1 ? "Falta 1 dia." : `Faltam ${restam} dias.`;
    return {
      titulo: `Consentimento expira em ${dd(data)}/${mm(data)}`,
      texto: `${faltam} Depois disso, o ${nomeDoBanco} para de atualizar até vocês renovarem.`,
      tom: "aviso",
      diasRestantes: restam,
      barraPct,
      linhaDeBaixo,
    };
  }
  return {
    titulo: `Consentimento válido até ${dd(data)}/${mm(data)}/${aaaa(data)}`,
    texto: "Vale 12 meses a partir da autorização.",
    tom: "sucesso",
    diasRestantes: restam,
    barraPct,
    linhaDeBaixo,
  };
}

// "Hoje, HH:MM", "Ontem, HH:MM" ou "DD/MM, HH:MM", com a data e a hora de São Paulo.
const formatoHora = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function horaDeSaoPaulo(iso: string): string {
  return formatoHora.format(new Date(iso));
}

export function quandoDaExecucao(iso: string, agora: Date): string {
  const dia = todayInSaoPaulo(new Date(iso));
  const hoje = todayInSaoPaulo(agora);
  const hora = horaDeSaoPaulo(iso);
  if (dia === hoje) return `Hoje, ${hora}`;
  if (diasEntre(dia, hoje) === 1) return `Ontem, ${hora}`;
  return `${dd(dia)}/${mm(dia)}, ${hora}`;
}

// Mensagens de erro por código (sync_runs.error_code), as da spec.
const TEXTO_DO_ERRO: Record<string, string> = {
  chaves_invalidas: "As chaves do Meu Pluggy não valem mais",
  sem_chaves: "Faltam as chaves do Meu Pluggy",
  autorizacao_vencida: "Autorização vencida no Meu Pluggy",
  consentimento_vencido: "Consentimento vencido",
  item_inexistente: "Banco não encontrado no Meu Pluggy",
  desconectado: "Parou: banco desconectado",
};

export type ExecucaoParaLinha = {
  kind: string;
  status: string | null;
  errorCode: string | null;
  newTransactions: number;
  progressPct: number;
  finishedAt: string | null;
  startedAt: string;
};

export type LinhaDaExecucao = { texto: string; pilula: Pilula | null };

// Uma linha do histórico de atualizações (TASK-0206): o texto e a pílula. "finishedAt" nulo é uma execução aberta.
export function runLine(run: ExecucaoParaLinha): LinhaDaExecucao {
  if (run.finishedAt === null) {
    return { texto: `Atualizando… ${run.progressPct}%`, pilula: null };
  }
  const horaDoSucesso = horaDeSaoPaulo(run.finishedAt);
  if (run.status === "ok") {
    if (run.kind === "historico") {
      return {
        texto: `Histórico importado · ${run.newTransactions} transações`,
        pilula: { texto: "OK", tom: "sucesso" },
      };
    }
    const n = run.newTransactions;
    const texto = n === 0 ? "Nada novo" : n === 1 ? "1 transação nova" : `${n} transações novas`;
    return { texto, pilula: { texto: "OK", tom: "sucesso" } };
  }
  if (run.status === "repetiu") {
    return {
      texto: `Banco instável · deu certo às ${horaDoSucesso}`,
      pilula: { texto: "Repetiu", tom: "aviso" },
    };
  }
  if (run.status === "instavel") {
    return {
      texto: "Banco instável · tenta de novo amanhã",
      pilula: { texto: "Instável", tom: "aviso" },
    };
  }
  const texto = TEXTO_DO_ERRO[run.errorCode ?? ""] ?? "Não deu para atualizar";
  return { texto, pilula: { texto: "Erro", tom: "falta" } };
}

// Pílula do banco no topo: Conectado, Instável, Precisa de atenção ou Desconectado.
export function bankStatusPill(item: { status: string; disconnectedAt: string | null }): Pilula {
  if (item.disconnectedAt !== null) return { texto: "Desconectado", tom: "neutro" };
  if (item.status === "instavel") return { texto: "Instável", tom: "aviso" };
  if (item.status === "acao_necessaria") return { texto: "Precisa de atenção", tom: "aviso" };
  return { texto: "Conectado", tom: "sucesso" };
}

// "Em dia" para a atualização de hoje ou de ontem; "Atrasada" para mais de um dia ou nenhuma (decisão de nível 1,
// registrada nas Evidências).
export function freshnessPill(lastSyncAt: string | null, hoje: string): Pilula {
  if (lastSyncAt === null) return { texto: "Atrasada", tom: "aviso" };
  const dia = todayInSaoPaulo(new Date(lastSyncAt));
  return diasEntre(dia, hoje) <= 1
    ? { texto: "Em dia", tom: "sucesso" }
    : { texto: "Atrasada", tom: "aviso" };
}

// Forma do GET /api/bank-items/:id (TASK-0206). O servidor monta o mesmo objeto (src/worker/bank/detail.ts).
export type ContaDoBanco = {
  id: string;
  kind: string;
  name: string;
  balanceCents: number;
  balanceAt: string;
};

export type CartaoDoBanco = {
  id: string;
  name: string;
  last4: string;
  openBill: { closesOn: string; amountCents: number | null } | null;
};

export type ExecucaoDoBanco = {
  id: string;
  kind: string;
  startedAt: string;
  finishedAt: string | null;
  status: string | null;
  newTransactions: number;
  progressPct: number;
  errorCode: string | null;
};

export type DetalheDoBancoDto = {
  id: string;
  institutionName: string;
  institutionColor: string | null;
  connection: { id: string; label: string };
  status: string;
  disconnectedAt: string | null;
  consentExpiresAt: string | null;
  lastSyncAt: string | null;
  running: boolean;
  failed: boolean;
  canRetry: boolean;
  accounts: ContaDoBanco[];
  cards: CartaoDoBanco[];
  runs: ExecucaoDoBanco[];
};

export type ConferenciaDoConsentimento = {
  renewed: boolean;
  consentExpiresAt: string | null;
  itemMissing: boolean;
};
