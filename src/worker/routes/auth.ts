// Entrar com passkey, sair e a sessão atual (TASK-0104): POST /api/auth/login/options e /verify, POST /api/auth/logout,
// GET /api/auth/session. Todas são públicas no requireSession: quem decide a sessão aqui é o próprio resolvedor.
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { sha256Hex } from "../../shared/access-code";
import {
  COOKIE_DA_SESSAO,
  endSession,
  newSessionToken,
  sessionExpiresAt,
  sessionInsertStatement,
  setSessionCookie,
} from "../auth/sessions";
import {
  type PasskeyGuardada,
  relyingParty,
  saveChallenge,
  takeChallenge,
  type WebAuthnLoginVerifier,
} from "../auth/webauthn";
import { type AvisoDeAparelhoNovo, avisosDeAparelhoNovo } from "../devices/notices";
import type { AppEnv } from "../env";
import type { SessionIdentity, SessionResolver } from "../household/context";
import { getHousehold } from "../household/repository";
import { apiError } from "../http/errors";

const MENSAGEM_NAO_AUTENTICADO = "Entre de novo para continuar.";

type LinhaDaPasskey = {
  id: string;
  member_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  household_id: string;
  name: string;
  email: string | null;
  role: string;
};

// A passkey e a pessoa dela numa consulta: sem linha, a passkey não existe mais (ou foi removida).
const SQL_PASSKEY =
  "SELECT p.id, p.member_id, p.public_key, p.counter, p.transports, m.household_id, m.name, m.email, m.role FROM passkeys p JOIN members m ON m.id = p.member_id WHERE p.id = ?";

// Os aparelhos que entraram por recuperação e a sessão desta requisição, numa consulta. Sem linha, não há aviso.
const SQL_AVISOS_DA_SESSAO =
  "SELECT s.member_id AS sessao_member, s.passkey_id AS sessao_passkey, s.created_at AS sessao_criada, s.notices_seen_at AS sessao_vista, p.id, p.member_id, p.added_via, p.device_name, p.created_at FROM sessions s JOIN passkeys p ON p.member_id = s.member_id WHERE s.token_hash = ? AND p.added_via = 'recuperacao'";

type LinhaDeAviso = {
  sessao_member: string;
  sessao_passkey: string;
  sessao_criada: string;
  sessao_vista: string | null;
  id: string;
  member_id: string;
  added_via: string;
  device_name: string;
  created_at: string;
};

async function avisosDaSessao(d1: D1Database, tokenHash: string): Promise<AvisoDeAparelhoNovo[]> {
  const { results } = await d1.prepare(SQL_AVISOS_DA_SESSAO).bind(tokenHash).all<LinhaDeAviso>();
  const primeira = results[0];
  if (!primeira) return [];
  return avisosDeAparelhoNovo(
    results.map((linha) => ({
      id: linha.id,
      memberId: linha.member_id,
      addedVia: linha.added_via,
      deviceName: linha.device_name,
      createdAt: linha.created_at,
    })),
    {
      memberId: primeira.sessao_member,
      passkeyId: primeira.sessao_passkey,
      createdAt: primeira.sessao_criada,
      noticesSeenAt: primeira.sessao_vista,
    },
  );
}

