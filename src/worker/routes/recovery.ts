// Recuperação de acesso (TASK-0106). Com sessão: POST /api/recovery-invites (o parceiro gera o link de 15 min).
// Públicas (PUBLIC_API_ROUTES): consultar o link pelo token e cadastrar a passkey nova em duas etapas (opções e
// verificação). O link de uso único é gasto no mesmo lote que grava a passkey e a sessão.
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import type { Context } from "hono";
import { Hono } from "hono";
import { sha256Hex } from "../../shared/access-code";
import { deviceNameFromUserAgent } from "../../shared/device-name";
import { newSessionToken, sessaoDoCookie, sessionExpiresAt, setSessionCookie } from "../auth/sessions";
import {
  type RegistroVerificado,
  registrationOptions,
  relyingParty,
  saveChallenge,
  takeChallenge,
  type WebAuthnVerifier,
} from "../auth/webauthn";
import { excludeCredentialsDe, passkeysDaPessoa } from "../devices/service";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";
import type { InviteStatus } from "../invites/status";
import {
  criaLinkDeRecuperacao,
  findRecoveryByToken,
  type RecuperacaoRow,
  situacaoDaRecuperacao,
} from "../recovery/service";
import { lerCorpo, respondeDadosInvalidos } from "../setup/chaves";

const MENSAGEM_INVALIDO = "Link de recuperação inválido. Confira se copiou o link inteiro.";
const MENSAGEM_VENCIDO = "Este link venceu. Peça um novo.";
const MENSAGEM_USADO = "Este link já foi usado.";
const MENSAGEM_CANCELADO = "Este link foi trocado por um mais novo.";
const MENSAGEM_JA_CONECTADO = "Você já tem acesso neste navegador. Mande este link para a pessoa.";
const MENSAGEM_DESAFIO = "Demorou demais. Toque em Criar passkey de novo.";
const MENSAGEM_PASSKEY = "Não deu para confirmar a passkey. Toque em Criar passkey de novo.";
const MENSAGEM_USE_ADICIONAR = "Para o seu próprio acesso, use Adicionar este aparelho.";
const MENSAGEM_MEMBRO = "Pessoa não encontrada neste lar.";

const TAMANHO_MAXIMO_DO_TOKEN = 200;

function lerToken(corpo: Record<string, unknown>): string | null {
  const token = corpo.token;
  if (typeof token !== "string" || token.length === 0 || token.length > TAMANHO_MAXIMO_DO_TOKEN) return null;
  return token;
}

// As situações de um link que não vale mais (410), com o que a tela precisa para a mensagem.
function respondeSituacao(
  c: Context<AppEnv>,
  situacao: Exclude<InviteStatus, "aguardando">,
  linha: RecuperacaoRow,
) {
  if (situacao === "vencido") {
    return c.json(
      { error: "link_vencido", message: MENSAGEM_VENCIDO, expiresAt: linha.expires_at ?? "" },
      410,
    );
  }
  if (situacao === "usado") return apiError(c, 410, "link_usado", MENSAGEM_USADO);
  return apiError(c, 410, "link_cancelado", MENSAGEM_CANCELADO);
}

