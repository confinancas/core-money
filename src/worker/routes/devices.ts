// Aparelhos (TASK-0106): a lista do lar, "Adicionar este aparelho" (opções e verificação) e remover. Todas exigem
// sessão e trabalham no lar da sessão. Remover encerra as sessões do aparelho na hora.
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { deviceNameFromUserAgent } from "../../shared/device-name";
import { COOKIE_DA_SESSAO } from "../auth/sessions";
import {
  type RegistroVerificado,
  registrationOptions,
  relyingParty,
  saveChallenge,
  takeChallenge,
  type WebAuthnVerifier,
} from "../auth/webauthn";
import {
  agrupaAparelhos,
  excludeCredentialsDe,
  type LinhaDoLar,
  passkeysDaPessoa,
  removeAparelho,
  SQL_APARELHO_DO_LAR,
  SQL_APARELHOS_DO_LAR,
} from "../devices/service";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";
import { lerCorpo, respondeDadosInvalidos } from "../setup/chaves";

const MENSAGEM_NAO_AUTENTICADO = "Entre de novo para continuar.";
const MENSAGEM_NAO_ENCONTRADO = "Aparelho não encontrado neste lar.";
const MENSAGEM_JA_CADASTRADO = "Este aparelho já tem uma passkey sua.";
const MENSAGEM_DESAFIO = "Demorou demais. Toque em Adicionar este aparelho de novo.";
const MENSAGEM_PASSKEY = "Não deu para confirmar a passkey. Toque em Adicionar este aparelho de novo.";

export function devicesRoutes(
  webauthn: WebAuthnVerifier,
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  const comSessao = requireHousehold(resolveSession);

  // Todas as pessoas do lar, com os aparelhos de cada uma (o aparelho desta sessão vem marcado).
  rotas.get("/", comSessao, async (c) => {
    const sessao = getSession(c);
    const { results } = await c.var.db.$client
      .prepare(SQL_APARELHOS_DO_LAR)
      .bind(sessao.householdId)
      .all<LinhaDoLar>();
    const members = agrupaAparelhos(results, sessao.memberId, c.var.session?.passkeyId);
    return c.json({ members }, 200);
  });

  // "Adicionar este aparelho" (1 de 2): as opções de registro para a pessoa da sessão, sem as passkeys dela.
  rotas.post("/options", comSessao, async (c) => {
    const sessao = getSession(c);
    const d1 = c.var.db.$client;
    const pessoa = await d1
      .prepare("SELECT name, email FROM members WHERE id = ?")
      .bind(sessao.memberId)
      .first<{ name: string; email: string | null }>();
    if (!pessoa) return apiError(c, 401, "nao_autenticado", MENSAGEM_NAO_AUTENTICADO);

    const existentes = await passkeysDaPessoa(d1, sessao.memberId);
    const opcoes = await registrationOptions(
      relyingParty(c),
      { memberId: sessao.memberId, name: pessoa.name, email: pessoa.email },
      excludeCredentialsDe(existentes),
    );
    await saveChallenge(c, { purpose: "aparelho", memberId: sessao.memberId, challenge: opcoes.challenge });
    return c.json(opcoes, 200);
  });

  // "Adicionar este aparelho" (2 de 2): a passkey nova entra e a sessão deste aparelho passa a depender dela.
  rotas.post("/verify", comSessao, async (c) => {
    const sessao = getSession(c);
    const tokenHash = c.var.session?.tokenHash;
    if (!tokenHash) return apiError(c, 401, "nao_autenticado", MENSAGEM_NAO_AUTENTICADO);
    const corpo = await lerCorpo(c);
    if (corpo === null || typeof corpo.response !== "object" || corpo.response === null) {
      return respondeDadosInvalidos(c);
    }

    // Uso único: o desafio some aqui. Um desafio de outra pessoa não serve para este aparelho.
    const desafio = await takeChallenge(c, "aparelho");
    if (!desafio || desafio.memberId !== sessao.memberId) {
      return apiError(c, 400, "desafio_expirado", MENSAGEM_DESAFIO);
    }

    let registro: RegistroVerificado | null;
    try {
      registro = await webauthn.verifyRegistration({
        response: corpo.response as RegistrationResponseJSON,
        expectedChallenge: desafio.challenge,
        rp: relyingParty(c),
      });
    } catch {
      registro = null;
    }
    if (!registro) return apiError(c, 400, "passkey_invalida", MENSAGEM_PASSKEY);

    const d1 = c.var.db.$client;
    const jaExiste = await d1.prepare("SELECT 1 AS n FROM passkeys WHERE id = ?").bind(registro.id).first();
    if (jaExiste) return apiError(c, 409, "aparelho_ja_cadastrado", MENSAGEM_JA_CADASTRADO);

    const momento = agora();
    const agoraIso = momento.toISOString();
    const dispositivo = deviceNameFromUserAgent(c.req.header("user-agent"));
    const resultados = await d1.batch([
      d1
        .prepare(
          "INSERT INTO passkeys (id, member_id, public_key, counter, transports, device_name, added_via, created_at, last_used_at) SELECT ?, ?, ?, ?, ?, ?, 'aparelho', ?, NULL WHERE EXISTS (SELECT 1 FROM sessions WHERE token_hash = ? AND member_id = ?)",
        )
        .bind(
          registro.id,
          sessao.memberId,
          registro.publicKey,
          registro.counter,
          registro.transports === null ? null : JSON.stringify(registro.transports),
          dispositivo,
          agoraIso,
          tokenHash,
          sessao.memberId,
        ),
      d1
        .prepare(
          "UPDATE sessions SET passkey_id = ? WHERE token_hash = ? AND EXISTS (SELECT 1 FROM passkeys WHERE id = ? AND member_id = ?)",
        )
        .bind(registro.id, tokenHash, registro.id, sessao.memberId),
    ]);
    if (resultados[0]?.meta.changes !== 1 || resultados[1]?.meta.changes !== 1) {
      return apiError(c, 401, "nao_autenticado", MENSAGEM_NAO_AUTENTICADO);
    }

    return c.json(
      {
        device: {
          id: registro.id,
          deviceName: dispositivo,
          addedVia: "aparelho",
          createdAt: agoraIso,
          lastUsedAt: null,
          isCurrent: true,
        },
      },
      201,
    );
  });

  // Remover um aparelho do lar (de qualquer pessoa do lar, inclusive o último de alguém). As sessões dele acabam.
  rotas.delete("/:id", comSessao, async (c) => {
    const sessao = getSession(c);
    const id = c.req.param("id");
    const d1 = c.var.db.$client;
    const aparelho = await d1
      .prepare(SQL_APARELHO_DO_LAR)
      .bind(id)
      .first<{ id: string; household_id: string }>();
    if (!aparelho || aparelho.household_id !== sessao.householdId) {
      return apiError(c, 404, "aparelho_nao_encontrado", MENSAGEM_NAO_ENCONTRADO);
    }

    const removido = await removeAparelho(d1, id);
    if (!removido) return apiError(c, 404, "aparelho_nao_encontrado", MENSAGEM_NAO_ENCONTRADO);

    const endedCurrentSession = c.var.session?.passkeyId === id;
    if (endedCurrentSession) deleteCookie(c, COOKIE_DA_SESSAO, { path: "/" });
    return c.json({ endedCurrentSession }, 200);
  });

  return rotas;
}
