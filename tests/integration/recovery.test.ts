import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { sqlCancelaRecuperacoesAbertas, sqlInsereRecuperacao } from "../../scripts/lib/sql";
import { generateLinkToken, sha256Hex } from "../../src/shared/access-code";
import { createApp } from "../../src/worker/app";
import {
  COOKIE_DO_CONJUGE,
  COOKIE_DO_TITULAR,
  criaLarDeDuas,
  criaOutroLar,
  respostaDeRegistro,
  verificadorDeRegistro,
} from "./helpers/aparelhos";
import { callApi, semearPronto } from "./helpers/app";
import { valorDoCookie } from "./helpers/sessao";

// Recuperação de acesso (TASK-0106): nível 2 (o parceiro gera o link de 15 min) e a verificação das rotas públicas.
// O nível 3 (npm run recuperar-acesso) grava o mesmo tipo de linha: o teste usa o SQL do próprio script, com o
// banco de teste, e confere que a rota aceita o link. Nenhum teste fala com a Cloudflare.

const MINUTO = 60_000;

type Lar = Awaited<ReturnType<typeof criaLarDeDuas>>;

// O titular gera o link do cônjuge. Devolve o token (o que está depois de /recuperar/), que só existe aqui.
async function geraLinkDoConjuge(app: ReturnType<typeof createApp>, lar: Lar, cookie = COOKIE_DO_TITULAR) {
  const resposta = await callApi(
    app,
    "POST",
    "/api/recovery-invites",
    { memberId: lar.conjugeId },
    { cookie },
  );
  expect(resposta.status).toBe(201);
  const corpo = (await resposta.json()) as { link: string; expiresAt: string; memberName: string };
  return {
    token: corpo.link.slice(corpo.link.indexOf("/recuperar/") + "/recuperar/".length),
    corpo,
  };
}

async function inspeciona(app: ReturnType<typeof createApp>, token: string) {
  return callApi(app, "POST", "/api/recovery/inspect", { token });
}

// Pede as opções da passkey nova para o link e devolve o cookie do desafio (de uso único).
async function pedeOpcoes(app: ReturnType<typeof createApp>, token: string): Promise<string> {
  const resposta = await callApi(app, "POST", "/api/recovery/options", { token });
  expect(resposta.status).toBe(200);
  const desafio = valorDoCookie(resposta, "mm_chal");
  expect(desafio).toBeTruthy();
  return desafio ?? "";
}

async function verifica(
  app: ReturnType<typeof createApp>,
  token: string,
  desafio: string,
  id: string,
): Promise<Response> {
  return callApi(
    app,
    "POST",
    "/api/recovery/verify",
    { token, response: respostaDeRegistro(id) },
    { cookie: `mm_chal=${desafio}` },
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

describe("cenário 7: liberar acesso pelo parceiro", () => {
  it("gera o link de 15 minutos, que cancela o anterior; o banco guarda só o hash do token", async () => {
    const lar = await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });

    const primeiro = await geraLinkDoConjuge(app, lar);
    const validade = Date.parse(primeiro.corpo.expiresAt) - Date.now();
    expect(Math.abs(validade - 15 * MINUTO)).toBeLessThan(MINUTO);

    const segundo = await geraLinkDoConjuge(app, lar);
    expect((await inspeciona(app, primeiro.token)).status).toBe(410);
    expect(await (await inspeciona(app, primeiro.token)).json()).toMatchObject({ error: "link_cancelado" });
    expect((await inspeciona(app, segundo.token)).status).toBe(200);

    // Só o hash fica no banco: o token em claro não aparece em nenhuma coluna.
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM invites WHERE token_hash = ?",
        await sha256Hex(segundo.token),
      ),
    ).toBe(1);
    expect(await contagem("SELECT COUNT(*) AS n FROM invites WHERE token_hash = ?", segundo.token)).toBe(0);
  });

  it("para mim mesmo dá 400 use_adicionar_aparelho, e nada é gerado", async () => {
    const lar = await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });
    const resposta = await callApi(
      app,
      "POST",
      "/api/recovery-invites",
      { memberId: lar.titularId },
      { cookie: COOKIE_DO_TITULAR },
    );
    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toMatchObject({ error: "use_adicionar_aparelho" });
    expect(await contagem("SELECT COUNT(*) AS n FROM invites WHERE kind = 'recuperacao'")).toBe(0);
  });

  it("pessoa de outro lar dá 404 e nada é gerado; sem sessão, 401", async () => {
    const lar = await criaLarDeDuas();
    const outro = await criaOutroLar();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });

    const deOutroLar = await callApi(
      app,
      "POST",
      "/api/recovery-invites",
      { memberId: outro.memberId },
      { cookie: COOKIE_DO_TITULAR },
    );
    expect(deOutroLar.status).toBe(404);
    expect(await deOutroLar.json()).toMatchObject({ error: "membro_nao_encontrado" });

    const semSessao = await callApi(app, "POST", "/api/recovery-invites", { memberId: lar.conjugeId });
    expect(semSessao.status).toBe(401);
    expect(await contagem("SELECT COUNT(*) AS n FROM invites WHERE kind = 'recuperacao'")).toBe(0);
  });

  it("duas gerações juntas: só um link fica aberto (cada lote cancela o anterior)", async () => {
    const lar = await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });

    const [a, b] = await Promise.all([
      callApi(
        app,
        "POST",
        "/api/recovery-invites",
        { memberId: lar.conjugeId },
        { cookie: COOKIE_DO_TITULAR },
      ),
      callApi(
        app,
        "POST",
        "/api/recovery-invites",
        { memberId: lar.conjugeId },
        { cookie: COOKIE_DO_TITULAR },
      ),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM invites WHERE kind = 'recuperacao' AND member_id = ? AND used_at IS NULL AND cancelled_at IS NULL",
        lar.conjugeId,
      ),
    ).toBe(1);
  });
});

