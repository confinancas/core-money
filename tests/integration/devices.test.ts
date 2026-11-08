import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/shared/access-code";
import { createApp } from "../../src/worker/app";
import {
  COOKIE_DO_CONJUGE,
  COOKIE_DO_TITULAR,
  criaLarDeDuas,
  criaOutroLar,
  PASSKEY_DO_CONJUGE,
  PASSKEY_DO_TITULAR,
  respostaDeRegistro,
  TOKEN_DO_TITULAR,
  verificadorDeRegistro,
} from "./helpers/aparelhos";
import { callApi, semearPronto } from "./helpers/app";
import { valorDoCookie } from "./helpers/sessao";

// Aparelhos (TASK-0106): cenários 1 a 6 e os caminhos de segurança (outro lar, último aparelho, duas operações juntas,
// desafio de outra pessoa, uso único). Cada teste de segurança tem uma mutação em MUTACOES (ver Evidências).

type Pessoa = { id: string; name: string; isMe: boolean; devices: { id: string; isCurrent: boolean }[] };

async function listaDoLar(app: ReturnType<typeof createApp>, cookie: string): Promise<Pessoa[]> {
  const resposta = await callApi(app, "GET", "/api/devices", undefined, { cookie });
  expect(resposta.status).toBe(200);
  const { members } = (await resposta.json()) as { members: Pessoa[] };
  return members;
}

async function pedeOpcoesDoAparelho(app: ReturnType<typeof createApp>, cookie: string) {
  const resposta = await callApi(app, "POST", "/api/devices/options", {}, { cookie });
  expect(resposta.status).toBe(200);
  const opcoes = (await resposta.json()) as { excludeCredentials?: { id: string }[] };
  const desafio = valorDoCookie(resposta, "mm_chal");
  expect(desafio).toBeTruthy();
  return { opcoes, desafio: desafio ?? "" };
}

async function verificaAparelho(
  app: ReturnType<typeof createApp>,
  desafio: string,
  cookie: string,
  id: string,
): Promise<Response> {
  return callApi(
    app,
    "POST",
    "/api/devices/verify",
    { response: respostaDeRegistro(id) },
    { cookie: [cookie, `mm_chal=${desafio}`].join("; ") },
  );
}

const contagem = (sql: string, ...valores: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...valores)
    .first<{ n: number }>()
    .then((linha) => linha?.n ?? 0);

beforeEach(async () => {
  await semearPronto(env.DB);
});

describe("cenário 1: a lista de aparelhos", () => {
  it("cada pessoa aparece com os próprios aparelhos; o aparelho em uso vem marcado; o do cônjuge ainda não foi usado", async () => {
    await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });

    const membros = await listaDoLar(app, COOKIE_DO_TITULAR);
    expect(membros.map((pessoa) => pessoa.name)).toEqual(["[TEST] Pessoa A", "[TEST] Pessoa B"]);
    expect(membros[0]).toMatchObject({ isMe: true, devices: [{ id: PASSKEY_DO_TITULAR, isCurrent: true }] });
    expect(membros[1]).toMatchObject({
      isMe: false,
      devices: [{ id: PASSKEY_DO_CONJUGE, isCurrent: false }],
    });

    const lista = await callApi(app, "GET", "/api/devices", undefined, { cookie: COOKIE_DO_CONJUGE });
    const corpo = (await lista.json()) as {
      members: { isMe: boolean; devices: { addedVia: string; lastUsedAt: string | null }[] }[];
    };
    expect(corpo.members[1]).toMatchObject({ isMe: true });
    expect(corpo.members[1]?.devices[0]).toMatchObject({ addedVia: "convite", lastUsedAt: null });
  });

  it("sem sessão, a lista responde 401", async () => {
    await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });
    const resposta = await callApi(app, "GET", "/api/devices");
    expect(resposta.status).toBe(401);
  });
});

