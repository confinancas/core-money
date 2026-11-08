import { env } from "cloudflare:test";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../src/shared/access-code";
import { createApp } from "../../src/worker/app";
import type { RegistroVerificado, WebAuthnVerifier } from "../../src/worker/auth/webauthn";
import { CODIGO_DE_TESTE, COOKIE_DE_TESTE, callApi, semearPrimeiroAcesso } from "./helpers/app";

// Cadastro do lar com passkey (TASK-0103). O verificador é falso: a criptografia real fica no E2E.
const REGISTRO: RegistroVerificado = {
  id: "cred-TEST-0001",
  publicKey: "PUBLICA-TEST-0001",
  counter: 0,
  transports: ["internal"],
};

const RESPOSTA_DO_AUTENTICADOR = {
  id: "cred-TEST-0001",
  rawId: "cred-TEST-0001",
  type: "public-key",
  response: { clientDataJSON: "TEST", attestationObject: "TEST" },
  clientExtensionResults: {},
} as unknown as RegistrationResponseJSON;

const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const verificadorFalso = (registro: RegistroVerificado | null = REGISTRO) => {
  const verifyRegistration = vi.fn(async () => registro);
  const webauthn: WebAuthnVerifier = { verifyRegistration };
  return { webauthn, verifyRegistration };
};

const criarApp = (webauthn: WebAuthnVerifier = verificadorFalso().webauthn) => createApp({ webauthn });

const contagem = async (sql: string): Promise<number> => {
  const linha = await env.DB.prepare(sql).first<{ n: number }>();
  return linha?.n ?? 0;
};

// Valor de um cookie emitido pela resposta (Set-Cookie), sem os atributos.
const valorDoCookie = (resposta: Response, nome: string): string | null => {
  for (const cabecalho of resposta.headers.getSetCookie()) {
    if (cabecalho.startsWith(`${nome}=`)) return cabecalho.slice(nome.length + 1).split(";")[0] ?? "";
  }
  return null;
};

const atributosDoCookie = (resposta: Response, nome: string): string => {
  const cabecalho = resposta.headers.getSetCookie().find((texto) => texto.startsWith(`${nome}=`));
  return cabecalho ?? "";
};

// A instalação com o código de teste aberto e sem chave: "continuar sem IA" leva ao modo cadastro.
async function abreCadastro(app: ReturnType<typeof createApp>): Promise<void> {
  await semearPrimeiroAcesso(env.DB, false);
  await callApi(app, "POST", "/api/setup/skip-ai", undefined, { cookie: COOKIE_DE_TESTE });
}

const DADOS = { name: "[TEST] Pessoa A", email: "pessoa.a@example.com" };

// Pede as opções e devolve o desafio e o cookie mm_chal (o id da linha de desafio).
async function pedeOpcoes(app: ReturnType<typeof createApp>, corpo: unknown = DADOS) {
  const resposta = await callApi(app, "POST", "/api/setup/household/options", corpo, {
    cookie: COOKIE_DE_TESTE,
  });
  const opcoes = (await resposta.json()) as { challenge: string };
  return { resposta, opcoes, desafio: valorDoCookie(resposta, "mm_chal") };
}

