import { env } from "cloudflare:test";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../src/shared/access-code";
import { createApp } from "../../src/worker/app";
import type {
  RegistroVerificado,
  WebAuthnLoginVerifier,
  WebAuthnVerifier,
} from "../../src/worker/auth/webauthn";
import { COOKIE_DE_TESTE, callApi, semearPrimeiroAcesso, semearPronto } from "./helpers/app";
import { assinaAsercao, criaPasskeyReal } from "./helpers/passkey-real";
import {
  cabecalhoDoCookie,
  contaSql,
  ID_DA_PASSKEY_DE_TESTE,
  semearLar,
  valorDoCookie,
} from "./helpers/sessao";

// Entrar com passkey, sair e a sessão (TASK-0104). Com um verificador falso (a criptografia real fica no fim, com
// passkey assinada de verdade) e com D1 local. Cenários 1, 4, 5, 8 e 15 e a troca de sessão no mesmo navegador.

const OPCOES_FALSAS = {
  challenge: "DESAFIO-TEST-LOGIN-0104",
  timeout: 60000,
  rpId: "matrimoney.test",
  userVerification: "required",
};

// A resposta de login que o verificador falso aceita (o conteúdo é do navegador; o falso não o confere).
const RESPOSTA = {
  id: ID_DA_PASSKEY_DE_TESTE,
  rawId: ID_DA_PASSKEY_DE_TESTE,
  type: "public-key",
  response: { clientDataJSON: "TEST", authenticatorData: "TEST", signature: "TEST" },
  clientExtensionResults: {},
  authenticatorAttachment: "platform",
} as unknown as AuthenticationResponseJSON;

function verificadorFalso(resultado: { newCounter: number } | null = { newCounter: 4 }) {
  const verifyAuthentication = vi.fn(async () => resultado);
  const authenticationOptions = vi.fn(async () => OPCOES_FALSAS as never);
  const verifyRegistration = vi.fn(async (): Promise<RegistroVerificado | null> => null);
  const webauthn: WebAuthnVerifier & WebAuthnLoginVerifier = {
    verifyRegistration: verifyRegistration as WebAuthnVerifier["verifyRegistration"],
    authenticationOptions,
    verifyAuthentication: verifyAuthentication as WebAuthnLoginVerifier["verifyAuthentication"],
  };
  return { webauthn, verifyAuthentication, authenticationOptions };
}

// Pede as opções de entrada e devolve o cookie mm_chal (o desafio de uso único).
async function pedeDesafio(app: ReturnType<typeof createApp>): Promise<string> {
  const resposta = await callApi(app, "POST", "/api/auth/login/options", {});
  expect(resposta.status).toBe(200);
  const desafio = valorDoCookie(resposta, "mm_chal");
  expect(desafio).toBeTruthy();
  return desafio ?? "";
}

async function verifica(
  app: ReturnType<typeof createApp>,
  desafio: string | null,
  corpo: Record<string, unknown>,
  cookies = "",
): Promise<Response> {
  const cabecalhos: Record<string, string> = {
    cookie: [desafio === null ? "" : `mm_chal=${desafio}`, cookies].filter(Boolean).join("; "),
  };
  return callApi(app, "POST", "/api/auth/login/verify", corpo, cabecalhos);
}

beforeEach(async () => {
  await semearPronto(env.DB);
});

