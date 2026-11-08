// Sessão ligada ao aparelho (TASK-0103 cria o cookie e a linha; a TASK-0104 acrescenta o middleware e o "sair").
import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import { generateLinkToken } from "../../shared/access-code";
import type { AppEnv } from "../env";

export const COOKIE_DA_SESSAO = "mm_sess";
const DURACAO_DA_SESSAO_S = 30 * 24 * 60 * 60;

// Token de 32 bytes em base64url. O banco guarda só o sha256 dele (token_hash).
export function newSessionToken(): string {
  return generateLinkToken();
}

// Expiração: agora + 30 dias, em ISO 8601 UTC.
export function sessionExpiresAt(agora: Date): string {
  return new Date(agora.getTime() + DURACAO_DA_SESSAO_S * 1000).toISOString();
}

// INSERT condicional: a sessão só nasce se a pessoa existe (no mesmo lote da criação do lar).
export function sessionInsertStatement(
  d1: D1Database,
  sessao: {
    tokenHash: string;
    memberId: string;
    passkeyId: string;
    agora: string;
    expiraEm: string;
  },
): D1PreparedStatement {
  return d1
    .prepare(
      "INSERT INTO sessions (token_hash, member_id, passkey_id, created_at, last_seen_at, expires_at, notices_seen_at) SELECT ?, ?, ?, ?, ?, ?, NULL WHERE EXISTS (SELECT 1 FROM members WHERE id = ?)",
    )
    .bind(
      sessao.tokenHash,
      sessao.memberId,
      sessao.passkeyId,
      sessao.agora,
      sessao.agora,
      sessao.expiraEm,
      sessao.memberId,
    );
}

export function setSessionCookie(c: Context<AppEnv>, token: string): void {
  setCookie(c, COOKIE_DA_SESSAO, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: DURACAO_DA_SESSAO_S,
  });
}
