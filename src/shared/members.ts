import type { MemberRole } from "./household";

// Pessoas do lar para a tela de Configurações (TASK-0107): GET /api/members. O e-mail é o que a pessoa informou para
// identificação (o app não manda e-mail). Só o lar da sessão; nada de chave, token ou hash.
export type MembroDaLista = {
  id: string;
  name: string;
  email: string | null;
  role: MemberRole;
  isMe: boolean;
  // Passkeys (aparelhos) da pessoa.
  devicesCount: number;
};

// Convite de cônjuge aguardando entrar (status aguardando: não usado, não cancelado e não vencido).
export type ConvitePendente = {
  id: string;
  name: string | null;
  email: string | null;
  expiresAt: string;
};

export type MembersResponse = {
  members: MembroDaLista[];
  pendingInvite: ConvitePendente | null;
};
