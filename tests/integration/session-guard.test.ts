import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/worker/app";
import type { WebAuthnLoginVerifier, WebAuthnVerifier } from "../../src/worker/auth/webauthn";
import { callApi, semearPronto } from "./helpers/app";
import {
  COOKIE_DE_SESSAO_DE_TESTE,
  cabecalhoDoCookie,
  contaSql,
  semearLar,
  semearSessao,
  TOKEN_DE_TESTE,
} from "./helpers/sessao";

// O portão de sessão (TASK-0104): rotas protegidas, renovação, duas pessoas, o mesmo do outro site e o householdId da
// sessão chegando às rotas do lar. Cenários 6, 7, 9, 10 e 13.

const verificadorNeutro: WebAuthnVerifier & WebAuthnLoginVerifier = {
  verifyRegistration: vi.fn(async () => null) as WebAuthnVerifier["verifyRegistration"],
  authenticationOptions: vi.fn(
    async () => ({ challenge: "X" }) as never,
  ) as WebAuthnLoginVerifier["authenticationOptions"],
  verifyAuthentication: vi.fn(async () => null) as WebAuthnLoginVerifier["verifyAuthentication"],
};
const criarApp = () => createApp({ webauthn: verificadorNeutro });

beforeEach(async () => {
  await semearPronto(env.DB);
});

describe("cenário 6: sessão vencida", () => {
  it("com expires_at no passado, a rota protegida dá 401 nao_autenticado e apaga o cookie", async () => {
    const lar = await semearLar(env.DB);
    await semearSessao(env.DB, { memberId: lar.memberId, passkeyId: lar.passkeyId, expiraEmHoras: -1 });

    const resposta = await callApi(criarApp(), "GET", "/api/household", undefined, {
      cookie: COOKIE_DE_SESSAO_DE_TESTE,
    });

    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual({
      error: "nao_autenticado",
      message: "Entre de novo para continuar.",
    });
    expect(cabecalhoDoCookie(resposta, "mm_sess")).toMatch(/Max-Age=0/);
  });
});

describe("cenário 7: renovação", () => {
  it("com a última visita de 25 h, expires_at passa para agora + 30 dias e o cookie vem de novo com Max-Age de 30 dias", async () => {
    const lar = await semearLar(env.DB);
    await semearSessao(env.DB, {
      memberId: lar.memberId,
      passkeyId: lar.passkeyId,
      ultimoUsoHaHoras: 25,
      expiraEmHoras: 48,
    });

    const resposta = await callApi(criarApp(), "GET", "/api/household", undefined, {
      cookie: COOKIE_DE_SESSAO_DE_TESTE,
    });

    expect(resposta.status).toBe(200);
    const linha = await env.DB.prepare("SELECT last_seen_at, expires_at FROM sessions").first<{
      last_seen_at: string;
      expires_at: string;
    }>();
    const agora = Date.now();
    const trintaDias = 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(Date.parse(linha?.expires_at ?? "") - (agora + trintaDias))).toBeLessThan(60_000);
    expect(Math.abs(Date.parse(linha?.last_seen_at ?? "") - agora)).toBeLessThan(60_000);
    expect(cabecalhoDoCookie(resposta, "mm_sess")).toMatch(/Max-Age=2592000/);
  });

  it("com a última visita de 1 h, nenhuma escrita: expires_at fica como estava e o cookie não volta", async () => {
    const lar = await semearLar(env.DB);
    await semearSessao(env.DB, {
      memberId: lar.memberId,
      passkeyId: lar.passkeyId,
      ultimoUsoHaHoras: 1,
      expiraEmHoras: 48,
    });
    const antes = await env.DB.prepare("SELECT last_seen_at, expires_at FROM sessions").first();

    const resposta = await callApi(criarApp(), "GET", "/api/household", undefined, {
      cookie: COOKIE_DE_SESSAO_DE_TESTE,
    });

    expect(resposta.status).toBe(200);
    expect(await env.DB.prepare("SELECT last_seen_at, expires_at FROM sessions").first()).toEqual(antes);
    expect(cabecalhoDoCookie(resposta, "mm_sess")).toBeNull();
  });
});

