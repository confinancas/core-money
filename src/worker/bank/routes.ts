// Rotas do banco conectado (TASK-0206): o detalhe, a conferência do consentimento, desconectar e conectar de novo.
// Todas exigem sessão e trabalham no lar da sessão: banco de outro lar responde 404, antes de qualquer efeito.
// "Baixar agora" fica em sync/routes.ts (TASK-0205).
import { Hono } from "hono";
import { MAXIMO_DE_BANCOS_ATIVOS, MENSAGEM_LIMITE_DO_PLUGGY } from "../../shared/pluggy-api";
import type { Db } from "../db/client";
import type { AppEnv, Env } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";
import { type ContextoDeConexao, clientForConnection } from "../pluggy/connections";
import { PluggyError } from "../pluggy/errors";
import { respondeDeErro } from "../pluggy/routes";
import { enqueueSlice } from "../sync/enqueue";
import { startRun } from "../sync/runs";
import { getBankItemDetail, type LinhaDoItem, SQL_ITEM_DO_LAR } from "./detail";

export type OpcoesDasRotasDoBanco = {
  agora?: () => Date;
  fetch?: typeof fetch;
};

// O banco do lar da sessão, com a conexão e o estado de execução. Null: não existe ou é de outro lar.
async function bancoDoLar(db: Db, householdId: string, bankItemId: string): Promise<LinhaDoItem | null> {
  const linha = await db.$client.prepare(SQL_ITEM_DO_LAR).bind(bankItemId, householdId).first<LinhaDoItem>();
  return linha ?? null;
}

// Validade que o Pluggy devolve (ISO). Comparar por texto é seguro: o formato é o mesmo.
function renovou(gravada: string | null, nova: string | null): boolean {
  if (nova === null) return false;
  return gravada === null || nova > gravada;
}

export function bankItemsRoutes(
  resolveSession: SessionResolver,
  opcoes: OpcoesDasRotasDoBanco = {},
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  const agora = opcoes.agora ?? (() => new Date());
  rotas.use(requireHousehold(resolveSession));

  rotas.get("/:id", async (c) => {
    const { householdId } = getSession(c);
    const detalhe = await getBankItemDetail(c.var.db, householdId, c.req.param("id"));
    if (!detalhe) return apiError(c, 404, "banco_nao_encontrado", "Banco não encontrado.");
    return c.json(detalhe, 200);
  });

  // Conferência do consentimento: lê o item no Pluggy, grava a validade e o status. Item que sumiu → acao_necessaria.
  rotas.post("/:id/consent-check", async (c) => {
    const { householdId } = getSession(c);
    const bankItemId = c.req.param("id");
    const banco = await bancoDoLar(c.var.db, householdId, bankItemId);
    if (!banco) return apiError(c, 404, "banco_nao_encontrado", "Banco não encontrado.");
    if (banco.disconnected_at !== null) {
      return apiError(c, 409, "banco_desconectado", "Este banco está desconectado.");
    }
    const ctx: ContextoDeConexao = {
      db: c.var.db,
      env: c.env as Env,
      householdId,
      fetch: opcoes.fetch,
      agora,
    };
    try {
      const cliente = await clientForConnection(ctx, banco.connection_id);
      const item = await cliente.getItem(bankItemId);
      const agoraIso = agora().toISOString();
      const nova = item.consentExpiresAt;
      const vencido = nova !== null && nova < agoraIso;
      const problema =
        vencido ||
        item.status === "LOGIN_ERROR" ||
        item.status === "WAITING_USER_INPUT" ||
        item.error !== null;
      // Problema vira acao_necessaria; sem problema, a pendência de acao_necessaria se resolve. O resto fica como está.
      const novoStatus = problema
        ? "acao_necessaria"
        : banco.status === "acao_necessaria"
          ? "ativo"
          : banco.status;
      await c.var.db.$client
        .prepare("UPDATE bank_items SET consent_expires_at = ?, status = ? WHERE id = ?")
        .bind(nova ?? banco.consent_expires_at, novoStatus, bankItemId)
        .run();
      return c.json(
        {
          renewed: renovou(banco.consent_expires_at, nova),
          consentExpiresAt: nova ?? banco.consent_expires_at,
          itemMissing: false,
        },
        200,
      );
    } catch (erro) {
      if (erro instanceof PluggyError && erro.kind === "not_found") {
        await c.var.db.$client
          .prepare("UPDATE bank_items SET status = 'acao_necessaria' WHERE id = ?")
          .bind(bankItemId)
          .run();
        return c.json({ renewed: false, consentExpiresAt: banco.consent_expires_at, itemMissing: true }, 200);
      }
      return respondeDeErro(c, erro);
    }
  });

  // Desconectar: marca disconnected_at e encerra a execução aberta com 'desconectado'. Nada é apagado. Idempotente.
  rotas.post("/:id/disconnect", async (c) => {
    const { householdId } = getSession(c);
    const bankItemId = c.req.param("id");
    const banco = await bancoDoLar(c.var.db, householdId, bankItemId);
    if (!banco) return apiError(c, 404, "banco_nao_encontrado", "Banco não encontrado.");
    if (banco.disconnected_at !== null) {
      return c.json({ disconnectedAt: banco.disconnected_at }, 200);
    }
    const agoraIso = agora().toISOString();
    await c.var.db.$client.batch([
      c.var.db.$client
        .prepare("UPDATE bank_items SET disconnected_at = ? WHERE id = ? AND disconnected_at IS NULL")
        .bind(agoraIso, bankItemId),
      c.var.db.$client
        .prepare(
          `UPDATE sync_runs SET finished_at = ?, status = 'erro', error_code = 'desconectado'
           WHERE bank_item_id = ? AND finished_at IS NULL`,
        )
        .bind(agoraIso, bankItemId),
    ]);
    return c.json({ disconnectedAt: agoraIso }, 200);
  });

  // Conectar de novo: limpa a desconexão e abre uma importação (historico). Nada duplica: a gravação é idempotente.
  rotas.post("/:id/reconnect", async (c) => {
    const { householdId } = getSession(c);
    const bankItemId = c.req.param("id");
    const banco = await bancoDoLar(c.var.db, householdId, bankItemId);
    if (!banco) return apiError(c, 404, "banco_nao_encontrado", "Banco não encontrado.");
    if (banco.disconnected_at === null)
      return apiError(c, 409, "banco_conectado", "Este banco já está conectado.");
    // Limite do Meu Pluggy gratuito (A1, Fable): os bancos ativos da conexão, contados antes de voltar este.
    const ativos = await c.var.db.$client
      .prepare("SELECT COUNT(*) AS n FROM bank_items WHERE connection_id = ? AND disconnected_at IS NULL")
      .bind(banco.connection_id)
      .first<{ n: number }>();
    if ((ativos?.n ?? 0) >= MAXIMO_DE_BANCOS_ATIVOS) {
      return apiError(c, 409, "limite_meu_pluggy", MENSAGEM_LIMITE_DO_PLUGGY);
    }
    await c.var.db.$client
      .prepare("UPDATE bank_items SET disconnected_at = NULL, status = 'ativo' WHERE id = ?")
      .bind(bankItemId)
      .run();
    const runId = await startRun(c.var.db, bankItemId, "historico", agora().toISOString());
    if (runId === null) return apiError(c, 409, "atualizacao_em_andamento", "Já está atualizando.");
    try {
      await enqueueSlice(c.env as Env, { runId, seq: 0 });
    } catch (erro) {
      console.error(`conectar de novo: ${erro instanceof Error ? erro.name : "erro"}`);
    }
    return c.json({ runId }, 202);
  });

  return rotas;
}
