// WebAuthn do cadastro (TASK-0103): opções, desafio de uso único e a verificação do registro, embrulhando o
// @simplewebauthn/server 14 (ADR-010). Os testes de integração passam um WebAuthnVerifier falso (createApp({ webauthn })).
import {
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { eq, lt } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { webauthnChallenges } from "../db/schema";
import type { AppEnv } from "../env";

export const COOKIE_DO_DESAFIO = "mm_chal";
const VALIDADE_DO_DESAFIO_MS = 5 * 60 * 1000;

// Relying party: o endereço deste Worker. A passkey fica presa a ele (ADR-010).
export type RelyingParty = { rpID: string; origin: string; rpName: string };

export function relyingParty(c: Context<AppEnv>): RelyingParty {
  const url = new URL(c.req.url);
  return { rpID: url.hostname, origin: url.origin, rpName: c.var.marca.name };
}

type ExcludeCredentials = NonNullable<
  Parameters<typeof generateRegistrationOptions>[0]["excludeCredentials"]
>;

// Opções para navigator.credentials.create(): a passkey é residente e exige verificação do usuário (digital, rosto ou PIN).
export function registrationOptions(
  rp: RelyingParty,
  pessoa: { memberId: string; name: string; email: string | null },
  excludeCredentials: ExcludeCredentials = [],
) {
  return generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userID: new Uint8Array(new TextEncoder().encode(pessoa.memberId)),
    userName: pessoa.email ?? pessoa.name,
    userDisplayName: pessoa.name,
    attestationType: "none",
    excludeCredentials,
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
}

export type RegistroVerificado = {
  id: string;
  publicKey: string;
  counter: number;
  transports: string[] | null;
};

// Verificação do registro. Devolve null quando o authenticator não comprova a passkey; lança quando a resposta é malformada.
export type WebAuthnVerifier = {
  verifyRegistration(entrada: {
    response: RegistrationResponseJSON;
    expectedChallenge: string;
    rp: RelyingParty;
  }): Promise<RegistroVerificado | null>;
};

function paraBase64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const verificadorReal: WebAuthnVerifier = {
  async verifyRegistration({ response, expectedChallenge, rp }) {
    const resultado = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
    if (!resultado.verified) return null;
    const { credential } = resultado.registrationInfo;
    return {
      id: credential.id,
      publicKey: paraBase64Url(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? null,
    };
  },
};

// Grava o desafio (5 min) e apaga os vencidos no mesmo lote. O cookie leva o id da linha.
export async function saveChallenge(
  c: Context<AppEnv>,
  desafio: { purpose: string; memberId: string; challenge: string },
): Promise<void> {
  const db = c.var.db;
  const agora = new Date();
  const id = crypto.randomUUID();
  const expiraEm = new Date(agora.getTime() + VALIDADE_DO_DESAFIO_MS).toISOString();
  await db.batch([
    db.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, agora.toISOString())),
    db.insert(webauthnChallenges).values({
      id,
      challenge: desafio.challenge,
      memberId: desafio.memberId,
      purpose: desafio.purpose,
      expiresAt: expiraEm,
    }),
  ]);
  setCookie(c, COOKIE_DO_DESAFIO, id, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/api",
    maxAge: VALIDADE_DO_DESAFIO_MS / 1000,
  });
}

// Lê e consome o desafio: a linha some (DELETE ... RETURNING, uma consulta), o cookie também.
// Devolve o desafio só se a finalidade bate e não venceu; senão null (a rota responde desafio_expirado).
export async function takeChallenge(
  c: Context<AppEnv>,
  finalidade: string,
): Promise<{ challenge: string; memberId: string | null } | null> {
  const id = getCookie(c, COOKIE_DO_DESAFIO);
  deleteCookie(c, COOKIE_DO_DESAFIO, { path: "/api" });
  if (!id) return null;
  const [linha] = await c.var.db.delete(webauthnChallenges).where(eq(webauthnChallenges.id, id)).returning();
  if (!linha || linha.purpose !== finalidade) return null;
  if (linha.expiresAt <= new Date().toISOString()) return null;
  return { challenge: linha.challenge, memberId: linha.memberId };
}