describe("cenário 9: rotas protegidas sem sessão", () => {
  it.each([
    ["GET", "/api/features", undefined],
    ["GET", "/api/settings/keys", undefined],
    ["PUT", "/api/settings/keys/claude", { apiKey: "sk-ant-api03-TEST-invalida" }],
    ["PUT", "/api/features/assistente", { enabled: true }],
    ["GET", "/api/household", undefined],
    ["GET", "/api/categories", undefined],
    ["GET", "/api/transactions/abc/categorization", undefined],
  ])("%s %s dá 401 sem sessão", async (metodo, caminho, corpo) => {
    await semearLar(env.DB);
    const resposta = await callApi(criarApp(), metodo, caminho, corpo);
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toMatchObject({ error: "nao_autenticado" });
  });

  it("as rotas públicas continuam respondendo sem sessão", async () => {
    const app = criarApp();
    expect((await callApi(app, "GET", "/api/health")).status).toBe(200);
    expect((await callApi(app, "GET", "/api/setup/status")).status).toBe(200);
    // A sonda da sessão é pública, mas responde 401 quando não há sessão.
    const sonda = await callApi(app, "GET", "/api/auth/session");
    expect(sonda.status).toBe(401);
    expect(await sonda.json()).toMatchObject({ error: "nao_autenticado" });
  });

  it("com a sessão, as mesmas rotas respondem", async () => {
    const lar = await semearLar(env.DB);
    await semearSessao(env.DB, { memberId: lar.memberId, passkeyId: lar.passkeyId });
    const app = criarApp();
    for (const caminho of ["/api/features", "/api/settings/keys", "/api/household", "/api/categories"]) {
      const resposta = await callApi(app, "GET", caminho, undefined, { cookie: COOKIE_DE_SESSAO_DE_TESTE });
      expect(resposta.status, caminho).toBe(200);
    }
  });
});

describe("cenário 10: os dois parceiros", () => {
  it("cada sessão vê a própria pessoa e o mesmo lar; sair num aparelho não derruba o outro", async () => {
    const lar = await semearLar(env.DB);
    const conjugeId = crypto.randomUUID();
    const passkeyConjuge = "cred-TEST-0104-conjuge";
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO members (id, household_id, name, email, role, created_at) VALUES (?, ?, '[TEST] Pessoa B', 'pessoa.b@example.com', 'conjuge', ?)",
      ).bind(conjugeId, lar.householdId, new Date().toISOString()),
      env.DB.prepare(
        "INSERT INTO passkeys (id, member_id, public_key, counter, transports, device_name, added_via, created_at, last_used_at) VALUES (?, ?, 'PUB-B', 0, NULL, 'Android · Chrome', 'cadastro', ?, NULL)",
      ).bind(passkeyConjuge, conjugeId, new Date().toISOString()),
    ]);
    const tokenA = await semearSessao(env.DB, { memberId: lar.memberId, passkeyId: lar.passkeyId });
    const tokenB = await semearSessao(env.DB, {
      memberId: conjugeId,
      passkeyId: passkeyConjuge,
      token: "TESTE-SESSAO-0104-token-do-conjuge-0001",
    });
    const app = criarApp();

    const daA = await (
      await callApi(app, "GET", "/api/auth/session", undefined, { cookie: `mm_sess=${tokenA}` })
    ).json();
    const daB = await (
      await callApi(app, "GET", "/api/auth/session", undefined, { cookie: `mm_sess=${tokenB}` })
    ).json();
    expect((daA as { member: { id: string } }).member.id).toBe(lar.memberId);
    expect((daB as { member: { id: string } }).member.id).toBe(conjugeId);
    expect((daA as { household: { id: string } }).household.id).toBe(lar.householdId);
    expect((daB as { household: { id: string } }).household.id).toBe(lar.householdId);

    await callApi(app, "POST", "/api/auth/logout", {}, { cookie: `mm_sess=${tokenA}` });

    expect(
      (await callApi(app, "GET", "/api/auth/session", undefined, { cookie: `mm_sess=${tokenA}` })).status,
    ).toBe(401);
    expect(
      (await callApi(app, "GET", "/api/auth/session", undefined, { cookie: `mm_sess=${tokenB}` })).status,
    ).toBe(200);
  });
});

