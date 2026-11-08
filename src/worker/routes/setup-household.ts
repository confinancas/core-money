// Cadastro do lar com passkey (TASK-0103): POST /api/setup/household/options e /verify. Abertas no modo cadastro
// (o portão deixa /api/setup/*); exigem o código de primeiro acesso (requireSetupCode).
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { sha256Hex } from "../../shared/access-code";
import { deviceNameFromUserAgent } from "../../shared/device-name";
import { memberEmailSchema, memberNameSchema } from "../../shared/household";
import {
  newSessionToken,
  sessionExpiresAt,
  sessionInsertStatement,
  setSessionCookie,
} from "../auth/sessions";
import {
  type RegistroVerificado,
  registrationOptions,
  relyingParty,
  saveChallenge,
  takeChallenge,
  type WebAuthnVerifier,
} from "../auth/webauthn";
import type { AppEnv } from "../env";
import { apiError } from "../http/errors";
import { lerCorpo, respondeDadosInvalidos } from "../setup/chaves";
import { COOKIE_DA_CONFIGURACAO, getSetupState, requireSetupCode } from "../setup/state";

const MENSAGEM_NOME = "Digite seu nome (até 40 letras).";
const MENSAGEM_EMAIL = "Confira o e-mail.";
const MENSAGEM_LAR_JA_EXISTE =
  "A conta do casal acabou de ser criada em outro aparelho. Entre com a passkey de quem criou.";

type DadosDoLar = { name: string; email: string | null };

// Nome e e-mail pelos schemas da TASK-0006 e da TASK-0103; a mensagem de cada campo é a da tela.
function lerDadosDoLar(
  corpo: Record<string, unknown>,
): { ok: true; dados: DadosDoLar } | { ok: false; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const nome = memberNameSchema.safeParse(corpo.name);
  if (!nome.success) fields.name = MENSAGEM_NOME;
  const email = memberEmailSchema.safeParse(corpo.email);
  if (!email.success) fields.email = MENSAGEM_EMAIL;
  if (!nome.success || !email.success) return { ok: false, fields };
  return { ok: true, dados: { name: nome.data, email: email.data } };
}

const respondeValidacao = (c: Parameters<typeof apiError>[0], fields: Record<string, string>) =>
  apiError(c, 400, "validacao", undefined, { fields });

