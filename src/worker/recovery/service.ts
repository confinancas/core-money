// Recuperação de acesso (TASK-0106): o link de recuperação de um membro do lar (gerado pelo parceiro, 15 min) e a
// consulta do link pelo token. O banco guarda só o sha256 do token, como nos convites.
import { generateLinkToken, sha256Hex } from "../../shared/access-code";
import { inviteStatus } from "../invites/status";

export const VALIDADE_DO_LINK_DO_PARCEIRO_MS = 15 * 60 * 1000;

// O link que o parceiro gera. created_by nulo quer dizer "pelo comando" (npm run recuperar-acesso).
export const SQL_RECUPERACAO_POR_TOKEN = `SELECT i.id, i.household_id, i.member_id, i.created_by, i.created_at, i.expires_at, i.used_at, i.cancelled_at, mb.name AS member_name, mb.email AS member_email, mb.role AS member_role, mc.name AS created_by_name FROM invites i JOIN members mb ON mb.id = i.member_id LEFT JOIN members mc ON mc.id = i.created_by WHERE i.token_hash = ? AND i.kind = 'recuperacao' AND i.household_id IS NOT NULL AND i.member_id IS NOT NULL`;

export type RecuperacaoRow = {
  id: string;
  household_id: string;
  member_id: string;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  used_at: string | null;
  cancelled_at: string | null;
  member_name: string;
  member_email: string | null;
  member_role: string;
  created_by_name: string | null;
};

export async function findRecoveryByToken(d1: D1Database, token: string): Promise<RecuperacaoRow | null> {
  const linha = await d1
    .prepare(SQL_RECUPERACAO_POR_TOKEN)
    .bind(await sha256Hex(token))
    .first<RecuperacaoRow>();
  return linha ?? null;
}

// Situação do link (a mesma ordem dos convites): usado, cancelado, vencido, aguardando.
export function situacaoDaRecuperacao(linha: RecuperacaoRow, agora: Date) {
  return inviteStatus(linha, agora);
}

export type NovoLinkDeRecuperacao = { token: string; expiraEm: string; nomeDoMembro: string };

// Gera o link do parceiro. Um lote: cancela o link aberto desse membro e grava o novo (duas gerações juntas dão um
// link só aberto, porque cada lote cancela o anterior). O membro tem de ser de outro ou do mesmo lar; quem chama
// confere que não é a própria pessoa.
export async function criaLinkDeRecuperacao(
  d1: D1Database,
  entrada: { householdId: string; memberId: string; createdBy: string; agora: Date },
): Promise<{ ok: true; novo: NovoLinkDeRecuperacao } | { ok: false }> {
  const alvo = await d1
    .prepare("SELECT id, name FROM members WHERE id = ? AND household_id = ?")
    .bind(entrada.memberId, entrada.householdId)
    .first<{ id: string; name: string }>();
  if (!alvo) return { ok: false };

  const token = generateLinkToken();
  const id = crypto.randomUUID();
  const agoraIso = entrada.agora.toISOString();
  const expiraEm = new Date(entrada.agora.getTime() + VALIDADE_DO_LINK_DO_PARCEIRO_MS).toISOString();
  await d1.batch([
    d1
      .prepare(
        "UPDATE invites SET cancelled_at = ? WHERE kind = 'recuperacao' AND member_id = ? AND used_at IS NULL AND cancelled_at IS NULL",
      )
      .bind(agoraIso, alvo.id),
    d1
      .prepare(
        "INSERT INTO invites (id, household_id, kind, token_hash, member_id, created_by, created_at, expires_at) SELECT ?, ?, 'recuperacao', ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM members WHERE id = ? AND household_id = ?)",
      )
      .bind(
        id,
        entrada.householdId,
        await sha256Hex(token),
        alvo.id,
        entrada.createdBy,
        agoraIso,
        expiraEm,
        alvo.id,
        entrada.householdId,
      ),
  ]);
  return { ok: true, novo: { token, expiraEm, nomeDoMembro: alvo.name } };
}