describe("cenário 13: pedido de outro site", () => {
  it("POST com Sec-Fetch-Site cross-site dá 403 origem_invalida", async () => {
    const resposta = await callApi(
      criarApp(),
      "POST",
      "/api/auth/login/options",
      {},
      { "sec-fetch-site": "cross-site" },
    );
    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toMatchObject({ error: "origem_invalida" });
  });

  it("PATCH e DELETE com cross-site também dão 403, antes de qualquer rota", async () => {
    const lar = await semearLar(env.DB);
    await semearSessao(env.DB, { memberId: lar.memberId, passkeyId: lar.passkeyId });
    const app = criarApp();
    const cabecalhos = { cookie: COOKIE_DE_SESSAO_DE_TESTE, "sec-fetch-site": "cross-site" };
    expect((await callApi(app, "PATCH", "/api/household", { cycleStartDay: 5 }, cabecalhos)).status).toBe(
      403,
    );
    expect((await callApi(app, "DELETE", "/api/rules/qualquer", undefined, cabecalhos)).status).toBe(403);
  });

  it("POST com text/plain dá 415 json_obrigatorio, mesmo com sessão", async () => {
    const lar = await semearLar(env.DB);
    await semearSessao(env.DB, { memberId: lar.memberId, passkeyId: lar.passkeyId });
    const resposta = await criarApp().fetch(
      new Request("http://matrimoney.test/api/categories", {
        method: "POST",
        headers: { "content-type": "text/plain", cookie: COOKIE_DE_SESSAO_DE_TESTE },
        body: "nome=x",
      }),
      env,
    );
    expect(resposta.status).toBe(415);
    expect(await resposta.json()).toMatchObject({ error: "json_obrigatorio" });
  });

  it("um pedido sem corpo passa (o same-origin só olha o que vem no corpo)", async () => {
    const resposta = await callApi(criarApp(), "POST", "/api/auth/logout", undefined, {});
    expect(resposta.status).toBe(200);
  });
});

describe("o lar da sessão chega às rotas do lar", () => {
  it("GET /api/household responde o lar da sessão, com quem está logado marcado", async () => {
    const lar = await semearLar(env.DB);
    await semearSessao(env.DB, { memberId: lar.memberId, passkeyId: lar.passkeyId });
    const resposta = await callApi(criarApp(), "GET", "/api/household", undefined, {
      cookie: COOKIE_DE_SESSAO_DE_TESTE,
    });
    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as {
      household: { id: string };
      members: { id: string; isMe: boolean }[];
    };
    expect(corpo.household.id).toBe(lar.householdId);
    expect(corpo.members).toEqual([
      { id: lar.memberId, name: "[TEST] Pessoa A", role: "titular", isMe: true },
    ]);
  });

  it("as categorias usam o resolvedor real: a semente é do lar da sessão", async () => {
    const lar = await semearLar(env.DB);
    await semearSessao(env.DB, { memberId: lar.memberId, passkeyId: lar.passkeyId });
    const resposta = await callApi(criarApp(), "GET", "/api/categories", undefined, {
      cookie: COOKIE_DE_SESSAO_DE_TESTE,
    });
    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as { categories: unknown[] };
    expect(corpo.categories.length).toBeGreaterThan(0);
    expect(
      await contaSql("SELECT COUNT(*) AS n FROM categories WHERE household_id = ?", lar.householdId),
    ).toBeGreaterThan(0);
  });

  it("o token fixo de teste bate com o hash guardado (sem o token em texto no banco)", async () => {
    const lar = await semearLar(env.DB);
    await semearSessao(env.DB, { memberId: lar.memberId, passkeyId: lar.passkeyId });
    const linha = await env.DB.prepare("SELECT token_hash FROM sessions").first<{ token_hash: string }>();
    expect(linha?.token_hash).not.toBe(TOKEN_DE_TESTE);
    expect(linha?.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