describe("entrar com passkey", () => {
  it("cenário 1: a sessão nova leva a passkey usada; counter e last_used_at são atualizados; o cookie vem com os atributos da spec", async () => {
    const lar = await semearLar(env.DB);
    const { webauthn, verifyAuthentication } = verificadorFalso({ newCounter: 4 });
    const app = createApp({ webauthn });

    const desafio = await pedeDesafio(app);
    const resposta = await verifica(app, desafio, { response: RESPOSTA });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      member: { id: lar.memberId, name: "[TEST] Pessoa A", email: "pessoa.a@example.com", role: "titular" },
      crossDevice: false,
    });
    expect(verifyAuthentication).toHaveBeenCalledWith(
      expect.objectContaining({ expectedChallenge: OPCOES_FALSAS.challenge }),
    );

    const passkey = await env.DB.prepare("SELECT counter, last_used_at FROM passkeys WHERE id = ?")
      .bind(lar.passkeyId)
      .first<{ counter: number; last_used_at: string | null }>();
    expect(passkey?.counter).toBe(4);
    expect(passkey?.last_used_at).not.toBeNull();

    const sessao = await env.DB.prepare("SELECT passkey_id, member_id FROM sessions").first();
    expect(sessao).toEqual({ passkey_id: lar.passkeyId, member_id: lar.memberId });

    const cookie = cabecalhoDoCookie(resposta, "mm_sess") ?? "";
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=2592000/);
    expect(cookie).toMatch(/Path=\//);
  });

  it("cenário 4: passkey que o aparelho tem e o banco não tem dá 401 passkey_desconhecida", async () => {
    const lar = await semearLar(env.DB);
    await env.DB.prepare("DELETE FROM passkeys WHERE id = ?").bind(lar.passkeyId).run();
    const { webauthn, verifyAuthentication } = verificadorFalso();
    const app = createApp({ webauthn });

    const desafio = await pedeDesafio(app);
    const resposta = await verifica(app, desafio, { response: RESPOSTA });

    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toMatchObject({ error: "passkey_desconhecida" });
    expect(verifyAuthentication).not.toHaveBeenCalled();
    expect(await contaSql("SELECT COUNT(*) AS n FROM sessions")).toBe(0);
  });

  it("passkey que não confere (o verificador recusa) dá 401 passkey_nao_confere, sem sessão", async () => {
    await semearLar(env.DB);
    const app = createApp({ webauthn: verificadorFalso(null).webauthn });

    const desafio = await pedeDesafio(app);
    const resposta = await verifica(app, desafio, { response: RESPOSTA });

    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toMatchObject({ error: "passkey_nao_confere" });
    expect(await contaSql("SELECT COUNT(*) AS n FROM sessions")).toBe(0);
  });

  it("cenário 5: sem o cookie do desafio, ou com um desafio vencido, dá 400 desafio_expirado", async () => {
    await semearLar(env.DB);
    const app = createApp({ webauthn: verificadorFalso().webauthn });

    const semCookie = await verifica(app, null, { response: RESPOSTA });
    expect(semCookie.status).toBe(400);
    expect(await semCookie.json()).toMatchObject({ error: "desafio_expirado" });

    // Desafio com a validade passada: a linha existe, mas o prazo acabou.
    const vencido = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO webauthn_challenges (id, challenge, member_id, purpose, expires_at) VALUES (?, 'VENCIDO', NULL, 'login', ?)",
    )
      .bind(vencido, new Date(Date.now() - 60_000).toISOString())
      .run();
    const comVencido = await verifica(app, vencido, { response: RESPOSTA });
    expect(comVencido.status).toBe(400);
    expect(await comVencido.json()).toMatchObject({ error: "desafio_expirado" });
  });

  it("cenário 5: um desafio já usado (reusado) dá 400 desafio_expirado", async () => {
    await semearLar(env.DB);
    const app = createApp({ webauthn: verificadorFalso().webauthn });

    const desafio = await pedeDesafio(app);
    expect((await verifica(app, desafio, { response: RESPOSTA })).status).toBe(200);
    const reusado = await verifica(app, desafio, { response: RESPOSTA });

    expect(reusado.status).toBe(400);
    expect(await reusado.json()).toMatchObject({ error: "desafio_expirado" });
  });

  it("um desafio de outra finalidade (cadastro) não entra: 400 desafio_expirado, e a linha é consumida", async () => {
    await semearLar(env.DB);
    const { webauthn, verifyAuthentication } = verificadorFalso();
    const app = createApp({ webauthn });
    const deCadastro = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO webauthn_challenges (id, challenge, member_id, purpose, expires_at) VALUES (?, 'DESAFIO-CADASTRO', ?, 'cadastro', ?)",
    )
      .bind(deCadastro, crypto.randomUUID(), new Date(Date.now() + 300_000).toISOString())
      .run();

    const resposta = await verifica(app, deCadastro, { response: RESPOSTA });

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toMatchObject({ error: "desafio_expirado" });
    expect(verifyAuthentication).not.toHaveBeenCalled();
    expect(await contaSql("SELECT COUNT(*) AS n FROM webauthn_challenges WHERE id = ?", deCadastro)).toBe(0);
  });

  it("o member_id vem da passkey e nunca do corpo: um member_id no corpo não muda quem entra", async () => {
    const lar = await semearLar(env.DB);
    const app = createApp({ webauthn: verificadorFalso().webauthn });

    const desafio = await pedeDesafio(app);
    const resposta = await verifica(app, desafio, {
      response: RESPOSTA,
      memberId: "[TEST] outra-pessoa",
      member_id: "[TEST] outra-pessoa",
    });

    expect(resposta.status).toBe(200);
    expect(((await resposta.json()) as { member: { id: string } }).member.id).toBe(lar.memberId);
    expect(await env.DB.prepare("SELECT member_id FROM sessions").first()).toEqual({
      member_id: lar.memberId,
    });
  });

  it("entrar de novo no mesmo navegador troca a sessão: a anterior some e fica só a nova", async () => {
    await semearLar(env.DB);
    const app = createApp({ webauthn: verificadorFalso().webauthn });

    const primeiro = await verifica(app, await pedeDesafio(app), { response: RESPOSTA });
    const antigo = valorDoCookie(primeiro, "mm_sess") ?? "";
    const segundo = await verifica(app, await pedeDesafio(app), { response: RESPOSTA }, `mm_sess=${antigo}`);

    expect(segundo.status).toBe(200);
    expect(await contaSql("SELECT COUNT(*) AS n FROM sessions")).toBe(1);
    expect(
      await contaSql("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?", await sha256Hex(antigo)),
    ).toBe(0);
  });

  it("cenário 15: entrada com o celular pelo QR code devolve crossDevice true", async () => {
    await semearLar(env.DB);
    const app = createApp({ webauthn: verificadorFalso().webauthn });
    const resposta = await verifica(app, await pedeDesafio(app), {
      response: { ...RESPOSTA, authenticatorAttachment: "cross-platform" },
    });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({ crossDevice: true });
  });
});