describe("cenário 8: recuperar o acesso pelo link do parceiro", () => {
  it("o link abre com quem liberou; a passkey nova entra como 'recuperacao'; o link fica usado; a sessão nova entra", async () => {
    const lar = await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });
    const { token } = await geraLinkDoConjuge(app, lar);

    const aberto = await inspeciona(app, token);
    expect(aberto.status).toBe(200);
    expect(await aberto.json()).toMatchObject({
      memberName: "[TEST] Pessoa B",
      source: "parceiro",
      createdByName: "[TEST] Pessoa A",
    });

    const desafio = await pedeOpcoes(app, token);
    const entrou = await verifica(app, token, desafio, "cred-TEST-0106-novo-aparelho");
    expect(entrou.status).toBe(201);
    expect(await entrou.json()).toMatchObject({
      member: { id: lar.conjugeId, name: "[TEST] Pessoa B", role: "conjuge" },
    });
    const novoCookie = valorDoCookie(entrou, "mm_sess");
    expect(novoCookie).toBeTruthy();

    const passkey = await env.DB.prepare("SELECT member_id, added_via FROM passkeys WHERE id = ?")
      .bind("cred-TEST-0106-novo-aparelho")
      .first<{ member_id: string; added_via: string }>();
    expect(passkey).toEqual({ member_id: lar.conjugeId, added_via: "recuperacao" });
    expect(
      await contagem("SELECT COUNT(*) AS n FROM invites WHERE kind = 'recuperacao' AND used_at IS NOT NULL"),
    ).toBe(1);

    const sessaoNova = await callApi(app, "GET", "/api/auth/session", undefined, {
      cookie: `mm_sess=${novoCookie}`,
    });
    expect(sessaoNova.status).toBe(200);
    expect(await sessaoNova.json()).toMatchObject({ member: { id: lar.conjugeId, role: "conjuge" } });

    // Usado: o link não abre de novo.
    expect((await inspeciona(app, token)).status).toBe(410);
    expect(await (await inspeciona(app, token)).json()).toMatchObject({ error: "link_usado" });
  });
});