const cookies = (desafio: string | null) =>
  desafio === null ? COOKIE_DE_TESTE : `${COOKIE_DE_TESTE}; mm_chal=${desafio}`;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("opções do cadastro", () => {
  it("devolve as opções da passkey: rp pelo endereço do Worker, verificação do usuário exigida", async () => {
    await abreCadastro(criarApp());
    const { resposta, opcoes } = await pedeOpcoes(criarApp());

    expect(resposta.status).toBe(200);
    expect(opcoes).toMatchObject({
      rp: { id: "matrimoney.test", name: "App de desenvolvimento" },
      user: { name: "pessoa.a@example.com", displayName: "[TEST] Pessoa A" },
      attestation: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    expect(opcoes.challenge.length).toBeGreaterThan(20);
  });

  it("o cookie do desafio é HttpOnly, Secure, SameSite=Strict, /api e dura 5 minutos", async () => {
    await abreCadastro(criarApp());
    const { resposta } = await pedeOpcoes(criarApp());
    const atributos = atributosDoCookie(resposta, "mm_chal");

    expect(atributos).toContain("HttpOnly");
    expect(atributos).toContain("Secure");
    expect(atributos).toContain("SameSite=Strict");
    expect(atributos).toContain("Path=/api");
    expect(atributos).toContain("Max-Age=300");
  });

  it("e-mail vazio vira null no membro; e-mail inválido e nome vazio dão 400 com a mensagem do campo", async () => {
    await abreCadastro(criarApp());
    const app = criarApp();

    const semEmail = await callApi(
      app,
      "POST",
      "/api/setup/household/options",
      { name: "[TEST] Pessoa A", email: "" },
      { cookie: COOKIE_DE_TESTE },
    );
    expect(semEmail.status).toBe(200);

    const emailRuim = await callApi(
      app,
      "POST",
      "/api/setup/household/options",
      { name: "[TEST] Pessoa A", email: "pessoa.a" },
      { cookie: COOKIE_DE_TESTE },
    );
    expect(emailRuim.status).toBe(400);
    expect(await emailRuim.json()).toEqual({ error: "validacao", fields: { email: "Confira o e-mail." } });

    const semNome = await callApi(
      app,
      "POST",
      "/api/setup/household/options",
      { name: "   ", email: null },
      { cookie: COOKIE_DE_TESTE },
    );
    expect(semNome.status).toBe(400);
    expect(await semNome.json()).toEqual({
      error: "validacao",
      fields: { name: "Digite seu nome (até 40 letras)." },
    });
  });

  it("sem o código de primeiro acesso: 403 codigo_necessario e nada gravado", async () => {
    await abreCadastro(criarApp());
    const resposta = await callApi(app(), "POST", "/api/setup/household/options", DADOS);

    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toMatchObject({ error: "codigo_necessario" });
    expect(await contagem("SELECT COUNT(*) AS n FROM webauthn_challenges")).toBe(0);
  });

  it("com a configuração ainda sem chave nem 'sem IA': 503 configuracao_pendente", async () => {
    await semearPrimeiroAcesso(env.DB, false);
    const resposta = await callApi(app(), "POST", "/api/setup/household/options", DADOS, {
      cookie: COOKIE_DE_TESTE,
    });

    expect(resposta.status).toBe(503);
    expect(await resposta.json()).toMatchObject({ error: "configuracao_pendente" });
  });

  it("com um membro já no lar: 409 lar_ja_existe (restauração já feita)", async () => {
    await abreCadastro(criarApp());
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO households (id, brand, created_at) VALUES ('lar-TEST-0001', 'matrimoney', '2026-11-07T00:00:00.000Z')",
      ),
      env.DB.prepare(
        "INSERT INTO members (id, household_id, name, role, created_at) VALUES ('pessoa-TEST-0001', 'lar-TEST-0001', '[TEST] Pessoa B', 'titular', '2026-11-07T00:00:00.000Z')",
      ),
    ]);
    const resposta = await callApi(criarApp(), "POST", "/api/setup/household/options", DADOS, {
      cookie: COOKIE_DE_TESTE,
    });

    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toMatchObject({ error: "lar_ja_existe" });
    // Nada gravado: nenhum desafio, nenhum cookie de desafio, o código continua aberto.
    expect(resposta.headers.getSetCookie().some((texto) => texto.startsWith("mm_chal="))).toBe(false);
    expect(await contagem("SELECT COUNT(*) AS n FROM webauthn_challenges")).toBe(0);
    expect(await contagem("SELECT COUNT(*) AS n FROM invites WHERE used_at IS NOT NULL")).toBe(0);
    expect(await contagem("SELECT COUNT(*) AS n FROM members")).toBe(1);
  });

  it("restauração entre as opções e a verificação: 409 lar_ja_existe, sem cookie, e o código não é consumido", async () => {
    await abreCadastro(criarApp());
    const app = criarApp(verificadorFalso().webauthn);
    const { desafio } = await pedeOpcoes(app);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO households (id, brand, created_at) VALUES ('lar-TEST-0002', 'matrimoney', '2026-11-07T00:00:00.000Z')",
      ),
      env.DB.prepare(
        "INSERT INTO members (id, household_id, name, role, created_at) VALUES ('pessoa-TEST-0002', 'lar-TEST-0002', '[TEST] Pessoa B', 'titular', '2026-11-07T00:00:00.000Z')",
      ),
    ]);

    const resposta = await callApi(
      app,
      "POST",
      "/api/setup/household/verify",
      { ...DADOS, response: RESPOSTA_DO_AUTENTICADOR },
      { cookie: cookies(desafio) },
    );

    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toMatchObject({ error: "lar_ja_existe" });
    expect(resposta.headers.getSetCookie().some((texto) => texto.startsWith("mm_sess="))).toBe(false);
    expect(await contagem("SELECT COUNT(*) AS n FROM invites WHERE used_at IS NOT NULL")).toBe(0);
    expect(await contagem("SELECT COUNT(*) AS n FROM households")).toBe(1);
    expect(await contagem("SELECT COUNT(*) AS n FROM members")).toBe(1);
    expect(await contagem("SELECT COUNT(*) AS n FROM passkeys")).toBe(0);
    expect(await contagem("SELECT COUNT(*) AS n FROM sessions")).toBe(0);
  });
});

