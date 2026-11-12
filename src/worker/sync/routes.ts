// Estado da importação para as telas: o que está em andamento e o que terminou nas últimas 24 horas (uma consulta).
import { Hono } from "hono";
import { resetsAt } from "../../shared/usage";
import type { AppEnv, Env } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";
import { enqueueSlice } from "./enqueue";
import { estaPausada } from "./orcamento";
import { startRun } from "./runs";
import { situacaoDoBanco } from "./situacao";

const JANELA_DO_RECENTE_MS = 24 * 60 * 60 * 1000;

// A consulta do status fica exportada para o teste de plano ler o mesmo SQL. Duas metades em UNION ALL, cada uma pelo
// índice sync_runs_open_idx (banco, término): as execuções abertas (término nulo) e as encerradas desde a janela. Os
// bancos do lar entram pela conexão (bank_items_connection_idx). Um OR entre as duas condições impedia o índice de cortar
// pela data e lia todo o histórico do banco (TASK-0204, A2).
export const SQL_DO_STATUS = `SELECT r.id AS run_id, r.bank_item_id, b.institution_name, r.kind, r.progress_pct, r.started_at,
    r.finished_at, r.status, r.heartbeat_at
  FROM sync_runs r
  JOIN bank_items b ON b.id = r.bank_item_id
  JOIN pluggy_connections p ON p.id = b.connection_id
  WHERE p.household_id = ? AND r.kind = 'historico' AND r.finished_at IS NULL
UNION ALL
SELECT r.id AS run_id, r.bank_item_id, b.institution_name, r.kind, r.progress_pct, r.started_at,
    r.finished_at, r.status, r.heartbeat_at
  FROM sync_runs r
  JOIN bank_items b ON b.id = r.bank_item_id
  JOIN pluggy_connections p ON p.id = b.connection_id
  WHERE p.household_id = ? AND r.kind = 'historico' AND r.finished_at >= ?
ORDER BY started_at`;

// Bancos do lar para a tela de Configurações e o "Baixar agora" (TASK-0205): o último resultado de cada um e se há
// execução aberta. Uma consulta, com subconsultas pelo índice sync_runs_open_idx e pelo de execuções do banco.
export const SQL_BANCOS_DO_LAR = `SELECT b.id AS bank_item_id, b.institution_name, b.last_sync_at, b.status,
    EXISTS (SELECT 1 FROM sync_runs r WHERE r.bank_item_id = b.id AND r.finished_at IS NULL) AS aberta,
    (SELECT r.status FROM sync_runs r WHERE r.bank_item_id = b.id AND r.finished_at IS NOT NULL
       ORDER BY r.finished_at DESC LIMIT 1) AS ultimo_status,
    (SELECT r.error_code FROM sync_runs r WHERE r.bank_item_id = b.id AND r.finished_at IS NOT NULL
       ORDER BY r.finished_at DESC LIMIT 1) AS ultimo_erro
  FROM bank_items b
  JOIN pluggy_connections p ON p.id = b.connection_id
  WHERE p.household_id = ? AND b.disconnected_at IS NULL
  ORDER BY b.last_sync_at DESC, b.institution_name`;

// Um banco do lar, com as chaves da conexão e a situação do último resultado (para o "Baixar agora").
export const SQL_BANCO_DO_LAR = `SELECT b.id AS bank_item_id, b.disconnected_at, c.client_id_enc, c.iv, c.client_secret_enc,
    c.client_secret_iv,
    EXISTS (SELECT 1 FROM sync_runs r WHERE r.bank_item_id = b.id AND r.finished_at IS NULL) AS aberta,
    EXISTS (SELECT 1 FROM sync_runs r WHERE r.bank_item_id = b.id AND r.kind = 'historico'
      AND r.finished_at IS NOT NULL AND r.status IN ('ok', 'repetiu')) AS importado,
    (SELECT r.status FROM sync_runs r WHERE r.bank_item_id = b.id AND r.finished_at IS NOT NULL
       ORDER BY r.finished_at DESC LIMIT 1) AS ultimo_status,
    (SELECT r.error_code FROM sync_runs r WHERE r.bank_item_id = b.id AND r.finished_at IS NOT NULL
       ORDER BY r.finished_at DESC LIMIT 1) AS ultimo_erro
  FROM bank_items b
  JOIN pluggy_connections c ON c.id = b.connection_id
  WHERE b.id = ? AND c.household_id = ?`;

type LinhaDosBancos = {
  bank_item_id: string;
  institution_name: string;
  last_sync_at: string | null;
  status: string;
  aberta: number;
  ultimo_status: string | null;
  ultimo_erro: string | null;
};

type LinhaDoStatus = {
  run_id: string;
  bank_item_id: string;
  institution_name: string;
  kind: string;
  progress_pct: number;
  started_at: string;
  finished_at: string | null;
  status: string | null;
  heartbeat_at: string | null;
};

