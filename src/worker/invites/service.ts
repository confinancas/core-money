// Convites de cônjuge (TASK-0105): criar, listar, cancelar, gerar um link novo e achar o convite pelo token.
// O banco guarda só o sha256 do token. O link só existe na resposta de criar ou de gerar novo.
import { generateLinkToken, sha256Hex } from "../../shared/access-code";
import { type InviteDto, type InviteRow, inviteStatus, paraConvite } from "./status";

export const VALIDADE_DO_CONVITE_MS = 7 * 24 * 60 * 60 * 1000;

const COLUNAS =
  "i.id, i.household_id, i.kind, i.token_hash, i.invitee_name, i.invitee_email, i.created_by, i.created_at, i.expires_at, i.used_at, i.cancelled_at, m.name AS created_by_name";

const SQL_CONVITE_POR_TOKEN = `SELECT ${COLUNAS} FROM invites i LEFT JOIN members m ON m.id = i.created_by WHERE i.token_hash = ?`;

const SQL_CONVITE_DO_LAR = `SELECT ${COLUNAS} FROM invites i LEFT JOIN members m ON m.id = i.created_by WHERE i.id = ? AND i.household_id = ? AND i.kind = 'conjuge'`;

const SQL_CONVITES_DO_LAR = `SELECT ${COLUNAS} FROM invites i LEFT JOIN members m ON m.id = i.created_by WHERE i.household_id = ? AND i.kind = 'conjuge' AND i.used_at IS NULL AND i.cancelled_at IS NULL ORDER BY i.created_at DESC`;

// Um convite de cônjuge por token. Qualquer tipo de convite com o hash igual; quem chama confere o kind.
export async function findInviteByToken(d1: D1Database, token: string): Promise<InviteRow | null> {
  const linha = await d1
    .prepare(SQL_CONVITE_POR_TOKEN)
    .bind(await sha256Hex(token))
    .first<InviteRow>();
  return linha ?? null;
}

export async function nomeDaPessoa(d1: D1Database, memberId: string): Promise<string> {
  const linha = await d1
    .prepare("SELECT name FROM members WHERE id = ?")
    .bind(memberId)
    .first<{ name: string }>();
  return linha?.name ?? "";
}

// Os convites aguardando do lar (o que o titular vê na tela: sem o link).
export async function listActiveInvites(
  d1: D1Database,
  householdId: string,
  agora: Date,
): Promise<InviteDto[]> {
  const { results } = await d1.prepare(SQL_CONVITES_DO_LAR).bind(householdId).all<InviteRow>();
  return results.filter((convite) => inviteStatus(convite, agora) === "aguardando").map(paraConvite);
}

export async function conjugeExiste(d1: D1Database, householdId: string): Promise<boolean> {
  const linha = await d1
    .prepare("SELECT COUNT(*) AS n FROM members WHERE household_id = ? AND role = 'conjuge'")
    .bind(householdId)
    .first<{ n: number }>();
  return (linha?.n ?? 0) > 0;
}

export type NovoConvite = { token: string; convite: InviteDto };

// Cria o convite de cônjuge num INSERT condicional: só entra se o lar ainda não tem cônjuge e não há convite aberto.
// Duas chamadas juntas dão um convite só (a segunda recebe o motivo).
export async function createSpouseInvite(
  d1: D1Database,
  entrada: {
    householdId: string;
    createdBy: string;
    name: string;
    email: string | null;
    agora: Date;
    createdByName: string;
  },
): Promise<{ ok: true; novo: NovoConvite } | { ok: false; motivo: "conjuge_ja_existe" | "convite_ativo" }> {
  const token = generateLinkToken();
  const id = crypto.randomUUID();
  const criadoEm = entrada.agora.toISOString();
  const expiraEm = new Date(entrada.agora.getTime() + VALIDADE_DO_CONVITE_MS).toISOString();
  const resultado = await d1
    .prepare(
      "INSERT INTO invites (id, household_id, kind, token_hash, invitee_name, invitee_email, created_by, created_at, expires_at) SELECT ?, ?, 'conjuge', ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM members WHERE household_id = ? AND role = 'conjuge') AND NOT EXISTS (SELECT 1 FROM invites WHERE household_id = ? AND kind = 'conjuge' AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ?)",
    )
    .bind(
      id,
      entrada.householdId,
      await sha256Hex(token),
      entrada.name,
      entrada.email,
      entrada.createdBy,
      criadoEm,
      expiraEm,
      entrada.householdId,
      entrada.householdId,
      criadoEm,
    )
    .run();
  if (resultado.meta.changes === 1) {
    return {
      ok: true,
      novo: {
        token,
        convite: {
          id,
          kind: "conjuge",
          name: entrada.name,
          email: entrada.email,
          expiresAt: expiraEm,
          createdByName: entrada.createdByName,
        },
      },
    };
  }
  return {
    ok: false,
    motivo: (await conjugeExiste(d1, entrada.householdId)) ? "conjuge_ja_existe" : "convite_ativo",
  };
}

