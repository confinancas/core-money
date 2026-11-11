// Planejamento puro da importação (TASK-0204): janelas de datas, progresso e os tipos do cursor e da mensagem.
// Sem D1 e sem rede: tudo daqui é testado só com funções.

// Meses de histórico buscados por conta (decisão de 2026-11-03).
export const MESES = 12;
// Tamanho de cada janela de busca, em dias.
export const DIAS_DA_JANELA = 30;
// Parcelas futuras do cartão: amanhã até +400 dias.
export const DIAS_DO_FUTURO = 400;
// Conciliação dos 12 meses: uma janela de 15 dias por fatia, da de hoje para a mais antiga. São 25 janelas (375 dias),
// que cobrem os 12 meses do histórico.
export const DIAS_DA_CONCILIACAO = 15;
export const JANELAS_DE_CONCILIACAO = 25;

export type SyncPhase = "inicio" | "faturas" | "transacoes" | "conciliar" | "fim";
export type SyncWindow = { from: string; to: string };

// Uma conta do cursor. Cartões trazem a fatura aberta (já lida) e o intervalo de vencimento (gap, em dias).
export type SyncAccount = {
  id: string;
  kind: "BANK" | "CREDIT";
  windows: SyncWindow[];
  gapDays?: number;
  aberta?: {
    id: string;
    closes_on: string;
    due_on: string | null;
    amount_cents: number | null;
    status: "aberta";
    paid_on: null;
  } | null;
};

// Estado de uma execução, guardado em sync_runs.cursor_json. seq protege contra mensagem repetida.
export type SyncCursor = {
  seq: number;
  phase: SyncPhase;
  accounts: SyncAccount[];
  a: number;
  w: number;
  pageCursor: string | null;
  offset: number;
  inserted: number;
};

// A mensagem da fila: uma fatia por vez (max_batch_size 1).
export type SyncMessage = { runId: string; seq: number };

const pad = (n: number) => String(n).padStart(2, "0");

// Soma dias a uma data AAAA-MM-DD (calendário, sem fuso).
export function somaDias(dataIso: string, dias: number): string {
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  const data = new Date(Date.UTC(ano ?? 0, (mes ?? 1) - 1, (dia ?? 1) + dias));
  return `${data.getUTCFullYear()}-${pad(data.getUTCMonth() + 1)}-${pad(data.getUTCDate())}`;
}

// Soma meses preservando o dia quando o mês de destino tem dia; no fim do mês, o último dia (29/02 vira 28/02).
export function somaMeses(dataIso: string, meses: number): string {
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  const base = (ano ?? 0) * 12 + ((mes ?? 1) - 1) + meses;
  const anoDestino = Math.floor(base / 12);
  const mesDestino = (base % 12) + 1;
  const ultimoDia = new Date(Date.UTC(anoDestino, mesDestino, 0)).getUTCDate();
  return `${anoDestino}-${pad(mesDestino)}-${pad(Math.min(dia ?? 1, ultimoDia))}`;
}

// Janelas de 30 dias que cobrem os últimos `meses` meses, da mais nova para a mais antiga. A primeira termina hoje;
// as janelas são contíguas e não se sobrepõem; a última começa no primeiro dia do período.
export function historyWindows(hoje: string, meses: number = MESES): SyncWindow[] {
  const inicio = somaDias(somaMeses(hoje, -meses), 1);
  const janelas: SyncWindow[] = [];
  let ate = hoje;
  while (ate >= inicio) {
    let inicioDaJanela = somaDias(ate, -(DIAS_DA_JANELA - 1));
    if (inicioDaJanela < inicio) inicioDaJanela = inicio;
    janelas.push({ from: inicioDaJanela, to: ate });
    ate = somaDias(inicioDaJanela, -1);
  }
  return janelas;
}

// Parcelas futuras: de amanhã até +400 dias.
export function futureWindow(hoje: string): SyncWindow {
  return { from: somaDias(hoje, 1), to: somaDias(hoje, DIAS_DO_FUTURO) };
}

// Percentual inteiro de 0 a 99. Só o fim da execução grava 100 (done = total não chega a 100 antes disso).
export function progressPct(feitas: number, total: number): number {
  if (total <= 0 || feitas <= 0) return 0;
  return Math.min(99, Math.floor((feitas * 100) / total));
}

// Quantas fatias de faturas: três cartões por fatia, e pelo menos uma.
export function fatiasDeFaturas(cartoes: number): number {
  return Math.max(1, Math.ceil(cartoes / 3));
}

// Total de fatias da importação: inicio + faturas + uma por janela. As fatias de conciliação (JANELAS_DE_CONCILIACAO)
// entram no total quando a fase transacoes termina; o fim não conta (grava 100).
export function totalDeFatias(cartoes: number, janelas: number): number {
  return 1 + fatiasDeFaturas(cartoes) + janelas;
}

// Cursor inicial, como o startRun grava: a fase inicio, com seq 0.
export const CURSOR_INICIAL = { seq: 0, phase: "inicio" } as const;

// Lê o cursor guardado, preenchendo o que a primeira gravação ainda não tem.
export function lerCursor(texto: string | null): SyncCursor {
  const bruto = texto ? (JSON.parse(texto) as Partial<SyncCursor>) : {};
  return {
    seq: bruto.seq ?? 0,
    phase: bruto.phase ?? "inicio",
    accounts: bruto.accounts ?? [],
    a: bruto.a ?? 0,
    w: bruto.w ?? 0,
    pageCursor: bruto.pageCursor ?? null,
    offset: bruto.offset ?? 0,
    inserted: bruto.inserted ?? 0,
  };
}