describe("sair", () => {
  it("cenário 8: a linha da sessão some, o cookie é apagado, e repetir o valor antigo dá 401", async () => {
    await semearLar(env.DB);
    const app = createApp({ webauthn: verificadorFalso().webauthn });
    const entrou = await verifica(app, await pedeDesafio(app), { response: RESPOSTA });
    const cookieAntigo = valorDoCookie(entrou, "mm_sess") ?? "";
    expect(await contaSql("SELECT COUNT(*) AS n FROM sessions")).toBe(1);

    const saiu = await callApi(app, "POST", "/api/auth/logout", {}, { cookie: `mm_sess=${cookieAntigo}` });

    expect(saiu.status).toBe(200);
    expect(await saiu.json()).toEqual({ ok: true });
    expect(await contaSql("SELECT COUNT(*) AS n FROM sessions")).toBe(0);
    expect(cabecalhoDoCookie(saiu, "mm_sess")).toMatch(/Max-Age=0/);

    const repetido = await callApi(app, "GET", "/api/auth/session", undefined, {
      cookie: `mm_sess=${cookieAntigo}`,
    });
    expect(repetido.status).toBe(401);
    expect(await repetido.json()).toMatchObject({ error: "nao_autenticado" });
  });

  it("sair sem sessão também responde 200 e não grava nada", async () => {
    const app = createApp({ webauthn: verificadorFalso().webauthn });
    const resposta = await callApi(app, "POST", "/api/auth/logout", {});
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ ok: true });
  });
});

