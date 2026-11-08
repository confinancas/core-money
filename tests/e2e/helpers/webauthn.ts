import type { CDPSession, Page } from "@playwright/test";

// Autenticador virtual do Chromium (CDP) para o cadastro com passkey (TASK-0103): interno, residente, com
// verificação do usuário e presença simulada. Reusado pelas TASK-0104 a 0106 e 0108.
export type AutenticadorVirtual = {
  cdp: CDPSession;
  id: string;
  // Sem verificação do usuário: a cerimônia termina com NotAllowedError (o "cancelar" do aparelho).
  recusa: () => Promise<void>;
  // Volta a verificar o usuário: a próxima cerimônia é aprovada.
  permite: () => Promise<void>;
};

export async function ligaAutenticadorVirtual(page: Page): Promise<AutenticadorVirtual> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  const definir = (isUserVerified: boolean) =>
    cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified }).then(() => undefined);
  return {
    cdp,
    id: authenticatorId,
    recusa: () => definir(false),
    permite: () => definir(true),
  };
}