// Cancela um convite aguardando do lar. Devolve false quando não há um assim (outro lar, usado, cancelado ou vencido).
export async function cancelInvite(
  d1: D1Database,
  entrada: { householdId: string; inviteId: string; agora: Date },
): Promise<boolean> {
  const agoraIso = entrada.agora.toISOString();
  const resultado = await d1
    .prepare(
      "UPDATE invites SET cancelled_at = ? WHERE id = ? AND household_id = ? AND kind = 'conjuge' AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ?",
    )
    .bind(agoraIso, entrada.inviteId, entrada.householdId, agoraIso)
    .run();
  return resultado.meta.changes === 1;
}

// Gera um link novo: cancela o aguardando e cria outro com o mesmo nome e e-mail, num lote. A criação só entra se o
// cancelamento entrou e não há outro convite aberto nem cônjuge (duas renovações juntas dão um convite só).
export async function renewInvite(
  d1: D1Database,
  entrada: {
    householdId: string;
    inviteId: string;
    createdBy: string;
    createdByName: string;
    agora: Date;
  },
): Promise<
  { ok: true; novo: NovoConvite } | { ok: false; motivo: "convite_nao_encontrado" | "conjuge_ja_existe" }
> {
  const antigo = await d1
    .prepare(SQL_CONVITE_DO_LAR)
    .bind(entrada.inviteId, entrada.householdId)
    .first<InviteRow>();
  if (!antigo || inviteStatus(antigo, entrada.agora) !== "aguardando") {
    return { ok: false, motivo: "convite_nao_encontrado" };
  }

  const token = generateLinkToken();
  const id = crypto.randomUUID();
  const agoraIso = entrada.agora.toISOString();
  const expiraEm = new Date(entrada.agora.getTime() + VALIDADE_DO_CONVITE_MS).toISOString();
  const resultados = await d1.batch([
    d1
      .prepare(
        "UPDATE invites SET cancelled_at = ? WHERE id = ? AND household_id = ? AND kind = 'conjuge' AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ? AND NOT EXISTS (SELECT 1 FROM members WHERE household_id = ? AND role = 'conjuge')",
      )
      .bind(agoraIso, antigo.id, entrada.householdId, agoraIso, entrada.householdId),
    d1
      .prepare(
        "INSERT INTO invites (id, household_id, kind, token_hash, invitee_name, invitee_email, created_by, created_at, expires_at) SELECT ?, ?, 'conjuge', ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM invites WHERE id = ? AND cancelled_at = ?) AND NOT EXISTS (SELECT 1 FROM invites WHERE household_id = ? AND kind = 'conjuge' AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ?) AND NOT EXISTS (SELECT 1 FROM members WHERE household_id = ? AND role = 'conjuge')",
      )
      .bind(
        id,
        entrada.householdId,
        await sha256Hex(token),
        antigo.invitee_name,
        antigo.invitee_email,
        entrada.createdBy,
        agoraIso,
        expiraEm,
        antigo.id,
        agoraIso,
        entrada.householdId,
        agoraIso,
        entrada.householdId,
      ),
  ]);

  if (resultados[1]?.meta.changes !== 1) {
    return {
      ok: false,
      motivo: (await conjugeExiste(d1, entrada.householdId)) ? "conjuge_ja_existe" : "convite_nao_encontrado",
    };
  }
  return {
    ok: true,
    novo: {
      token,
      convite: {
        id,
        kind: "conjuge",
        name: antigo.invitee_name,
        email: antigo.invitee_email,
        expiresAt: expiraEm,
        createdByName: entrada.createdByName,
      },
    },
  };
}