// Corpo como objeto JSON; null quando não é um.
async function lerObjeto(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  try {
    const corpo: unknown = await c.req.json();
    if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) return null;
    return corpo as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function authRoutes(webauthn: WebAuthnLoginVerifier, resolveSession: SessionResolver): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();

  // Opções sem allowCredentials: o navegador oferece as passkeys do aparelho ou o QR code do celular.
  rotas.post("/login/options", async (c) => {
    const opcoes = await webauthn.authenticationOptions(relyingParty(c));
    await saveChallenge(c, { purpose: "login", memberId: null, challenge: opcoes.challenge });
    return c.json(opcoes, 200);
  });

  rotas.post("/login/verify", async (c) => {
    const corpo = await lerObjeto(c);
    if (corpo === null || typeof corpo.response !== "object" || corpo.response === null) {
      return apiError(c, 400, "dados_invalidos", "Dados inválidos.");
    }
    const resposta = corpo.response as AuthenticationResponseJSON;

    // Uso único: o desafio some aqui, veio ou não a verificação a dar certo.
    const desafio = await takeChallenge(c, "login");
    if (!desafio) {
      return apiError(c, 400, "desafio_expirado", "Demorou demais. Toque em Entrar com passkey de novo.");
    }

    const idDaPasskey = typeof resposta.id === "string" ? resposta.id : "";
    const linha = await c.var.db.$client.prepare(SQL_PASSKEY).bind(idDaPasskey).first<LinhaDaPasskey>();
    if (!linha) {
      return apiError(c, 401, "passkey_desconhecida", "Essa passkey não vale mais: o aparelho foi removido.");
    }

    const rp = relyingParty(c);
    let verificada: { newCounter: number } | null;
    try {
      const passkey: PasskeyGuardada = {
        id: linha.id,
        publicKey: linha.public_key,
        counter: linha.counter,
        transports: linha.transports === null ? null : (JSON.parse(linha.transports) as string[]),
      };
      verificada = await webauthn.verifyAuthentication({
        response: resposta,
        expectedChallenge: desafio.challenge,
        rp,
        passkey,
      });
    } catch {
      verificada = null;
    }
    if (!verificada) {
      return apiError(c, 401, "passkey_nao_confere", "A passkey não conferiu. Tente de novo.");
    }

    // Um lote só: o contador da passkey, a troca de sessão deste navegador (se já havia uma) e a sessão nova.
    const token = newSessionToken();
    const tokenHash = await sha256Hex(token);
    const agora = new Date();
    const agoraIso = agora.toISOString();
    const anterior = getCookie(c, COOKIE_DA_SESSAO);
    const d1 = c.var.db.$client;
    const comandos: D1PreparedStatement[] = [
      d1
        .prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?")
        .bind(verificada.newCounter, agoraIso, linha.id),
    ];
    if (anterior) {
      comandos.push(d1.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(anterior)));
    }
    comandos.push(
      sessionInsertStatement(d1, {
        tokenHash,
        memberId: linha.member_id,
        passkeyId: linha.id,
        agora: agoraIso,
        expiraEm: sessionExpiresAt(agora),
      }),
    );
    await d1.batch(comandos);

    setSessionCookie(c, token);
    return c.json(
      {
        member: { id: linha.member_id, name: linha.name, email: linha.email, role: linha.role },
        crossDevice: resposta.authenticatorAttachment === "cross-platform",
      },
      200,
    );
  });

  rotas.post("/logout", async (c) => {
    await endSession(c);
    return c.json({ ok: true }, 200);
  });

  // Com sessão: quem sou, o lar, as pessoas dele (o pé do menu) e os avisos de aparelho novo (TASK-0106).
  // Sem sessão: 401 e o cookie apagado.
  rotas.get("/session", async (c) => {
    const sessao: SessionIdentity | null = await resolveSession(c);
    if (!sessao) return apiError(c, 401, "nao_autenticado", MENSAGEM_NAO_AUTENTICADO);
    const lar = await getHousehold(c.var.db, sessao.householdId);
    const eu = lar?.members.find((pessoa) => pessoa.id === sessao.memberId);
    if (!lar || !eu) {
      deleteCookie(c, COOKIE_DA_SESSAO, { path: "/" });
      return apiError(c, 401, "nao_autenticado", MENSAGEM_NAO_AUTENTICADO);
    }
    const tokenHash = (sessao as { tokenHash?: string }).tokenHash;
    const notices = tokenHash ? await avisosDaSessao(c.var.db.$client, tokenHash) : [];
    return c.json(
      {
        member: { id: eu.id, name: eu.name, email: eu.email, role: eu.role },
        household: { id: lar.household.id, brand: lar.household.brand },
        members: lar.members.map((pessoa) => ({ id: pessoa.id, name: pessoa.name, role: pessoa.role })),
        notices,
      },
      200,
    );
  });

  // "Foi eu" (TASK-0106): marca os avisos de aparelho novo como vistos, só nesta sessão.
  rotas.post("/notices/seen", async (c) => {
    const tokenHash = c.var.session?.tokenHash;
    if (!tokenHash) return apiError(c, 401, "nao_autenticado", MENSAGEM_NAO_AUTENTICADO);
    await c.var.db.$client
      .prepare("UPDATE sessions SET notices_seen_at = ? WHERE token_hash = ?")
      .bind(new Date().toISOString(), tokenHash)
      .run();
    return c.json({ ok: true }, 200);
  });

  return rotas;
}