function app() {
  return criarApp();
}

describe("verificação do cadastro", () => {
  it("caminho feliz: um lar, um titular, uma passkey 'cadastro', uma sessão, código usado e a instalação pronta", async () => {
    await abreCadastro(criarApp());
    const { webauthn, verifyRegistration } = verificadorFalso();
    const app = criarApp(webauthn);
    const { opcoes, desafio } = await pedeOpcoes(app);

    const resposta = await callApi(
      app,
      "POST",
      "/api/setup/household/verify",
      { ...DADOS, response: RESPOSTA_DO_AUTENTICADOR },
      { cookie: cookies(desafio), "user-agent": UA_IPHONE },
    );

    expect(resposta.status).toBe(201);
    const corpo = (await resposta.json()) as { member: Record<string, unknown>; household: { id: string } };
    expect(corpo.member).toEqual({
      id: expect.any(String),
      name: "[TEST] Pessoa A",
      email: "pessoa.a@example.com",
      role: "titular",
    });
    expect(verifyRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ expectedChallenge: opcoes.challenge }),
    );

    expect(await contagem("SELECT COUNT(*) AS n FROM households")).toBe(1);
    expect(
      await contagem("SELECT COUNT(*) AS n FROM members WHERE role = 'titular' AND household_id IS NOT NULL"),
    ).toBe(1);
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM passkeys WHERE added_via = 'cadastro' AND device_name = 'iPhone · Safari'",
      ),
    ).toBe(1);
    expect(await contagem("SELECT COUNT(*) AS n FROM sessions WHERE passkey_id = 'cred-TEST-0001'")).toBe(1);
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM invites WHERE kind = 'primeiro_acesso' AND used_at IS NOT NULL",
      ),
    ).toBe(1);
    expect(await contagem("SELECT COUNT(*) AS n FROM webauthn_challenges")).toBe(0);

    const status = await callApi(app, "GET", "/api/setup/status");
    expect(await status.json()).toMatchObject({ mode: "pronto", hasMembers: true });
  });

  it("a sessão: o cookie mm_sess é HttpOnly, Secure, SameSite=Lax, dura 30 dias, e o banco guarda só o hash", async () => {
    await abreCadastro(criarApp());
    const app = criarApp(verificadorFalso().webauthn);
    const { desafio } = await pedeOpcoes(app);
    const resposta = await callApi(
      app,
      "POST",
      "/api/setup/household/verify",
      { ...DADOS, response: RESPOSTA_DO_AUTENTICADOR },
      { cookie: cookies(desafio) },
    );

    const atributos = atributosDoCookie(resposta, "mm_sess");
    expect(atributos).toContain("HttpOnly");
    expect(atributos).toContain("Secure");
    expect(atributos).toContain("SameSite=Lax");
    expect(atributos).toContain("Path=/");
    expect(atributos).toContain("Max-Age=2592000");

    const token = valorDoCookie(resposta, "mm_sess") ?? "";
    expect(token.length).toBeGreaterThanOrEqual(40);
    const linha = await env.DB.prepare("SELECT token_hash FROM sessions").first<{ token_hash: string }>();
    expect(linha?.token_hash).toBe(await sha256Hex(token));
    expect(linha?.token_hash).not.toBe(token);
    expect(await contagem(`SELECT COUNT(*) AS n FROM sessions WHERE token_hash = '${token}'`)).toBe(0);
  });

  it("o cookie do código é apagado depois do cadastro", async () => {
    await abreCadastro(criarApp());
    const app = criarApp(verificadorFalso().webauthn);
    const { desafio } = await pedeOpcoes(app);
    const resposta = await callApi(
      app,
      "POST",
      "/api/setup/household/verify",
      { ...DADOS, response: RESPOSTA_DO_AUTENTICADOR },
      { cookie: cookies(desafio) },
    );

    expect(atributosDoCookie(resposta, "mm_setup")).toContain("Max-Age=0");
  });

  it("e-mail vazio no cadastro: o membro sai com e-mail nulo", async () => {
    await abreCadastro(criarApp());
    const app = criarApp(verificadorFalso().webauthn);
    const { desafio } = await pedeOpcoes(app, { name: "[TEST] Pessoa A", email: null });
    const resposta = await callApi(
      app,
      "POST",
      "/api/setup/household/verify",
      { name: "[TEST] Pessoa A", email: "", response: RESPOSTA_DO_AUTENTICADOR },
      { cookie: cookies(desafio) },
    );

    expect(resposta.status).toBe(201);
    expect(await contagem("SELECT COUNT(*) AS n FROM members WHERE email IS NULL")).toBe(1);
  });

  it("desafio vencido: 400 desafio_expirado e nada gravado", async () => {
    await abreCadastro(criarApp());
    const app = criarApp(verificadorFalso().webauthn);
    const { desafio } = await pedeOpcoes(app);
    await env.DB.prepare("UPDATE webauthn_challenges SET expires_at = '2000-01-01T00:00:00.000Z'").run();

    const resposta = await callApi(
      app,
      "POST",
      "/api/setup/household/verify",
      { ...DADOS, response: RESPOSTA_DO_AUTENTICADOR },
      { cookie: cookies(desafio) },
    );

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toMatchObject({ error: "desafio_expirado" });
    expect(await contagem("SELECT COUNT(*) AS n FROM households")).toBe(0);
  });

  it("desafio reusado: depois de uma verificação recusada, o mesmo cookie dá 400 desafio_expirado", async () => {
    await abreCadastro(criarApp());
    const { webauthn } = verificadorFalso(null);
    const app = criarApp(webauthn);
    const { desafio } = await pedeOpcoes(app);

    const primeira = await callApi(
      app,
      "POST",
      "/api/setup/household/verify",
      { ...DADOS, response: RESPOSTA_DO_AUTENTICADOR },
      { cookie: cookies(desafio) },
    );
    expect(primeira.status).toBe(400);
    expect(await primeira.json()).toMatchObject({ error: "passkey_invalida" });

    const segunda = await callApi(
      app,
      "POST",
      "/api/setup/household/verify",
      { ...DADOS, response: RESPOSTA_DO_AUTENTICADOR },
      { cookie: cookies(desafio) },
    );
    expect(segunda.status).toBe(400);
    expect(await segunda.json()).toMatchObject({ error: "desafio_expirado" });
  });

  it("passkey que o verificador não confirma, ou que lança, dá 400 passkey_invalida e nada gravado", async () => {
    await abreCadastro(criarApp());
    const lança: WebAuthnVerifier = {
      verifyRegistration: async () => {
        throw new Error("resposta malformada");
      },
    };
    for (const webauthn of [verificadorFalso(null).webauthn, lança]) {
      const app = criarApp(webauthn);
      const { desafio } = await pedeOpcoes(app);
      const resposta = await callApi(
        app,
        "POST",
        "/api/setup/household/verify",
        { ...DADOS, response: RESPOSTA_DO_AUTENTICADOR },
        { cookie: cookies(desafio) },
      );
      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toMatchObject({ error: "passkey_invalida" });
    }
    expect(await contagem("SELECT COUNT(*) AS n FROM households")).toBe(0);
    expect(await contagem("SELECT COUNT(*) AS n FROM passkeys")).toBe(0);
  });

  it("duas verificações ao mesmo tempo: um lar e um membro; a outra recebe 409 lar_ja_existe, sem cookie de sessão", async () => {
    await abreCadastro(criarApp());
    const app = criarApp(verificadorFalso().webauthn);
    const primeiro = await pedeOpcoes(app, { name: "[TEST] Pessoa A", email: null });
    const segundo = await pedeOpcoes(app, { name: "[TEST] Pessoa B", email: null });

    const [a, b] = await Promise.all([
      callApi(
        app,
        "POST",
        "/api/setup/household/verify",
        { name: "[TEST] Pessoa A", email: null, response: RESPOSTA_DO_AUTENTICADOR },
        { cookie: cookies(primeiro.desafio) },
      ),
      callApi(
        app,
        "POST",
        "/api/setup/household/verify",
        { name: "[TEST] Pessoa B", email: null, response: RESPOSTA_DO_AUTENTICADOR },
        { cookie: cookies(segundo.desafio) },
      ),
    ]);

    const respostas = [a, b].sort((x, y) => x.status - y.status);
    expect(respostas.map((r) => r.status)).toEqual([201, 409]);
    const perdedora = respostas[1];
    expect(await perdedora?.json()).toMatchObject({ error: "lar_ja_existe" });
    expect(perdedora?.headers.getSetCookie().some((texto) => texto.startsWith("mm_sess="))).toBe(false);

    expect(await contagem("SELECT COUNT(*) AS n FROM households")).toBe(1);
    expect(await contagem("SELECT COUNT(*) AS n FROM members")).toBe(1);
    expect(await contagem("SELECT COUNT(*) AS n FROM passkeys")).toBe(1);
    expect(await contagem("SELECT COUNT(*) AS n FROM sessions")).toBe(1);
  });

  it("código trocado no meio do cadastro: 403 codigo_necessario e nada gravado", async () => {
    await abreCadastro(criarApp());
    const app = criarApp(verificadorFalso().webauthn);
    const { desafio } = await pedeOpcoes(app);
    await env.DB.prepare("UPDATE invites SET token_hash = ? WHERE kind = 'primeiro_acesso'")
      .bind(await sha256Hex("OUTRO-CODIGO"))
      .run();

    const resposta = await callApi(
      app,
      "POST",
      "/api/setup/household/verify",
      { ...DADOS, response: RESPOSTA_DO_AUTENTICADOR },
      { cookie: cookies(desafio) },
    );

    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toMatchObject({ error: "codigo_necessario" });
    expect(await contagem("SELECT COUNT(*) AS n FROM households")).toBe(0);
    expect(await contagem("SELECT COUNT(*) AS n FROM invites WHERE used_at IS NOT NULL")).toBe(0);
  });

  it("depois do cadastro: as rotas de configuração dão 409 configuracao_concluida e o status continua 200", async () => {
    await abreCadastro(criarApp());
    const app = criarApp(verificadorFalso().webauthn);
    const { desafio } = await pedeOpcoes(app);
    await callApi(
      app,
      "POST",
      "/api/setup/household/verify",
      { ...DADOS, response: RESPOSTA_DO_AUTENTICADOR },
      { cookie: cookies(desafio) },
    );

    const opcoes = await callApi(app, "POST", "/api/setup/household/options", DADOS, {
      cookie: COOKIE_DE_TESTE,
    });
    expect(opcoes.status).toBe(409);
    expect(await opcoes.json()).toMatchObject({ error: "configuracao_concluida" });

    const unlock = await callApi(app, "POST", "/api/setup/unlock", { code: CODIGO_DE_TESTE }, {});
    expect(unlock.status).toBe(409);

    const status = await callApi(app, "GET", "/api/setup/status");
    expect(status.status).toBe(200);
  });
});
