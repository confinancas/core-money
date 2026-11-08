// Convites de cônjuge (TASK-0105). Com sessão (requireHousehold por rota): listar, criar, gerar um link novo e cancelar,
// sempre do lar da sessão. Públicas (PUBLIC_API_ROUTES): consultar o convite pelo token e o aceite em duas etapas
// (opções e verificação da passkey). Nenhuma rota pública usa middleware do router, para não exigir sessão.
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import type { Context } from "hono";
import { Hono } from "hono";
import { sha256Hex } from "../../shared/access-code";
import { deviceNameFromUserAgent } from "../../shared/device-name";
import { memberEmailSchema, memberNameSchema } from "../../shared/household";
import {
  newSessionToken,
  sessaoDoCookie,
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
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";
import {
  cancelInvite,
  conjugeExiste,
  createSpouseInvite,
  findInviteByToken,
  listActiveInvites,
  type NovoConvite,
  nomeDaPessoa,
  renewInvite,
} from "../invites/service";
import { type InviteRow, inviteStatus } from "../invites/status";
import { lerCorpo, respondeDadosInvalidos } from "../setup/chaves";

const MENSAGEM_NOME = "Digite seu nome (até 40 letras).";
const MENSAGEM_EMAIL = "Confira o e-mail.";
const MENSAGEM_CONVITE_ATIVO = "Já há um convite aguardando. Gere um link novo ou cancele o atual.";
const MENSAGEM_CONJUGE_JA_EXISTE = "Este lar já tem um cônjuge.";
const MENSAGEM_NAO_ENCONTRADO = "Convite não encontrado.";
const MENSAGEM_INVALIDO = "Link de convite inválido. Confira se copiou o link inteiro.";
const MENSAGEM_VENCIDO = "Este convite venceu. Peça um link novo a quem convidou.";
const MENSAGEM_USADO = "Este convite já foi usado. Se foi você, entre com sua passkey.";
const MENSAGEM_CANCELADO = "Este convite foi cancelado.";
const MENSAGEM_JA_CONECTADO = "Você já está entrado neste aparelho.";
const MENSAGEM_DESAFIO = "Demorou demais. Toque em Criar passkey de novo.";
const MENSAGEM_PASSKEY = "Não deu para confirmar a passkey. Toque em Criar passkey de novo.";

const TAMANHO_MAXIMO_DO_TOKEN = 200;

// Um motivo de 409 de criar ou gerar novo: o código e a mensagem da convenção.
const MENSAGENS_DE_CONFLITO: Record<string, string> = {
  convite_ativo: MENSAGEM_CONVITE_ATIVO,
  conjuge_ja_existe: MENSAGEM_CONJUGE_JA_EXISTE,
};

// O link é o endereço deste Worker mais o caminho da tela. Só sai na resposta de criar ou de gerar novo.
function linkDoConvite(c: Context<AppEnv>, token: string): string {
  return `${new URL(c.req.url).origin}/convite/${token}`;
}

function respondeNovoConvite(c: Context<AppEnv>, novo: NovoConvite) {
  return c.json({ invite: novo.convite, link: linkDoConvite(c, novo.token) }, 201);
}

// Nome e e-mail do cônjuge pelos schemas do lar: a mesma regra da tela e do cadastro.
function lerDadosDoConvite(
  corpo: Record<string, unknown>,
): { ok: true; name: string; email: string | null } | { ok: false; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const nome = memberNameSchema.safeParse(corpo.name);
  if (!nome.success) fields.name = MENSAGEM_NOME;
  const email = memberEmailSchema.safeParse(corpo.email);
  if (!email.success) fields.email = MENSAGEM_EMAIL;
  if (!nome.success || !email.success) return { ok: false, fields };
  return { ok: true, name: nome.data, email: email.data };
}

// O token vem do corpo, como texto curto. Qualquer outra coisa é um corpo inválido.
function lerToken(corpo: Record<string, unknown>): string | null {
  const token = corpo.token;
  if (typeof token !== "string" || token.length === 0 || token.length > TAMANHO_MAXIMO_DO_TOKEN) return null;
  return token;
}

// Os códigos de situação do convite (410), com o que a tela precisa para a mensagem (quem convidou e o vencimento).
function respondeSituacao(
  c: Context<AppEnv>,
  situacao: "vencido" | "usado" | "cancelado",
  convite: InviteRow,
) {
  if (situacao === "vencido") {
    return c.json(
      {
        error: "convite_vencido",
        message: MENSAGEM_VENCIDO,
        invitedBy: convite.created_by_name ?? "",
        expiresAt: convite.expires_at,
      },
      410,
    );
  }
  if (situacao === "usado") return apiError(c, 410, "convite_usado", MENSAGEM_USADO);
  return apiError(c, 410, "convite_cancelado", MENSAGEM_CANCELADO);
}

// Convite de cônjuge para quem o abre: nulo quando não é um (ou não existe). A forma do 404 é a mesma para os dois.
async function conviteDoToken(c: Context<AppEnv>, token: string): Promise<InviteRow | null> {
  const convite = await findInviteByToken(c.var.db.$client, token);
  if (convite?.kind !== "conjuge" || convite.household_id === null) return null;
  return convite;
}

type ConviteParaAceitar =
  | { ok: true; convite: InviteRow; householdId: string }
  | { ok: false; resposta: Response };

// As checagens do aceite, na ordem da spec: o convite existe e está aguardando; quem abre não tem sessão neste
// navegador; o lar ainda não tem cônjuge. A verificação de novo, depois do desafio, usa a mesma função.
async function conviteParaAceitar(
  c: Context<AppEnv>,
  token: string,
  agora: Date,
): Promise<ConviteParaAceitar> {
  const convite = await conviteDoToken(c, token);
  if (!convite || convite.household_id === null) {
    return { ok: false, resposta: apiError(c, 404, "convite_invalido", MENSAGEM_INVALIDO) };
  }
  const situacao = inviteStatus(convite, agora);
  if (situacao !== "aguardando") {
    return { ok: false, resposta: respondeSituacao(c, situacao, convite) };
  }
  if (await sessaoDoCookie(c)) {
    return { ok: false, resposta: apiError(c, 409, "ja_conectado", MENSAGEM_JA_CONECTADO) };
  }
  if (await conjugeExiste(c.var.db.$client, convite.household_id)) {
    return { ok: false, resposta: apiError(c, 409, "conjuge_ja_existe", MENSAGEM_CONJUGE_JA_EXISTE) };
  }
  return { ok: true, convite, householdId: convite.household_id };
}

export function invitesRoutes(
  webauthn: WebAuthnVerifier,
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  const comSessao = requireHousehold(resolveSession);

  // Os aguardando do lar, sem o link.
  rotas.get("/", comSessao, async (c) => {
    const { householdId } = getSession(c);
    const convites = await listActiveInvites(c.var.db.$client, householdId, agora());
    return c.json({ invites: convites }, 200);
  });

  // Criar: um cônjuge por lar e um convite aberto por vez. Devolve o link uma vez.
  rotas.post("/conjuge", comSessao, async (c) => {
    const { householdId, memberId } = getSession(c);
    const corpo = await lerCorpo(c);
    if (corpo === null) return respondeDadosInvalidos(c);
    const lido = lerDadosDoConvite(corpo);
    if (!lido.ok) return apiError(c, 400, "validacao", undefined, { fields: lido.fields });

    const d1 = c.var.db.$client;
    const resultado = await createSpouseInvite(d1, {
      householdId,
      createdBy: memberId,
      createdByName: await nomeDaPessoa(d1, memberId),
      name: lido.name,
      email: lido.email,
      agora: agora(),
    });
    if (!resultado.ok) return apiError(c, 409, resultado.motivo, MENSAGENS_DE_CONFLITO[resultado.motivo]);
    return respondeNovoConvite(c, resultado.novo);
  });

  // Gerar um link novo: o convite aguardando é cancelado e outro sai com o mesmo nome e e-mail.
  rotas.post("/:id/renew", comSessao, async (c) => {
    const { householdId, memberId } = getSession(c);
    const d1 = c.var.db.$client;
    const resultado = await renewInvite(d1, {
      householdId,
      inviteId: c.req.param("id"),
      createdBy: memberId,
      createdByName: await nomeDaPessoa(d1, memberId),
      agora: agora(),
    });
    if (!resultado.ok) {
      if (resultado.motivo === "conjuge_ja_existe") {
        return apiError(c, 409, "conjuge_ja_existe", MENSAGEM_CONJUGE_JA_EXISTE);
      }
      return apiError(c, 404, "convite_nao_encontrado", MENSAGEM_NAO_ENCONTRADO);
    }
    return respondeNovoConvite(c, resultado.novo);
  });

  // Cancelar: o link deixa de funcionar (410 convite_cancelado para quem abrir).
  rotas.delete("/:id", comSessao, async (c) => {
    const { householdId } = getSession(c);
    const cancelado = await cancelInvite(c.var.db.$client, {
      householdId,
      inviteId: c.req.param("id"),
      agora: agora(),
    });
    if (!cancelado) return apiError(c, 404, "convite_nao_encontrado", MENSAGEM_NAO_ENCONTRADO);
    return c.json({ ok: true }, 200);
  });

  // Pública: a tela mostra quem convidou, o nome e o e-mail antes de criar o acesso.
  rotas.post("/inspect", async (c) => {
    const corpo = await lerCorpo(c);
    if (corpo === null) return respondeDadosInvalidos(c);
    const token = lerToken(corpo);
    if (token === null) return respondeDadosInvalidos(c);

    const convite = await conviteDoToken(c, token);
    if (!convite) return apiError(c, 404, "convite_invalido", MENSAGEM_INVALIDO);
    const situacao = inviteStatus(convite, agora());
    if (situacao !== "aguardando") return respondeSituacao(c, situacao, convite);
    return c.json(
      {
        kind: "conjuge",
        invitedBy: convite.created_by_name ?? "",
        name: convite.invitee_name,
        email: convite.invitee_email,
        expiresAt: convite.expires_at,
      },
      200,
    );
  });

  // Pública, aceite (1 de 2): as opções da passkey da pessoa nova. O desafio é de finalidade 'convite'.
  rotas.post("/accept/options", async (c) => {
    const corpo = await lerCorpo(c);
    if (corpo === null) return respondeDadosInvalidos(c);
    const token = lerToken(corpo);
    if (token === null) return respondeDadosInvalidos(c);
    const nome = memberNameSchema.safeParse(corpo.name);
    if (!nome.success) return apiError(c, 400, "validacao", undefined, { fields: { name: MENSAGEM_NOME } });

    const aceite = await conviteParaAceitar(c, token, agora());
    if (!aceite.ok) return aceite.resposta;

    const memberId = crypto.randomUUID();
    const opcoes = await registrationOptions(relyingParty(c), {
      memberId,
      name: nome.data,
      email: aceite.convite.invitee_email,
    });
    await saveChallenge(c, { purpose: "convite", memberId, challenge: opcoes.challenge });
    return c.json(opcoes, 200);
  });

  // Pública, aceite (2 de 2): confere a passkey e grava a pessoa, a passkey e a sessão num lote só.
  rotas.post("/accept/verify", async (c) => {
    const corpo = await lerCorpo(c);
    if (corpo === null) return respondeDadosInvalidos(c);
    const token = lerToken(corpo);
    if (token === null) return respondeDadosInvalidos(c);
    const nome = memberNameSchema.safeParse(corpo.name);
    if (!nome.success) return apiError(c, 400, "validacao", undefined, { fields: { name: MENSAGEM_NOME } });
    if (typeof corpo.response !== "object" || corpo.response === null) return respondeDadosInvalidos(c);

    // Uso único: o desafio some aqui, venha ou não a verificação a dar certo.
    const desafio = await takeChallenge(c, "convite");
    if (!desafio || desafio.memberId === null) return apiError(c, 400, "desafio_expirado", MENSAGEM_DESAFIO);

    // Checagens de novo: o convite pode ter sido usado, cancelado ou vencido enquanto a passkey era criada.
    const aceite = await conviteParaAceitar(c, token, agora());
    if (!aceite.ok) return aceite.resposta;

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

    const { convite, householdId } = aceite;
    const memberId = desafio.memberId;
    const momento = agora();
    const agoraIso = momento.toISOString();
    const tokenDaSessao = newSessionToken();
    const tokenHash = await sha256Hex(tokenDaSessao);
    const d1 = c.var.db.$client;
    const dispositivo = deviceNameFromUserAgent(c.req.header("user-agent"));

    // Um lote só. O convite só é gasto se a pessoa entra: o passo 1 confere que o lar ainda não tem cônjuge, e o
    // passo 2 confere que o convite foi gasto neste lote. Sem isso, um convite podia ficar usado sem a pessoa.
    const resultados = await d1.batch([
      d1
        .prepare(
          "UPDATE invites SET used_at = ? WHERE id = ? AND kind = 'conjuge' AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ? AND NOT EXISTS (SELECT 1 FROM members WHERE household_id = ? AND role = 'conjuge')",
        )
        .bind(agoraIso, convite.id, agoraIso, householdId),
      d1
        .prepare(
          "INSERT INTO members (id, household_id, name, email, role, created_at) SELECT ?, ?, ?, ?, 'conjuge', ? WHERE NOT EXISTS (SELECT 1 FROM members WHERE household_id = ? AND role = 'conjuge') AND EXISTS (SELECT 1 FROM invites WHERE id = ? AND used_at = ?)",
        )
        .bind(
          memberId,
          householdId,
          nome.data,
          convite.invitee_email,
          agoraIso,
          householdId,
          convite.id,
          agoraIso,
        ),
      d1
        .prepare(
          "INSERT INTO passkeys (id, member_id, public_key, counter, transports, device_name, added_via, created_at, last_used_at) SELECT ?, ?, ?, ?, ?, ?, 'convite', ?, NULL WHERE EXISTS (SELECT 1 FROM members WHERE id = ?)",
        )
        .bind(
          registro.id,
          memberId,
          registro.publicKey,
          registro.counter,
          registro.transports === null ? null : JSON.stringify(registro.transports),
          dispositivo,
          agoraIso,
          memberId,
        ),
      sessionInsertStatement(d1, {
        tokenHash,
        memberId,
        passkeyId: registro.id,
        agora: agoraIso,
        expiraEm: sessionExpiresAt(momento),
      }),
    ]);

    // O passo 2 não inseriu: nada ficou gravado (o lote é uma transação). A causa é a de agora: o convite venceu, foi
    // cancelado ou o lar ganhou cônjuge enquanto a passkey era criada. Refaz as checagens para dizer a causa certa.
    if (resultados[1]?.meta.changes !== 1) {
      if (await conjugeExiste(d1, householdId)) {
        return apiError(c, 409, "conjuge_ja_existe", MENSAGEM_CONJUGE_JA_EXISTE);
      }
      const depois = await conviteParaAceitar(c, token, agora());
      if (!depois.ok) return depois.resposta;
      return apiError(c, 409, "conjuge_ja_existe", MENSAGEM_CONJUGE_JA_EXISTE);
    }

    setSessionCookie(c, tokenDaSessao);
    return c.json(
      {
        member: { id: memberId, name: nome.data, email: convite.invitee_email, role: "conjuge" },
        household: { id: householdId },
      },
      201,
    );
  });

  return rotas;
}
