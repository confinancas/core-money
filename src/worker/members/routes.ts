// Pessoas do lar para Configurações (TASK-0107): GET /api/members. Com sessão (o requireSession das rotas de /api)
// e no lar da sessão. Uma consulta, com as subconsultas do aparelho (passkeys) e do convite aguardando.
import { Hono } from "hono";
import type { MemberRole } from "../../shared/household";
import type { MembersResponse, MembroDaLista } from "../../shared/members";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";

// Uma linha por pessoa do lar. O convite aguardando vem como JSON na mesma linha (o mesmo para todas): é o convite
// de cônjuge não usado, não cancelado e ainda dentro do prazo (o mesmo critério de inviteStatus).
const SQL_MEMBROS_DO_LAR = `
SELECT m.id, m.name, m.email, m.role,
  (SELECT COUNT(*) FROM passkeys p WHERE p.member_id = m.id) AS devices_count,
  (SELECT json_object('id', i.id, 'name', i.invitee_name, 'email', i.invitee_email, 'expiresAt', i.expires_at)
     FROM invites i
     WHERE i.household_id = m.household_id AND i.kind = 'conjuge'
       AND i.used_at IS NULL AND i.cancelled_at IS NULL AND i.expires_at > ?1
       AND NOT EXISTS (SELECT 1 FROM members c WHERE c.household_id = i.household_id AND c.role = 'conjuge')
     ORDER BY i.created_at DESC
     LIMIT 1) AS pending_invite
FROM members m
WHERE m.household_id = ?2
ORDER BY CASE m.role WHEN 'titular' THEN 0 ELSE 1 END, m.created_at, m.id`;

type LinhaDeMembro = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  devices_count: number;
  pending_invite: string | null;
};

export function membersRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  rotas.get("/", async (c) => {
    const { householdId, memberId } = getSession(c);
    const { results } = await c.var.db.$client
      .prepare(SQL_MEMBROS_DO_LAR)
      .bind(agora().toISOString(), householdId)
      .all<LinhaDeMembro>();

    const members: MembroDaLista[] = results.map((linha) => ({
      id: linha.id,
      name: linha.name,
      email: linha.email,
      role: linha.role as MemberRole,
      isMe: linha.id === memberId,
      devicesCount: Number(linha.devices_count),
    }));
    const convite = results.map((linha) => linha.pending_invite).find((texto) => texto !== null);
    const pendingInvite = convite
      ? (JSON.parse(convite) as NonNullable<MembersResponse["pendingInvite"]>)
      : null;

    const corpo: MembersResponse = { members, pendingInvite };
    return c.json(corpo, 200);
  });

  return rotas;
}
