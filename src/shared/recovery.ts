// Recuperação de acesso (TASK-0106): o que as telas de recuperação leem. O link só aparece na resposta de gerar.
// "parceiro": gerado por quem já está no lar (15 min). "comando": gerado por npm run recuperar-acesso (60 min).
export type OrigemDaRecuperacao = "parceiro" | "comando";

// POST /api/recovery/inspect: o que a pessoa que abre o link vê antes de cadastrar a passkey.
export type RecuperacaoParaAbrir = {
  memberName: string;
  expiresAt: string;
  source: OrigemDaRecuperacao;
  createdByName: string | null;
};

// POST /api/recovery-invites: o link de recuperação gerado pelo parceiro, uma vez.
export type LinkDeRecuperacao = {
  link: string;
  expiresAt: string;
  memberName: string;
};
