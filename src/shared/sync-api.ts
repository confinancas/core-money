// Estado da importação do histórico (TASK-0204), para as telas. Mesmo formato que GET /api/sync/status devolve.

export type ImportacaoEmAndamento = {
  bankItemId: string;
  institutionName: string;
  progressPct: number;
  startedAt: string;
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

export type SyncStatusResponse = {
  importing: ImportacaoEmAndamento[];
  recentlyFinished: ImportacaoTerminada[];
};