export function recoveryRoutes(
  webauthn: WebAuthnVerifier,
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  const comSessao = requireHousehold(resolveSession);

  // O parceiro gera o link de 15 min para outra pessoa do lar. O link só sai nesta resposta.
  rotas.post("/recovery-invites", comSessao, async (c) => {
    const sessao = getSession(c);
    const corpo = await lerCorpo(c);
    if (corpo === null || typeof corpo.memberId !== "string" || corpo.memberId === "") {
      return respondeDadosInvalidos(c);
    }
    if (corpo.memberId === sessao.memberId) {
      return apiError(c, 400, "use_adicionar_aparelho", MENSAGEM_USE_ADICIONAR);
    }

    const criado = await criaLinkDeRecuperacao(c.var.db.$client, {
      householdId: sessao.householdId,
      memberId: corpo.memberId,
      createdBy: sessao.memberId,
      agora: agora(),
    });
    if (!criado.ok) return apiError(c, 404, "membro_nao_encontrado", MENSAGEM_MEMBRO);
    return c.json(
      {
        link: `${new URL(c.req.url).origin}/recuperar/${criado.novo.token}`,
        expiresAt: criado.novo.expiraEm,
        memberName: criado.novo.nomeDoMembro,
      },
      201,
    );
  });

  // Pública: a tela mostra quem liberou (ou que foi o comando) e para quem é o link.
  rotas.post("/recovery/inspect", async (c) => {
    const corpo = await lerCorpo(c);
    if (corpo === null) return respondeDadosInvalidos(c);
    const token = lerToken(corpo);
    if (token === null) return respondeDadosInvalidos(c);

    const linha = await findRecoveryByToken(c.var.db.$client, token);
    if (!linha) return apiError(c, 404, "link_invalido", MENSAGEM_INVALIDO);
    const situacao = situacaoDaRecuperacao(linha, agora());
    if (situacao !== "aguardando") return respondeSituacao(c, situacao, linha);
    return c.json(
      {
        memberName: linha.member_name,
        expiresAt: linha.expires_at ?? "",
        source: linha.created_by === null ? "comando" : "parceiro",
        createdByName: linha.created_by_name,
      },
      200,
    );
  });

  // Pública, 1 de 2: as opções da passkey nova para a pessoa do link (sem as passkeys que ela já tem).
  rotas.post("/recovery/options", async (c) => {
    const corpo = await lerCorpo(c);
    if (corpo === null) return respondeDadosInvalidos(c);
    const token = lerToken(corpo);
    if (token === null) return respondeDadosInvalidos(c);

    const d1 = c.var.db.$client;
    const linha = await findRecoveryByToken(d1, token);
    if (!linha) return apiError(c, 404, "link_invalido", MENSAGEM_INVALIDO);
    const situacao = situacaoDaRecuperacao(linha, agora());
    if (situacao !== "aguardando") return respondeSituacao(c, situacao, linha);
    if (await sessaoDoCookie(c)) return apiError(c, 409, "ja_conectado", MENSAGEM_JA_CONECTADO);

    const existentes = await passkeysDaPessoa(d1, linha.member_id);
    const opcoes = await registrationOptions(
      relyingParty(c),
      { memberId: linha.member_id, name: linha.member_name, email: linha.member_email },
      excludeCredentialsDe(existentes),
    );
    await saveChallenge(c, {
      purpose: "recuperacao",
      memberId: linha.member_id,
      challenge: opcoes.challenge,
    });
    return c.json(opcoes, 200);
  });

  // Pública, 2 de 2: confere a passkey e, no mesmo lote, gasta o link e grava a passkey e a sessão.
  rotas.post("/recovery/verify", async (c) => {
    const corpo = await lerCorpo(c);
    if (corpo === null) return respondeDadosInvalidos(c);
    const token = lerToken(corpo);
    if (token === null) return respondeDadosInvalidos(c);
    if (typeof corpo.response !== "object" || corpo.response === null) return respondeDadosInvalidos(c);

    // Uso único do desafio: o desafio some aqui. Ele tem de ser o da pessoa deste link.
    const desafio = await takeChallenge(c, "recuperacao");
    if (!desafio || desafio.memberId === null) return apiError(c, 400, "desafio_expirado", MENSAGEM_DESAFIO);

    const d1 = c.var.db.$client;
    const linha = await findRecoveryByToken(d1, token);
    if (!linha) return apiError(c, 404, "link_invalido", MENSAGEM_INVALIDO);
    if (desafio.memberId !== linha.member_id) return apiError(c, 400, "desafio_expirado", MENSAGEM_DESAFIO);
    const situacao = situacaoDaRecuperacao(linha, agora());
    if (situacao !== "aguardando") return respondeSituacao(c, situacao, linha);
    if (await sessaoDoCookie(c)) return apiError(c, 409, "ja_conectado", MENSAGEM_JA_CONECTADO);

    // A cerimônia vem antes do lote: uma passkey que não confere não gasta o link.
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

    const momento = agora();
    const agoraIso = momento.toISOString();
    const tokenDaSessao = newSessionToken();
    const tokenHash = await sha256Hex(tokenDaSessao);
    const dispositivo = deviceNameFromUserAgent(c.req.header("user-agent"));

    // Um lote só. O link é gasto (UPDATE) só se a passkey entrou no mesmo lote, e a sessão só entra se a passkey
    // existe. Duas abas com o mesmo link: o lote da segunda não grava nada, e a resposta é link_usado.
    const resultados = await d1.batch([
      d1
        .prepare(
          "INSERT INTO passkeys (id, member_id, public_key, counter, transports, device_name, added_via, created_at, last_used_at) SELECT ?, ?, ?, ?, ?, ?, 'recuperacao', ?, NULL WHERE EXISTS (SELECT 1 FROM invites WHERE id = ? AND kind = 'recuperacao' AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ?) AND EXISTS (SELECT 1 FROM members WHERE id = ?)",
        )
        .bind(
          registro.id,
          linha.member_id,
          registro.publicKey,
          registro.counter,
          registro.transports === null ? null : JSON.stringify(registro.transports),
          dispositivo,
          agoraIso,
          linha.id,
          agoraIso,
          linha.member_id,
        ),
      d1
        .prepare(
          "UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ? AND EXISTS (SELECT 1 FROM passkeys WHERE id = ? AND member_id = ? AND added_via = 'recuperacao')",
        )
        .bind(agoraIso, linha.id, agoraIso, registro.id, linha.member_id),
      d1
        .prepare(
          "INSERT INTO sessions (token_hash, member_id, passkey_id, created_at, last_seen_at, expires_at, notices_seen_at) SELECT ?, ?, ?, ?, ?, ?, NULL WHERE EXISTS (SELECT 1 FROM passkeys WHERE id = ? AND member_id = ?)",
        )
        .bind(
          tokenHash,
          linha.member_id,
          registro.id,
          agoraIso,
          agoraIso,
          sessionExpiresAt(momento),
          registro.id,
          linha.member_id,
        ),
    ]);

    if (resultados[0]?.meta.changes !== 1 || resultados[1]?.meta.changes !== 1) {
      // Nada foi gravado. A causa é a de agora: o link foi gasto, trocado ou venceu enquanto a passkey era criada.
      const depois = await findRecoveryByToken(d1, token);
      if (depois) {
        const situacaoDepois = situacaoDaRecuperacao(depois, momento);
        if (situacaoDepois !== "aguardando") return respondeSituacao(c, situacaoDepois, depois);
      }
      return apiError(c, 410, "link_usado", MENSAGEM_USADO);
    }

    setSessionCookie(c, tokenDaSessao);
    return c.json(
      {
        member: {
          id: linha.member_id,
          name: linha.member_name,
          email: linha.member_email,
          role: linha.member_role,
        },
      },
      201,
    );
  });

  return rotas;
}