describe("cenário 9: aviso de aparelho novo", () => {
  it("o aparelho antigo da pessoa vê a faixa; o titular não vê; 'Foi eu' esconde; o aparelho novo não avisa a si mesmo", async () => {
    const lar = await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });
    const { token } = await geraLinkDoConjuge(app, lar);
    const desafio = await pedeOpcoes(app, token);
    const entrou = await verifica(app, token, desafio, "cred-TEST-0106-aviso-novo");
    const novoCookie = valorDoCookie(entrou, "mm_sess") ?? "";

    const antigo = await callApi(app, "GET", "/api/auth/session", undefined, { cookie: COOKIE_DO_CONJUGE });
    const avisoDoAntigo = (await antigo.json()) as { notices: { kind: string; passkeyId: string }[] };
    expect(avisoDoAntigo.notices).toEqual([
      expect.objectContaining({ kind: "aparelho_novo", passkeyId: "cred-TEST-0106-aviso-novo" }),
    ]);

    const titular = await callApi(app, "GET", "/api/auth/session", undefined, { cookie: COOKIE_DO_TITULAR });
    expect(((await titular.json()) as { notices: unknown[] }).notices).toEqual([]);

    const novo = await callApi(app, "GET", "/api/auth/session", undefined, {
      cookie: `mm_sess=${novoCookie}`,
    });
    expect(((await novo.json()) as { notices: unknown[] }).notices).toEqual([]);

    const foiEu = await callApi(app, "POST", "/api/auth/notices/seen", {}, { cookie: COOKIE_DO_CONJUGE });
    expect(foiEu.status).toBe(200);
    const depois = await callApi(app, "GET", "/api/auth/session", undefined, { cookie: COOKIE_DO_CONJUGE });
    expect(((await depois.json()) as { notices: unknown[] }).notices).toEqual([]);
  });
});

describe("cenários 10 e 11: link vencido, usado, trocado, inválido e do comando", () => {
  it("vencido: 410 link_vencido com o horário, na consulta e nas opções", async () => {
    const lar = await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });
    const { token } = await geraLinkDoConjuge(app, lar);
    await env.DB.prepare(
      "UPDATE invites SET expires_at = '2026-11-01T00:00:00.000Z' WHERE kind = 'recuperacao'",
    ).run();

    const aberto = await inspeciona(app, token);
    expect(aberto.status).toBe(410);
    expect(await aberto.json()).toMatchObject({
      error: "link_vencido",
      expiresAt: "2026-11-01T00:00:00.000Z",
    });
    const opcoes = await callApi(app, "POST", "/api/recovery/options", { token });
    expect(opcoes.status).toBe(410);
    expect(await opcoes.json()).toMatchObject({ error: "link_vencido" });
  });

  it("inválido: um token que não existe, ou o de um convite do cônjuge, dá 404 link_invalido", async () => {
    const lar = await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });
    const inexistente = await inspeciona(app, generateLinkToken());
    expect(inexistente.status).toBe(404);
    expect(await inexistente.json()).toMatchObject({ error: "link_invalido" });

    await env.DB.prepare(
      "INSERT INTO invites (id, household_id, kind, token_hash, invitee_name, created_by, created_at, expires_at) VALUES ('convite-de-teste-0106', ?, 'conjuge', ?, '[TEST] Pessoa D', ?, '2026-11-08T00:00:00.000Z', '2099-01-01T00:00:00.000Z')",
    )
      .bind(lar.householdId, await sha256Hex("token-de-convite-0106-teste"), lar.titularId)
      .run();
    const deConvite = await inspeciona(app, "token-de-convite-0106-teste");
    expect(deConvite.status).toBe(404);
    expect(await deConvite.json()).toMatchObject({ error: "link_invalido" });
  });

  it("trocado: 410 link_cancelado para o link antigo, depois que o titular gerou outro", async () => {
    const lar = await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });
    const antigo = await geraLinkDoConjuge(app, lar);
    await geraLinkDoConjuge(app, lar);
    expect(await (await inspeciona(app, antigo.token)).json()).toMatchObject({ error: "link_cancelado" });
  });

  it("comando (nível 3): o SQL do npm run recuperar-acesso gera um link que a rota aceita, como 'comando'", async () => {
    const lar = await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });
    const token = generateLinkToken();
    const agora = new Date();
    const sql = sqlInsereRecuperacao({
      id: crypto.randomUUID(),
      householdId: lar.householdId,
      hash: await sha256Hex(token),
      memberId: lar.conjugeId,
      criadoEm: agora.toISOString(),
      expiraEm: new Date(agora.getTime() + 60 * MINUTO).toISOString(),
    });
    await env.DB.prepare(sql).run();

    const aberto = await inspeciona(app, token);
    expect(aberto.status).toBe(200);
    expect(await aberto.json()).toMatchObject({
      memberName: "[TEST] Pessoa B",
      source: "comando",
      createdByName: null,
    });

    // O mesmo SQL do comando cancela os links de recuperação abertos desse membro.
    const parceiro = await geraLinkDoConjuge(app, lar);
    await env.DB.prepare(sqlCancelaRecuperacoesAbertas(lar.conjugeId, new Date().toISOString())).run();
    expect(await (await inspeciona(app, parceiro.token)).json()).toMatchObject({ error: "link_cancelado" });
  });
});