describe("cenário 2: adicionar este aparelho", () => {
  it("nasce a passkey 'aparelho', a sessão passa a depender dela, e remover o celular depois não derruba este computador", async () => {
    const lar = await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });

    const { opcoes, desafio } = await pedeOpcoesDoAparelho(app, COOKIE_DO_TITULAR);
    // O navegador recebe as passkeys que a pessoa já tem, para não criar a mesma de novo.
    expect(opcoes.excludeCredentials?.map((item) => item.id)).toEqual([PASSKEY_DO_TITULAR]);

    const criado = await verificaAparelho(app, desafio, COOKIE_DO_TITULAR, "cred-TEST-0106-computador-1");
    expect(criado.status).toBe(201);
    expect(await criado.json()).toMatchObject({
      device: { id: "cred-TEST-0106-computador-1", addedVia: "aparelho", isCurrent: true },
    });

    const passkey = await env.DB.prepare("SELECT member_id, added_via FROM passkeys WHERE id = ?")
      .bind("cred-TEST-0106-computador-1")
      .first<{ member_id: string; added_via: string }>();
    expect(passkey).toEqual({ member_id: lar.titularId, added_via: "aparelho" });

    const sessao = await env.DB.prepare("SELECT passkey_id FROM sessions WHERE token_hash = ?")
      .bind(await sha256Hex(TOKEN_DO_TITULAR))
      .first<{ passkey_id: string }>();
    expect(sessao?.passkey_id).toBe("cred-TEST-0106-computador-1");

    // O celular é removido: este computador continua logado, porque a sessão já depende da passkey nova.
    const removeCelular = await callApi(app, "DELETE", `/api/devices/${PASSKEY_DO_TITULAR}`, undefined, {
      cookie: COOKIE_DO_TITULAR,
    });
    expect(removeCelular.status).toBe(200);
    expect(await removeCelular.json()).toEqual({ endedCurrentSession: false });
    const continua = await callApi(app, "GET", "/api/auth/session", undefined, { cookie: COOKIE_DO_TITULAR });
    expect(continua.status).toBe(200);
  });
});

describe("cenário 3: aparelho repetido", () => {
  it("o mesmo aparelho de novo dá 409 aparelho_ja_cadastrado e nada é gravado", async () => {
    await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });
    const { desafio } = await pedeOpcoesDoAparelho(app, COOKIE_DO_TITULAR);

    const repetido = await verificaAparelho(app, desafio, COOKIE_DO_TITULAR, PASSKEY_DO_TITULAR);
    expect(repetido.status).toBe(409);
    expect(await repetido.json()).toMatchObject({ error: "aparelho_ja_cadastrado" });
    // Continuam duas passkeys no lar: a do titular e a do cônjuge. Nenhuma passkey nova entrou.
    expect(await contagem("SELECT COUNT(*) AS n FROM passkeys")).toBe(2);
  });
});

describe("cenário 4: remover outro aparelho", () => {
  it("as sessões do aparelho removido somem; a próxima chamada dele dá 401; a passkey dele não entra mais", async () => {
    await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });
    expect(
      await contagem("SELECT COUNT(*) AS n FROM sessions WHERE passkey_id = ?", PASSKEY_DO_CONJUGE),
    ).toBe(1);

    const removido = await callApi(app, "DELETE", `/api/devices/${PASSKEY_DO_CONJUGE}`, undefined, {
      cookie: COOKIE_DO_TITULAR,
    });
    expect(removido.status).toBe(200);
    expect(await removido.json()).toEqual({ endedCurrentSession: false });
    expect(
      await contagem("SELECT COUNT(*) AS n FROM sessions WHERE passkey_id = ?", PASSKEY_DO_CONJUGE),
    ).toBe(0);

    const depois = await callApi(app, "GET", "/api/auth/session", undefined, { cookie: COOKIE_DO_CONJUGE });
    expect(depois.status).toBe(401);

    // O login com a passkey removida: o aparelho ainda a tem, mas o banco não.
    const entrada = await callApi(app, "POST", "/api/auth/login/options", {});
    const desafio = valorDoCookie(entrada, "mm_chal") ?? "";
    const tentativa = await callApi(
      app,
      "POST",
      "/api/auth/login/verify",
      { response: { id: PASSKEY_DO_CONJUGE, rawId: PASSKEY_DO_CONJUGE, type: "public-key" } as unknown },
      { cookie: `mm_chal=${desafio}` },
    );
    expect(tentativa.status).toBe(401);
    expect(await tentativa.json()).toMatchObject({ error: "passkey_desconhecida" });
  });
});

describe("cenário 5: remover o aparelho em uso", () => {
  it("responde endedCurrentSession, apaga o cookie e a sessão deste aparelho deixa de valer", async () => {
    await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });

    const removido = await callApi(app, "DELETE", `/api/devices/${PASSKEY_DO_TITULAR}`, undefined, {
      cookie: COOKIE_DO_TITULAR,
    });
    expect(removido.status).toBe(200);
    expect(await removido.json()).toEqual({ endedCurrentSession: true });
    const cookie = removido.headers.getSetCookie().find((texto) => texto.startsWith("mm_sess="));
    expect(cookie).toMatch(/Max-Age=0|1970/);

    const depois = await callApi(app, "GET", "/api/auth/session", undefined, { cookie: COOKIE_DO_TITULAR });
    expect(depois.status).toBe(401);
  });
});

describe("cenário 6: remover o último aparelho do parceiro", () => {
  it("é permitido: a pessoa fica sem aparelho e a lista mostra só a própria linha vazia", async () => {
    await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });

    const removido = await callApi(app, "DELETE", `/api/devices/${PASSKEY_DO_CONJUGE}`, undefined, {
      cookie: COOKIE_DO_TITULAR,
    });
    expect(removido.status).toBe(200);

    const membros = await listaDoLar(app, COOKIE_DO_TITULAR);
    expect(membros[1]).toMatchObject({ name: "[TEST] Pessoa B", devices: [] });
  });
});

