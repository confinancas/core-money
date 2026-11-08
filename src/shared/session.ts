// Sessão atual (TASK-0104): GET /api/auth/session e POST /api/auth/login/verify. O e-mail vai só para a própria pessoa;
// as outras pessoas do lar vêm com id, nome e papel.
import type { MemberRole } from "./household";

export type SessionMember = {
  id: string;
  name: string;
  email: string | null;
  role: MemberRole;
};

export type SessionHouseholdMember = {
  id: string;
  name: string;
  role: MemberRole;
};

export type SessionResponse = {
  member: SessionMember;
  household: { id: string; brand: string };
  members: SessionHouseholdMember[];
  notices: unknown[];
};

export type LoginResponse = {
  member: SessionMember;
  crossDevice: boolean;
};
