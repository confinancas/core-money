// WebAuthn: cadastro (TASK-0103) e entrada (TASK-0104): opções, desafio de uso único e as verificações, embrulhando o
// @simplewebauthn/server 14 (ADR-010). Os testes de integração passam um WebAuthnVerifier falso (createApp({ webauthn })).
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
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

// Opções de login: sem allowCredentials (a passkey é descoberta pelo navegador).
export type OpcoesDeLogin = Awaited<ReturnType<typeof generateAuthenticationOptions>>;

// Passkey guardada, como a verificação de login precisa dela.
export type PasskeyGuardada = {
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

// Entrada (TASK-0104): opções de login e verificação da asserção. Devolve o contador novo, ou null quando a passkey
// não confere. Separado do registro para que um falso só do cadastro continue valendo nos testes da TASK-0103.
export type WebAuthnLoginVerifier = {
  authenticationOptions(rp: RelyingParty): Promise<OpcoesDeLogin>;
  verifyAuthentication(entrada: {
    response: AuthenticationResponseJSON;
    expectedChallenge: string;
    rp: RelyingParty;
    passkey: PasskeyGuardada;
  }): Promise<{ newCounter: number } | null>;
};

function paraBase64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// A chave pública da passkey volta do banco em base64url (a mesma forma que o cadastro grava).
function deBase64Url(texto: string): Uint8Array<ArrayBuffer> {
  const preenchido = texto.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (texto.length % 4)) % 4);
  const binario = atob(preenchido);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

export const verificadorReal: WebAuthnVerifier & WebAuthnLoginVerifier = {
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

  async authenticationOptions(rp) {
    return generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "required" });
  },

  async verifyAuthentication({ response, expectedChallenge, rp, passkey }) {
    const resultado = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: passkey.id,
        publicKey: deBase64Url(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports ?? undefined,
      },
      requireUserVerification: true,
    });
    if (!resultado.verified) return null;
    return { newCounter: resultado.authenticationInfo.newCounter };
  },
};

// Grava o desafio (5 min) e apaga os vencidos no mesmo lote. O cookie leva o id da linha.
// memberId nulo no login: quem entra ainda não é conhecido até a passkey ser verificada.
export async function saveChallenge(
  c: Context<AppEnv>,
  desafio: { purpose: string; memberId: string | null; challenge: string },
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
