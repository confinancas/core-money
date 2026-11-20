// Detalhe de um banco conectado (TASK-0206): um db.batch de 4 leituras com índice, do banco do lar da sessão.
// Banco de outro lar não aparece: a leitura do item já é filtrada pelo lar da conexão, e as outras três só andam
// com o id do banco que essa leitura confirmou (a rota responde 404 antes de usar as outras).

import type { DetalheDoBancoDto } from "../../shared/bank-item-view";
import type { Db } from "../db/client";
import { situacaoDoBanco } from "../sync/situacao";

export const SQL_ITEM_DO_LAR = `SELECT b.id, b.connection_id, b.institution_name, b.institution_color, b.consent_expires_at,
    b.last_sync_at, b.status, b.disconnected_at, c.label AS connection_label,
    EXISTS (SELECT 1 FROM sync_runs r WHERE r.bank_item_id = b.id AND r.finished_at IS NULL) AS aberta,
    (SELECT r.status FROM sync_runs r WHERE r.bank_item_id = b.id AND r.finished_at IS NOT NULL
       ORDER BY r.finished_at DESC LIMIT 1) AS ultimo_status,
    (SELECT r.error_code FROM sync_runs r WHERE r.bank_item_id = b.id AND r.finished_at IS NOT NULL
       ORDER BY r.finished_at DESC LIMIT 1) AS ultimo_erro
  FROM bank_items b
  JOIN pluggy_connections c ON c.id = b.connection_id
  WHERE b.id = ? AND c.household_id = ?`;

// Contas do banco (saldo de hoje; caixinhas vêm como 'caixinha').
export const SQL_CONTAS_DO_BANCO = `SELECT a.id, a.kind, a.name, a.balance_cents, a.balance_at
  FROM accounts a
  WHERE a.bank_item_id = ?
  ORDER BY a.name, a.id`;

// Cartões do banco e a fatura aberta de cada um (a mais recente, se houver mais de uma).
export const SQL_CARTOES_DO_BANCO = `SELECT k.id, k.name, k.last4,
    (SELECT f.closes_on FROM bills f WHERE f.card_id = k.id AND f.status = 'aberta'
       ORDER BY f.closes_on DESC LIMIT 1) AS fecha_em,
    (SELECT f.amount_cents FROM bills f WHERE f.card_id = k.id AND f.status = 'aberta'
       ORDER BY f.closes_on DESC LIMIT 1) AS valor_centavos
  FROM cards k
  WHERE k.bank_item_id = ?
  ORDER BY k.last4, k.id`;

// As 10 execuções mais recentes do banco (sync_runs_bank_item_started_idx).
export const SQL_EXECUCOES_DO_BANCO = `SELECT r.id, r.kind, r.started_at, r.finished_at, r.status, r.new_transactions,
    r.progress_pct, r.error_code
  FROM sync_runs r
  WHERE r.bank_item_id = ?
  ORDER BY r.started_at DESC, r.id DESC
  LIMIT 10`;

export type LinhaDoItem = {
  id: string;
  connection_id: string;
  institution_name: string;
  institution_color: string | null;
  consent_expires_at: string | null;
  last_sync_at: string | null;
  status: string;
  disconnected_at: string | null;
  connection_label: string;
  aberta: number;
  ultimo_status: string | null;
  ultimo_erro: string | null;
};

export type DetalheDoBanco = DetalheDoBancoDto;

// null: o banco não existe ou é de outro lar (a rota responde 404).
export async function getBankItemDetail(
  db: Db,
  householdId: string,
  bankItemId: string,
): Promise<DetalheDoBanco | null> {
  const [itemRes, contasRes, cartoesRes, execucoesRes] = await db.$client.batch([
    db.$client.prepare(SQL_ITEM_DO_LAR).bind(bankItemId, householdId),
    db.$client.prepare(SQL_CONTAS_DO_BANCO).bind(bankItemId),
    db.$client.prepare(SQL_CARTOES_DO_BANCO).bind(bankItemId),
    db.$client.prepare(SQL_EXECUCOES_DO_BANCO).bind(bankItemId),
  ]);
  const item = (itemRes.results as LinhaDoItem[])[0];
  if (!item) return null;

  const situacao = situacaoDoBanco({
    ultimoStatus: item.ultimo_status,
    ultimoErro: item.ultimo_erro,
    aberta: item.aberta === 1,
  });
  const contas = (
    contasRes.results as {
      id: string;
      kind: string;
      name: string;
      balance_cents: number;
      balance_at: string;
    }[]
  ).map((linha) => ({
    id: linha.id,
    kind: linha.kind,
    name: linha.name,
    balanceCents: linha.balance_cents,
    balanceAt: linha.balance_at,
  }));
  const cartoes = (
    cartoesRes.results as {
      id: string;
      name: string;
      last4: string;
      fecha_em: string | null;
      valor_centavos: number | null;
    }[]
  ).map((linha) => ({
    id: linha.id,
    name: linha.name,
    last4: linha.last4,
    openBill:
      linha.fecha_em === null ? null : { closesOn: linha.fecha_em, amountCents: linha.valor_centavos },
  }));
  const execucoes = (
    execucoesRes.results as {
      id: string;
      kind: string;
      started_at: string;
      finished_at: string | null;
      status: string | null;
      new_transactions: number;
      progress_pct: number;
      error_code: string | null;
    }[]
  ).map((linha) => ({
    id: linha.id,
    kind: linha.kind,
    startedAt: linha.started_at,
    finishedAt: linha.finished_at,
    status: linha.status,
    newTransactions: linha.new_transactions,
    progressPct: linha.progress_pct,
    errorCode: linha.error_code,
  }));

  return {
    id: item.id,
    institutionName: item.institution_name,
    institutionColor: item.institution_color,
    connection: { id: item.connection_id, label: item.connection_label },
    status: item.status,
    disconnectedAt: item.disconnected_at,
    consentExpiresAt: item.consent_expires_at,
    lastSyncAt: item.last_sync_at,
    running: item.aberta === 1,
    failed: situacao.failed,
    canRetry: situacao.canRetry,
    accounts: contas,
    cards: cartoes,
    runs: execucoes,
  };
}