describe("caminhos de segurança da recuperação", () => {
  it("duas abas no mesmo link: uma passkey só; a outra recebe 410 link_usado, e a data de uso não muda", async () => {
    const lar = await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });
    const { token } = await geraLinkDoConjuge(app, lar);
    const desafioA = await pedeOpcoes(app, token);
    const desafioB = await pedeOpcoes(app, token);

    const [primeira, segunda] = await Promise.all([
      verifica(app, token, desafioA, "cred-TEST-0106-aba-1"),
      verifica(app, token, desafioB, "cred-TEST-0106-aba-2"),
    ]);
    expect([primeira.status, segunda.status].sort()).toEqual([201, 410]);
    const perdedora = primeira.status === 410 ? primeira : segunda;
    expect(await perdedora.json()).toMatchObject({ error: "link_usado" });

    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM passkeys WHERE added_via = 'recuperacao' AND member_id = ?",
        lar.conjugeId,
      ),
    ).toBe(1);
    // A data de uso é a da passkey que entrou (as duas saem do mesmo lote): a aba que perdeu não a reescreve.
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM invites i JOIN passkeys p ON p.added_via = 'recuperacao' WHERE i.kind = 'recuperacao' AND i.used_at = p.created_at",
      ),
    ).toBe(1);
    // Uma sessão nova, ligada à passkey de recuperação (a do aparelho antigo já existia antes).
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM sessions s JOIN passkeys p ON p.id = s.passkey_id WHERE p.added_via = 'recuperacao'",
      ),
    ).toBe(1);

    // Uma terceira tentativa, com um desafio que já foi usado, não grava nada.
    const terceira = await verifica(app, token, desafioA, "cred-TEST-0106-aba-3");
    expect(terceira.status).toBe(400);
    expect(await terceira.json()).toMatchObject({ error: "desafio_expirado" });
    expect(await contagem("SELECT COUNT(*) AS n FROM passkeys WHERE id = ?", "cred-TEST-0106-aba-3")).toBe(0);
  });

  it("desafio de outra pessoa: o desafio gerado para outro membro não serve para o link do cônjuge (400, nada gravado)", async () => {
    const lar = await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });
    const { token } = await geraLinkDoConjuge(app, lar);

    // Um link de recuperação do titular (gerado pelo comando), para ter um desafio de outra pessoa.
    const tokenDoTitular = generateLinkToken();
    const agora = new Date();
    await env.DB.prepare(
      sqlInsereRecuperacao({
        id: crypto.randomUUID(),
        householdId: lar.householdId,
        hash: await sha256Hex(tokenDoTitular),
        memberId: lar.titularId,
        criadoEm: agora.toISOString(),
        expiraEm: new Date(agora.getTime() + 60 * MINUTO).toISOString(),
      }),
    ).run();
    const desafioDoTitular = await pedeOpcoes(app, tokenDoTitular);

    const resposta = await verifica(app, token, desafioDoTitular, "cred-TEST-0106-de-outra-pessoa");
    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toMatchObject({ error: "desafio_expirado" });
    expect(
      await contagem("SELECT COUNT(*) AS n FROM passkeys WHERE id = ?", "cred-TEST-0106-de-outra-pessoa"),
    ).toBe(0);
    expect(await (await inspeciona(app, token)).status).toBe(200);
  });

  it("cerimônia cancelada ou recusada: a passkey não confere, o link continua valendo e a próxima tentativa entra", async () => {
    const lar = await criaLarDeDuas();
    const recusado = createApp({ webauthn: verificadorDeRegistro({ recusa: true }).webauthn });
    const { token } = await geraLinkDoConjuge(recusado, lar);
    const desafio = await pedeOpcoes(recusado, token);

    const falhou = await verifica(recusado, token, desafio, "cred-TEST-0106-recusada");
    expect(falhou.status).toBe(400);
    expect(await falhou.json()).toMatchObject({ error: "passkey_invalida" });
    expect((await inspeciona(recusado, token)).status).toBe(200);

    const aceita = createApp({ webauthn: verificadorDeRegistro().webauthn });
    const desafioNovo = await pedeOpcoes(aceita, token);
    const entrou = await verifica(aceita, token, desafioNovo, "cred-TEST-0106-depois-da-recusa");
    expect(entrou.status).toBe(201);
  });

  it("vencido durante a verificação: o link vence enquanto a passkey é conferida; o lote não grava nada e a resposta é link_vencido", async () => {
    const lar = await criaLarDeDuas();
    // O link vence depois da checagem de entrada e antes do lote (a janela da verificação).
    const app = createApp({
      webauthn: verificadorDeRegistro({
        aoVerificar: async () => {
          await env.DB.prepare(
            "UPDATE invites SET expires_at = '2026-11-01T00:00:00.000Z' WHERE kind = 'recuperacao'",
          ).run();
        },
      }).webauthn,
    });
    const { token } = await geraLinkDoConjuge(app, lar);
    const desafio = await pedeOpcoes(app, token);

    const resposta = await verifica(app, token, desafio, "cred-TEST-0106-tarde-demais");
    expect(resposta.status).toBe(410);
    expect(await resposta.json()).toMatchObject({ error: "link_vencido" });
    expect(
      await contagem("SELECT COUNT(*) AS n FROM passkeys WHERE id = ?", "cred-TEST-0106-tarde-demais"),
    ).toBe(0);
  });

  it("cancelado durante a verificação: o titular troca o link no meio; o lote não grava nada e a resposta é link_cancelado", async () => {
    const lar = await criaLarDeDuas();
    // O titular gera outro link enquanto a passkey é conferida: o link desta tela é cancelado no meio.
    const app = createApp({
      webauthn: verificadorDeRegistro({
        aoVerificar: async () => {
          await env.DB.prepare(
            "UPDATE invites SET cancelled_at = '2026-11-08T12:00:00.000Z' WHERE kind = 'recuperacao' AND cancelled_at IS NULL",
          ).run();
        },
      }).webauthn,
    });
    const { token } = await geraLinkDoConjuge(app, lar);
    const desafio = await pedeOpcoes(app, token);

    const resposta = await verifica(app, token, desafio, "cred-TEST-0106-trocado");
    expect(resposta.status).toBe(410);
    expect(await resposta.json()).toMatchObject({ error: "link_cancelado" });
    expect(await contagem("SELECT COUNT(*) AS n FROM passkeys WHERE id = ?", "cred-TEST-0106-trocado")).toBe(
      0,
    );
  });

  it("com sessão neste navegador: 409 ja_conectado nas opções e na verificação", async () => {
    const lar = await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });
    const { token } = await geraLinkDoConjuge(app, lar);

    const opcoes = await callApi(
      app,
      "POST",
      "/api/recovery/options",
      { token },
      { cookie: COOKIE_DO_CONJUGE },
    );
    expect(opcoes.status).toBe(409);
    expect(await opcoes.json()).toMatchObject({ error: "ja_conectado" });
  });

  it("a passkey nova fica com a pessoa do link: o titular não ganha aparelho nem perde o que tinha", async () => {
    const lar = await criaLarDeDuas();
    const app = createApp({ webauthn: verificadorDeRegistro().webauthn });
    const { token } = await geraLinkDoConjuge(app, lar);
    const desafio = await pedeOpcoes(app, token);
    const entrou = await verifica(app, token, desafio, "cred-TEST-0106-do-conjuge");
    expect(entrou.status).toBe(201);

    expect(await contagem("SELECT COUNT(*) AS n FROM passkeys WHERE member_id = ?", lar.titularId)).toBe(1);
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM passkeys WHERE id = ? AND member_id = ? AND added_via = 'recuperacao'",
        "cred-TEST-0106-do-conjuge",
        lar.conjugeId,
      ),
    ).toBe(1);
  });
});
