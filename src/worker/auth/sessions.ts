// Sessão ligada ao aparelho (TASK-0103 criou o cookie e a linha; a TASK-0104 acrescenta o requireSession, a renovação
// e o "sair"). O banco guarda só o sha256 do token; o cookie leva o token.
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { generateLinkToken, sha256Hex } from "../../shared/access-code";
import type { AppEnv } from "../env";
import type { SessionIdentity, SessionResolver } from "../household/context";
import { apiError } from "../http/errors";
import { shouldRenew } from "./renovacao";

export const COOKIE_DA_SESSAO = "mm_sess";
const DURACAO_DA_SESSAO_S = 30 * 24 * 60 * 60;

// Quem está logado, com os campos da sessão. É um superconjunto do SessionIdentity do lar (TASK-0006).
export type SessaoAutenticada = SessionIdentity & {
  tokenHash: string;
  passkeyId: string;
  role: string;
};

// Token de 32 bytes em base64url. O banco guarda só o sha256 dele (token_hash).
export function newSessionToken(): string {
  return generateLinkToken();
}

// Expiração: agora + 30 dias, em ISO 8601 UTC.
export function sessionExpiresAt(agora: Date): string {
  return new Date(agora.getTime() + DURACAO_DA_SESSAO_S * 1000).toISOString();
}

// INSERT condicional: a sessão só nasce se a pessoa existe (no mesmo lote da criação do lar ou do login).
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

type LinhaDaSessao = {
  token_hash: string;
  member_id: string;
  passkey_id: string;
  last_seen_at: string;
  household_id: string;
  role: string;
};

// Uma consulta: a sessão vigente com o membro e o lar. Sem cookie, sem linha: null (e o cookie some).
const SQL_SESSAO =
  "SELECT s.token_hash, s.member_id, s.passkey_id, s.last_seen_at, m.household_id, m.role FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token_hash = ?1 AND s.expires_at > ?2";

// A escrita da renovação sai depois da resposta (waitUntil). Sem ExecutionContext (testes com app.request), a promessa
// roda sozinha, e um erro dela só vai para o log.
function aposResposta(c: Context<AppEnv>, escrita: Promise<unknown>): void {
  escrita.catch((erro: unknown) => console.error(`renovação da sessão: ${String(erro)}`));
  try {
    c.executionCtx.waitUntil(escrita);
  } catch {
    // sem ExecutionContext: a promessa já foi disparada
  }
}

// Resolve a sessão pelo cookie mm_sess. É o resolvedor real: as rotas de /api e a /api/auth/session usam o mesmo.
// Renova a sessão quando o uso passou de 24 h (um UPDATE, depois da resposta, e o cookie com os 30 dias de novo).
export async function sessaoDoCookie(c: Context<AppEnv>): Promise<SessaoAutenticada | null> {
  const token = getCookie(c, COOKIE_DA_SESSAO);
  if (!token) return null;
  const agora = new Date();
  const tokenHash = await sha256Hex(token);
  const linha = await c.var.db.$client
    .prepare(SQL_SESSAO)
    .bind(tokenHash, agora.toISOString())
    .first<LinhaDaSessao>();
  if (!linha) {
    deleteCookie(c, COOKIE_DA_SESSAO, { path: "/" });
    return null;
  }

  if (shouldRenew(linha.last_seen_at, agora)) {
    const agoraIso = agora.toISOString();
    aposResposta(
      c,
      c.var.db.$client
        .prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?")
        .bind(agoraIso, sessionExpiresAt(agora), tokenHash)
        .run(),
    );
    setSessionCookie(c, token);
  }

  return {
    tokenHash,
    memberId: linha.member_id,
    passkeyId: linha.passkey_id,
    householdId: linha.household_id,
    role: linha.role,
  };
}

// Exige sessão. Grava c.var.session; sem sessão, 401 nao_autenticado (o cookie já foi apagado pelo resolvedor).
// O resolvedor vem de fora nos testes (createApp({ resolveSession })) e é sessaoDoCookie no Worker.
export function requireSession(resolver: SessionResolver = sessaoDoCookie): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const sessao = await resolver(c);
    if (!sessao) return apiError(c, 401, "nao_autenticado", "Entre de novo para continuar.");
    c.set("session", sessao);
    await next();
  };
}

// Sair: apaga a linha da sessão deste aparelho (se o cookie existir) e o cookie. Outros aparelhos ficam como estão.
export async function endSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, COOKIE_DA_SESSAO);
  if (token) {
    await c.var.db.$client
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await sha256Hex(token))
      .run();
  }
  deleteCookie(c, COOKIE_DA_SESSAO, { path: "/" });
}
