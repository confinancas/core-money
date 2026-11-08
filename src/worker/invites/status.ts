// Situação e forma de um convite de cônjuge (TASK-0105). Só funções puras e tipos: sem o D1, para o teste de unidade.

export type InviteRow = {
  id: string;
  household_id: string | null;
  kind: string;
  token_hash: string;
  invitee_name: string | null;
  invitee_email: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  used_at: string | null;
  cancelled_at: string | null;
  // Vem do join com members (quem convidou). Nulo se a pessoa não existe mais.
  created_by_name?: string | null;
};

export type InviteStatus = "aguardando" | "vencido" | "usado" | "cancelado";

export type InviteDto = {
  id: string;
  kind: "conjuge";
  name: string | null;
  email: string | null;
  expiresAt: string;
  createdByName: string;
};

// Ordem da spec: usado antes de cancelado, cancelado antes de vencido. Sem vencimento gravado, o convite vence
// (falha fechada: um convite de cônjuge sempre tem expires_at).
export function inviteStatus(
  convite: Pick<InviteRow, "used_at" | "cancelled_at" | "expires_at">,
  agora: Date,
): InviteStatus {
  if (convite.used_at !== null) return "usado";
  if (convite.cancelled_at !== null) return "cancelado";
  if (convite.expires_at === null || Date.parse(convite.expires_at) <= agora.getTime()) return "vencido";
  return "aguardando";
}

export function paraConvite(convite: InviteRow): InviteDto {
  return {
    id: convite.id,
    kind: "conjuge",
    name: convite.invitee_name,
    email: convite.invitee_email,
    expiresAt: convite.expires_at ?? "",
    createdByName: convite.created_by_name ?? "",
  };
}
