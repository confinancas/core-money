import { env } from "cloudflare:test";
import { vi } from "vitest";
import { sha256Hex } from "../../../src/shared/access-code";
import type { RegistroVerificado, WebAuthnVerifier } from "../../../src/worker/auth/webauthn";
import { semearLar, semearSessao } from "./sessao";

// Aparelhos e recuperação (TASK-0106), com D1 local. O verificador de registro é falso: devolve a passkey com o id
// que veio na própria resposta, então cada teste escolhe o id do aparelho novo. A criptografia real já é provada na
// TASK-0103 e na TASK-0104 (passkey assinada de verdade).

export const TOKEN_DO_TITULAR = "TESTE-SESSAO-0106-titular-token-de-teste-000000";
export const TOKEN_DO_CONJUGE = "TESTE-SESSAO-0106-conjuge-token-de-teste-00000";
export const PASSKEY_DO_TITULAR = "cred-TEST-0106-titular-1";
export const PASSKEY_DO_CONJUGE = "cred-TEST-0106-conjuge-1";

export const COOKIE_DO_TITULAR = `mm_sess=${TOKEN_DO_TITULAR}`;
export const COOKIE_DO_CONJUGE = `mm_sess=${TOKEN_DO_CONJUGE}`;

export type LarDeDuas = {
  householdId: string;
  titularId: string;
  conjugeId: string;
};

// Um lar com titular e cônjuge, cada um com uma passkey e uma sessão aberta no próprio aparelho.
export async function criaLarDeDuas(): Promise<LarDeDuas> {
  const lar = await semearLar(env.DB, {
    nome: "[TEST] Pessoa A",
    email: "pessoa.a@example.com",
    passkeyId: PASSKEY_DO_TITULAR,
  });
  await semearSessao(env.DB, {
    memberId: lar.memberId,
    passkeyId: PASSKEY_DO_TITULAR,
    token: TOKEN_DO_TITULAR,
  });

  const conjugeId = crypto.randomUUID();
  // Um segundo depois do titular: a lista ordena pela data de entrada, e o teste espera o titular primeiro.
  const agora = new Date(Date.now() + 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO members (id, household_id, name, email, role, created_at) VALUES (?, ?, '[TEST] Pessoa B', 'pessoa.b@example.com', 'conjuge', ?)",
    ).bind(conjugeId, lar.householdId, agora),
    env.DB.prepare(
      "INSERT INTO passkeys (id, member_id, public_key, counter, transports, device_name, added_via, created_at, last_used_at) VALUES (?, ?, 'PUBLICA-TEST-0106-CONJUGE', 0, NULL, 'Android · Chrome', 'convite', ?, NULL)",
    ).bind(PASSKEY_DO_CONJUGE, conjugeId, agora),
  ]);
  await semearSessao(env.DB, { memberId: conjugeId, passkeyId: PASSKEY_DO_CONJUGE, token: TOKEN_DO_CONJUGE });
  return { householdId: lar.householdId, titularId: lar.memberId, conjugeId };
}

// Um segundo lar, direto no D1, com um titular e uma passkey (para os cenários de outro lar).
export async function criaOutroLar(): Promise<{ memberId: string; passkeyId: string; token: string }> {
  const lar = await semearLar(env.DB, {
    nome: "[TEST] Pessoa C",
    email: "pessoa.c@example.com",
    passkeyId: "cred-TEST-0106-outro-lar-1",
  });
  const token = "TESTE-SESSAO-0106-outro-lar-token-de-teste-0000";
  await semearSessao(env.DB, { memberId: lar.memberId, passkeyId: "cred-TEST-0106-outro-lar-1", token });
  return { memberId: lar.memberId, passkeyId: "cred-TEST-0106-outro-lar-1", token };
}

// Verificador de registro falso: aceita a resposta e devolve a passkey com o id que ela traz (response.id). Com
// recusa: true, a verificação falha (null). aoVerificar roda antes da resposta, para simular uma corrida.
export function verificadorDeRegistro(opcoes: { recusa?: boolean; aoVerificar?: () => Promise<void> } = {}) {
  const verifyRegistration = vi.fn(async ({ response }: { response: { id: string } }) => {
    if (opcoes.aoVerificar) await opcoes.aoVerificar();
    if (opcoes.recusa) return null;
    const registro: RegistroVerificado = {
      id: response.id,
      publicKey: `PUBLICA-${response.id}`,
      counter: 0,
      transports: null,
    };
    return registro;
  });
  const webauthn = {
    verifyRegistration: verifyRegistration as unknown as WebAuthnVerifier["verifyRegistration"],
  } satisfies WebAuthnVerifier;
  return { webauthn, verifyRegistration };
}

// Corpo da resposta de registro que o navegador devolveria, com o id do aparelho.
export const respostaDeRegistro = (id: string) =>
  ({
    id,
    rawId: id,
    type: "public-key",
    response: { clientDataJSON: "TEST", attestationObject: "TEST" },
  }) as unknown;

// Valor do hash guardado para um token (o banco nunca guarda o token).
export const hashDe = (token: string) => sha256Hex(token);
