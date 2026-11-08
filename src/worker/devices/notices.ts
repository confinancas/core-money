// Avisos de aparelho novo (TASK-0106), função pura: sem banco e sem cookie, para o teste de unidade.
// Um aviso é um aparelho da própria pessoa que entrou por recuperação, que não é o aparelho desta sessão, e que foi
// criado depois de a sessão começar ou depois do último "Foi eu" neste aparelho.

export type PasskeyParaAviso = {
  id: string;
  memberId: string;
  addedVia: string;
  deviceName: string;
  createdAt: string;
};

export type SessaoParaAviso = {
  memberId: string;
  passkeyId: string;
  createdAt: string;
  noticesSeenAt: string | null;
};

export type AvisoDeAparelhoNovo = {
  kind: "aparelho_novo";
  passkeyId: string;
  deviceName: string;
  createdAt: string;
};

export function avisosDeAparelhoNovo(
  passkeys: PasskeyParaAviso[],
  sessao: SessaoParaAviso,
): AvisoDeAparelhoNovo[] {
  const desde = Date.parse(sessao.noticesSeenAt ?? sessao.createdAt);
  return passkeys
    .filter(
      (passkey) =>
        passkey.memberId === sessao.memberId &&
        passkey.addedVia === "recuperacao" &&
        passkey.id !== sessao.passkeyId &&
        Date.parse(passkey.createdAt) > desde,
    )
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .map((passkey) => ({
      kind: "aparelho_novo",
      passkeyId: passkey.id,
      deviceName: passkey.deviceName,
      createdAt: passkey.createdAt,
    }));
}