describe("verificação real da passkey (sem falso)", () => {
  // Assinatura de verdade: o verificador do @simplewebauthn/server confere a asserção, inclusive a flag de
  // verificação do usuário (requireUserVerification no login).
  async function larComPasskeyReal() {
    const passkey = await criaPasskeyReal("cred-TEST-uv-0104");
    const lar = await semearLar(env.DB, { passkeyId: passkey.credentialId, publicKey: passkey.publicKey });
    return { passkey, lar };
  }

  it("a passkey com verificação do usuário entra, e o contador novo é gravado", async () => {
    const { passkey, lar } = await larComPasskeyReal();
    const app = createApp();
    const opcoes = await callApi(app, "POST", "/api/auth/login/options", {});
    const desafio = valorDoCookie(opcoes, "mm_chal");
    const { challenge } = (await opcoes.json()) as { challenge: string };

    const asercao = await assinaAsercao(passkey, {
      challenge,
      rpId: "matrimoney.test",
      origin: "http://matrimoney.test",
      verificacaoDoUsuario: true,
      contador: 4,
    });
    const resposta = await verifica(app, desafio, { response: asercao });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({ member: { id: lar.memberId } });
    expect(
      await env.DB.prepare("SELECT counter FROM passkeys WHERE id = ?").bind(lar.passkeyId).first(),
    ).toEqual({ counter: 4 });
  });

  it("uma resposta sem a flag de verificação do usuário é recusada pelo verificador real (401 passkey_nao_confere)", async () => {
    const { passkey, lar } = await larComPasskeyReal();
    const app = createApp();
    const opcoes = await callApi(app, "POST", "/api/auth/login/options", {});
    const desafio = valorDoCookie(opcoes, "mm_chal");
    const { challenge } = (await opcoes.json()) as { challenge: string };

    // Contador acima do guardado (3 na semente): a resposta só pode ser recusada pela falta da flag, não pelo contador.
    const asercao = await assinaAsercao(passkey, {
      challenge,
      rpId: "matrimoney.test",
      origin: "http://matrimoney.test",
      verificacaoDoUsuario: false,
      contador: 4,
    });
    const resposta = await verifica(app, desafio, { response: asercao });

    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toMatchObject({ error: "passkey_nao_confere" });
    expect(await contaSql("SELECT COUNT(*) AS n FROM sessions")).toBe(0);
    expect(
      await env.DB.prepare("SELECT counter FROM passkeys WHERE id = ?").bind(lar.passkeyId).first(),
    ).toEqual({ counter: 3 });
  });
});

describe("cadastro: o member_id vem só do desafio, nunca do corpo", () => {
  const REGISTRO: RegistroVerificado = {
    id: "cred-TEST-cadastro-0104",
    publicKey: "PUB-CAD",
    counter: 0,
    transports: null,
  };

  it("a pessoa criada usa o member_id do desafio, mesmo que o corpo traga outro", async () => {
    // O beforeEach semeia a instalação pronta; este teste começa da configuração, com o código aberto.
    await env.DB.prepare("DELETE FROM invites").run();
    await semearPrimeiroAcesso(env.DB, false);
    const webauthn: WebAuthnVerifier & WebAuthnLoginVerifier = {
      verifyRegistration: vi.fn(async () => REGISTRO) as WebAuthnVerifier["verifyRegistration"],
      authenticationOptions: vi.fn(async () => OPCOES_FALSAS as never),
      verifyAuthentication: vi.fn(async () => null) as WebAuthnLoginVerifier["verifyAuthentication"],
    };
    const app = createApp({ webauthn });
    await callApi(app, "POST", "/api/setup/skip-ai", undefined, { cookie: COOKIE_DE_TESTE });

    const opcoes = await callApi(
      app,
      "POST",
      "/api/setup/household/options",
      { name: "[TEST] Pessoa A", email: "pessoa.a@example.com" },
      { cookie: COOKIE_DE_TESTE },
    );
    const desafio = valorDoCookie(opcoes, "mm_chal") ?? "";
    const doDesafio = await env.DB.prepare("SELECT member_id FROM webauthn_challenges WHERE id = ?")
      .bind(desafio)
      .first<{ member_id: string }>();

    const resposta = await callApi(
      app,
      "POST",
      "/api/setup/household/verify",
      {
        name: "[TEST] Pessoa A",
        email: "pessoa.a@example.com",
        memberId: "[TEST] id-do-corpo",
        member_id: "[TEST] id-do-corpo",
        response: { id: REGISTRO.id } as unknown as RegistrationResponseJSON,
      },
      { cookie: `${COOKIE_DE_TESTE}; mm_chal=${desafio}` },
    );

    expect(resposta.status).toBe(201);
    expect(await env.DB.prepare("SELECT id FROM members").first()).toEqual({ id: doDesafio?.member_id });
  });
});