export function setupHouseholdRoutes(webauthn: WebAuthnVerifier): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();

  rotas.post("/options", requireSetupCode(), async (c) => {
    const corpo = await lerCorpo(c);
    if (corpo === null) return respondeDadosInvalidos(c);
    const lido = lerDadosDoLar(corpo);
    if (!lido.ok) return respondeValidacao(c, lido.fields);

    const estado = await getSetupState(c.var.db, getCookie(c, COOKIE_DA_CONFIGURACAO));
    if (estado.hasMembers) return apiError(c, 409, "lar_ja_existe", MENSAGEM_LAR_JA_EXISTE);
    if (estado.mode !== "cadastro")
      return apiError(c, 503, "configuracao_pendente", "Configuração pendente.");

    const memberId = crypto.randomUUID();
    const opcoes = await registrationOptions(relyingParty(c), { memberId, ...lido.dados });
    await saveChallenge(c, { purpose: "cadastro", memberId, challenge: opcoes.challenge });
    return c.json(opcoes, 200);
  });

  rotas.post("/verify", requireSetupCode(), async (c) => {
    const corpo = await lerCorpo(c);
    if (corpo === null) return respondeDadosInvalidos(c);
    const lido = lerDadosDoLar(corpo);
    if (!lido.ok) return respondeValidacao(c, lido.fields);
    if (typeof corpo.response !== "object" || corpo.response === null) return respondeDadosInvalidos(c);

    const desafio = await takeChallenge(c, "cadastro");
    if (!desafio || desafio.memberId === null) {
      return apiError(c, 400, "desafio_expirado", "Demorou demais. Toque em Criar passkey de novo.");
    }

    const rp = relyingParty(c);
    let registro: RegistroVerificado | null;
    try {
      registro = await webauthn.verifyRegistration({
        response: corpo.response as RegistrationResponseJSON,
        expectedChallenge: desafio.challenge,
        rp,
      });
    } catch {
      registro = null;
    }
    if (!registro) {
      return apiError(
        c,
        400,
        "passkey_invalida",
        "Não deu para confirmar a passkey. Toque em Criar passkey de novo.",
      );
    }

    const { name, email } = lido.dados;
    const memberId = desafio.memberId;
    const householdId = crypto.randomUUID();
    const agora = new Date();
    const agoraIso = agora.toISOString();
    const hashDoCodigo = await sha256Hex(getCookie(c, COOKIE_DA_CONFIGURACAO) ?? "");
    const token = newSessionToken();
    const tokenHash = await sha256Hex(token);
    const d1 = c.var.db.$client;

    // Um lote só (uma transação). Cada passo confere o anterior: o código só é consumido se o lar nasce agora,
    // e a passkey e a sessão só entram se a pessoa entrou. Duas verificações juntas criam um lar só.
    const resultados = await d1.batch([
      d1
        .prepare(
          "UPDATE invites SET used_at = ? WHERE kind = 'primeiro_acesso' AND token_hash = ? AND used_at IS NULL AND cancelled_at IS NULL AND NOT EXISTS (SELECT 1 FROM households) AND NOT EXISTS (SELECT 1 FROM members)",
        )
        .bind(agoraIso, hashDoCodigo),
      d1
        .prepare(
          "INSERT INTO households (id, brand, created_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM households) AND EXISTS (SELECT 1 FROM invites WHERE kind = 'primeiro_acesso' AND token_hash = ? AND used_at = ?)",
        )
        .bind(householdId, c.var.marca.id, agoraIso, hashDoCodigo, agoraIso),
      d1
        .prepare(
          "INSERT INTO members (id, household_id, name, email, role, created_at) SELECT ?, ?, ?, ?, 'titular', ? WHERE NOT EXISTS (SELECT 1 FROM members) AND EXISTS (SELECT 1 FROM households WHERE id = ?) AND EXISTS (SELECT 1 FROM invites WHERE kind = 'primeiro_acesso' AND token_hash = ? AND used_at = ?)",
        )
        .bind(memberId, householdId, name, email, agoraIso, householdId, hashDoCodigo, agoraIso),
      d1
        .prepare(
          "INSERT INTO passkeys (id, member_id, public_key, counter, transports, device_name, added_via, created_at, last_used_at) SELECT ?, ?, ?, ?, ?, ?, 'cadastro', ?, NULL WHERE EXISTS (SELECT 1 FROM members WHERE id = ?)",
        )
        .bind(
          registro.id,
          memberId,
          registro.publicKey,
          registro.counter,
          registro.transports === null ? null : JSON.stringify(registro.transports),
          deviceNameFromUserAgent(c.req.header("user-agent")),
          agoraIso,
          memberId,
        ),
      sessionInsertStatement(d1, {
        tokenHash,
        memberId,
        passkeyId: registro.id,
        agora: agoraIso,
        expiraEm: sessionExpiresAt(agora),
      }),
    ]);

    // O passo 3 (a pessoa) não inseriu: já existe um lar. Nada ficou gravado pela metade (o lote é uma transação).
    if (resultados[2]?.meta.changes !== 1) return apiError(c, 409, "lar_ja_existe", MENSAGEM_LAR_JA_EXISTE);

    setSessionCookie(c, token);
    deleteCookie(c, COOKIE_DA_CONFIGURACAO, { path: "/api" });
    return c.json(
      { member: { id: memberId, name, email, role: "titular" }, household: { id: householdId } },
      201,
    );
  });

  return rotas;
}
