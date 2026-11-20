// Estado da importação do histórico (TASK-0204), para as telas. Mesmo formato que GET /api/sync/status devolve.

export type ImportacaoEmAndamento = {
  bankItemId: string;
  institutionName: string;
  progressPct: number;
  startedAt: string;
  // Pausada pelo teto diário de escritas: a retomada é a virada do dia (00:00 UTC), e pausadaAte é essa hora.
  pausada: boolean;
  pausadaAte: string | null;
};

export type StatusDaImportacao = "ok" | "repetiu" | "instavel" | "erro";

export type ImportacaoTerminada = {
  runId: string;
  bankItemId: string;
  institutionName: string;
  kind: string;
  status: StatusDaImportacao | null;
  finishedAt: string;
};

// Sincronização (TASK-0205): o último sucesso dos bancos e a situação de cada um, para Configurações e "Baixar agora".
export type BancoDaSincronizacao = {
  bankItemId: string;
  institutionName: string;
  lastSyncAt: string | null;
  status: "ativo" | "instavel" | "acao_necessaria";
  running: boolean;
  failed: boolean;
  canRetry: boolean;
};

export type SyncStatusResponse = {
  importing: ImportacaoEmAndamento[];
  recentlyFinished: ImportacaoTerminada[];
  lastSync: { at: string; banks: string[] } | null;
  banks: BancoDaSincronizacao[];
};