export function syncRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  rotas.get("/status", async (c) => {
    const { householdId } = getSession(c);
    const instante = agora();
    const desde = new Date(instante.getTime() - JANELA_DO_RECENTE_MS).toISOString();
    const resultado = await c.var.db.$client
      .prepare(SQL_DO_STATUS)
      .bind(householdId, householdId, desde)
      .all<LinhaDoStatus>();
    const linhas = resultado.results ?? [];
    const bancosLidos = await c.var.db.$client
      .prepare(SQL_BANCOS_DO_LAR)
      .bind(householdId)
      .all<LinhaDosBancos>();
    const bancos = (bancosLidos.results ?? []).map((linha) => {
      const situacao = situacaoDoBanco({
        ultimoStatus: linha.ultimo_status,
        ultimoErro: linha.ultimo_erro,
        aberta: linha.aberta === 1,
      });
      return {
        bankItemId: linha.bank_item_id,
        institutionName: linha.institution_name,
        lastSyncAt: linha.last_sync_at,
        status: linha.status,
        running: linha.aberta === 1,
        failed: situacao.failed,
        canRetry: situacao.canRetry,
      };
    });
    // Última atualização com sucesso dos bancos: a mais recente, e os nomes do mais recente para o mais antigo.
    const comSucesso = bancos
      .filter((banco): banco is typeof banco & { lastSyncAt: string } => banco.lastSyncAt !== null)
      .sort((a, b) => b.lastSyncAt.localeCompare(a.lastSyncAt));
    const lastSync =
      comSucesso.length === 0
        ? null
        : { at: comSucesso[0]?.lastSyncAt ?? null, banks: comSucesso.map((banco) => banco.institutionName) };
    return c.json(
      {
        lastSync,
        banks: bancos,
        // Pausada pelo teto diário (orcamento.ts): a fatia encostou o heartbeat na virada, e a retomada é a virada.
        importing: linhas
          .filter((linha) => linha.finished_at === null)
          .map((linha) => {
            const pausada = estaPausada(linha.heartbeat_at, instante);
            return {
              bankItemId: linha.bank_item_id,
              institutionName: linha.institution_name,
              progressPct: linha.progress_pct,
              startedAt: linha.started_at,
              pausada,
              pausadaAte: pausada ? resetsAt(instante) : null,
            };
          }),
        recentlyFinished: linhas
          .filter((linha) => linha.finished_at !== null)
          .map((linha) => ({
            runId: linha.run_id,
            bankItemId: linha.bank_item_id,
            institutionName: linha.institution_name,
            kind: linha.kind,
            status: linha.status,
            finishedAt: linha.finished_at,
          })),
      },
      200,
    );
  });

  return rotas;
}

// Baixar agora (TASK-0205): só depois de uma falha que repetir pode resolver. A execução manual nasce com o INSERT
// condicionado à inexistência de execução aberta (startRun), e só quem inseriu enfileira: dois toques, uma execução.
export function bankItemsSyncRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  rotas.post("/:id/sync", async (c) => {
    const { householdId } = getSession(c);
    const bankItemId = c.req.param("id");
    const db = c.var.db;
    const banco = await db.$client.prepare(SQL_BANCO_DO_LAR).bind(bankItemId, householdId).first<{
      disconnected_at: string | null;
      client_id_enc: string | null;
      iv: string | null;
      client_secret_enc: string | null;
      client_secret_iv: string | null;
      aberta: number;
      importado: number;
      ultimo_status: string | null;
      ultimo_erro: string | null;
    }>();
    if (!banco) return apiError(c, 404, "banco_nao_encontrado", "Banco não encontrado.");
    if (banco.disconnected_at !== null) {
      return apiError(c, 409, "banco_desconectado", "Este banco está desconectado.");
    }
    if (!banco.client_id_enc || !banco.iv || !banco.client_secret_enc || !banco.client_secret_iv) {
      return apiError(
        c,
        409,
        "sem_chaves",
        "Cole as chaves desta conta em Configurações › Contas Meu Pluggy.",
      );
    }
    if (banco.aberta === 1) return apiError(c, 409, "atualizacao_em_andamento", "Já está atualizando.");
    const situacao = situacaoDoBanco({
      ultimoStatus: banco.ultimo_status,
      ultimoErro: banco.ultimo_erro,
      aberta: false,
    });
    if (!situacao.failed) return apiError(c, 409, "sem_falha", "A última atualização deu certo.");
    if (!situacao.canRetry) {
      return apiError(c, 409, "falha_precisa_de_acao", "Repetir não resolve: veja o que falta neste banco.");
    }

    // Sem importação encerrada com sucesso, o "Baixar agora" refaz a importação (TASK-0205, A5).
    const tipo = banco.importado === 1 ? "manual" : "historico";
    const runId = await startRun(db, bankItemId, tipo, agora().toISOString());
    if (runId === null) return apiError(c, 409, "atualizacao_em_andamento", "Já está atualizando.");
    // Se a fila falhar, a execução fica aberta e o cron a retoma (retomar-importacoes).
    try {
      await enqueueSlice(c.env as Env, { runId, seq: 0 });
    } catch (erro) {
      console.error(`baixar agora: ${erro instanceof Error ? erro.name : "erro"}`);
    }
    return c.json({ runId }, 202);
  });

  return rotas;
}
