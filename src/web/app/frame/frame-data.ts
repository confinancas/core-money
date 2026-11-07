// Membros do lar da sessão, para o rodapé do desktop. Até a TASK-0104 (sessão), não há membros: o rodapé fica escondido.
export type MembroDoLar = { name: string };

export function useFrameMembers(): MembroDoLar[] | null {
  return null;
}