describe("caminhos de segurança", () => {
  it("aparelho de outro lar: 404 aparelho_nao_encontrado e a passkey continua", async () => {
    await criaLarDeDuas();
    const outro = await criaOutroLar();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });

    const resposta = await callApi(app, "DELETE", `/api/devices/${outro.passkeyId}`, undefined, {
      cookie: COOKIE_DO_TITULAR,
    });
    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toMatchObject({ error: "aparelho_nao_encontrado" });
    expect(await contagem("SELECT COUNT(*) AS n FROM passkeys WHERE id = ?", outro.passkeyId)).toBe(1);
    expect(await contagem("SELECT COUNT(*) AS n FROM sessions WHERE passkey_id = ?", outro.passkeyId)).toBe(
      1,
    );
  });

  it("remover o mesmo aparelho ao mesmo tempo: uma remoção (200) e a outra 404, sem erro", async () => {
    await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });

    const [primeira, segunda] = await Promise.all([
      callApi(app, "DELETE", `/api/devices/${PASSKEY_DO_CONJUGE}`, undefined, { cookie: COOKIE_DO_TITULAR }),
      callApi(app, "DELETE", `/api/devices/${PASSKEY_DO_CONJUGE}`, undefined, { cookie: COOKIE_DO_TITULAR }),
    ]);
    expect([primeira.status, segunda.status].sort()).toEqual([200, 404]);
    expect(await contagem("SELECT COUNT(*) AS n FROM passkeys WHERE id = ?", PASSKEY_DO_CONJUGE)).toBe(0);
  });

  it("desafio de outra pessoa: o desafio do cônjuge não serve para o aparelho do titular (400, nada gravado)", async () => {
    await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });
    const { desafio } = await pedeOpcoesDoAparelho(app, COOKIE_DO_CONJUGE);

    const resposta = await verificaAparelho(
      app,
      desafio,
      COOKIE_DO_TITULAR,
      "cred-TEST-0106-de-outra-pessoa",
    );
    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toMatchObject({ error: "desafio_expirado" });
    expect(
      await contagem("SELECT COUNT(*) AS n FROM passkeys WHERE id = ?", "cred-TEST-0106-de-outra-pessoa"),
    ).toBe(0);
  });

  it("uso único do desafio: o mesmo desafio não serve de novo", async () => {
    await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });
    const { desafio } = await pedeOpcoesDoAparelho(app, COOKIE_DO_TITULAR);

    const primeira = await verificaAparelho(app, desafio, COOKIE_DO_TITULAR, "cred-TEST-0106-uso-unico-1");
    expect(primeira.status).toBe(201);
    const segunda = await verificaAparelho(app, desafio, COOKIE_DO_TITULAR, "cred-TEST-0106-uso-unico-2");
    expect(segunda.status).toBe(400);
    expect(await segunda.json()).toMatchObject({ error: "desafio_expirado" });
  });

  it("passkey que não confere: 400 passkey_invalida e a sessão continua como estava", async () => {
    await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro({ recusa: true }).webauthn });
    const { desafio } = await pedeOpcoesDoAparelho(app, COOKIE_DO_TITULAR);

    const resposta = await verificaAparelho(app, desafio, COOKIE_DO_TITULAR, "cred-TEST-0106-recusada");
    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toMatchObject({ error: "passkey_invalida" });
    expect(await contagem("SELECT COUNT(*) AS n FROM passkeys WHERE id = ?", "cred-TEST-0106-recusada")).toBe(
      0,
    );
    const sessao = await env.DB.prepare("SELECT passkey_id FROM sessions WHERE token_hash = ?")
      .bind(await sha256Hex(TOKEN_DO_TITULAR))
      .first<{ passkey_id: string }>();
    expect(sessao?.passkey_id).toBe(PASSKEY_DO_TITULAR);
  });
});

// Rodada 1 (avaliação final): a lista de aparelhos só mostra o lar da sessão.
describe("rodada 1: a lista só mostra o lar da sessão", () => {
  it("cada lar vê só as próprias pessoas: o titular não vê o outro lar, e o outro lar vê só a própria pessoa", async () => {
    await criaLarDeDuas();
    const outro = await criaOutroLar();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });

    const doTitular = await listaDoLar(app, COOKIE_DO_TITULAR);
    expect(doTitular.map((pessoa) => pessoa.name)).toEqual(["[TEST] Pessoa A", "[TEST] Pessoa B"]);
    const doOutro = await listaDoLar(app, `mm_sess=${outro.token}`);
    expect(doOutro.map((pessoa) => pessoa.name)).toEqual(["[TEST] Pessoa C"]);
  });
});
