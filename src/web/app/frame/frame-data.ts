// Membros do lar da sessão, para o rodapé do desktop (TASK-0104: vêm de GET /api/auth/session). Sem sessão, nulo e o
// rodapé fica escondido.
import type { SessionHouseholdMember } from "../../../shared/session";
import { useSessionMembers } from "../../session/SessionProvider";

export type MembroDoLar = SessionHouseholdMember;

export function useFrameMembers(): MembroDoLar[] | null {
  return useSessionMembers();
}
