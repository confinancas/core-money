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

  // Com sessão: quem sou, o lar e as pessoas dele (o pé do menu). Sem sessão: 401 e o cookie apagado.
  rotas.get("/session", async (c) => {
    const sessao: SessionIdentity | null = await resolveSession(c);
    if (!sessao) return apiError(c, 401, "nao_autenticado", MENSAGEM_NAO_AUTENTICADO);
    const lar = await getHousehold(c.var.db, sessao.householdId);
    const eu = lar?.members.find((pessoa) => pessoa.id === sessao.memberId);
    if (!lar || !eu) {
      deleteCookie(c, COOKIE_DA_SESSAO, { path: "/" });
      return apiError(c, 401, "nao_autenticado", MENSAGEM_NAO_AUTENTICADO);
    }
    return c.json(
      {
        member: { id: eu.id, name: eu.name, email: eu.email, role: eu.role },
        household: { id: lar.household.id, brand: lar.household.brand },
        members: lar.members.map((pessoa) => ({ id: pessoa.id, name: pessoa.name, role: pessoa.role })),
        notices: [],
      },
      200,
    );
  });

  return rotas;
}
