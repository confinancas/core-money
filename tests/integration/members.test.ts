import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { MembersResponse } from "../../src/shared/members";
import { createApp } from "../../src/worker/app";
import type { Meter } from "../../src/worker/db/metered-d1";
import {
  COOKIE_DO_CONJUGE,
  COOKIE_DO_TITULAR,
  criaLarDeDuas,
  criaOutroLar,
  TOKEN_DO_TITULAR,
} from "./helpers/aparelhos";
import { aquecerOPortao, callApi, semearPronto } from "./helpers/app";
import { COOKIE_DE_SESSAO_DE_TESTE, semearLar, semearSessao } from "./helpers/sessao";

// Pessoas do lar para Configurações (TASK-0107, GET /api/members): cenários 10 e 11 e o isolamento por lar.
// A sessão vem do cookie (requireSession), e o lar é o da sessão: nenhuma pessoa de outro lar aparece.

beforeEach(async () => {
  await semearPronto(env.DB);
});

const listaDoLar = async (app: ReturnType<typeof createApp>, cookie: string): Promise<MembersResponse> => {
  const resposta = await callApi(app, "GET", "/api/members", undefined, { cookie });
  expect(resposta.status).toBe(200);
  return (await resposta.json()) as MembersResponse;
};

// Um convite de cônjuge direto no D1 de teste, com a situação que o teste pede (o token nunca é guardado).
async function insereConvite(
  householdId: string,
  criadoPor: string,
  opcoes: {
    id?: string;
    nome?: string | null;
    email?: string | null;
    expiraEm?: string;
    usadoEm?: string | null;
    canceladoEm?: string | null;
    criadoEm?: string;
  } = {},
): Promise<string> {
  const id = opcoes.id ?? crypto.randomUUID();
  const expira = opcoes.expiraEm ?? new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO invites (id, household_id, kind, token_hash, member_id, invitee_name, invitee_email, created_by, created_at, expires_at, used_at, cancelled_at) VALUES (?, ?, 'conjuge', ?, NULL, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      householdId,
      `hash-de-teste-${id}`,
      opcoes.nome === undefined ? "[TEST] Pessoa B" : opcoes.nome,
      opcoes.email === undefined ? "pessoa.b@example.com" : opcoes.email,
      criadoPor,
      opcoes.criadoEm ?? new Date().toISOString(),
      expira,
      opcoes.usadoEm ?? null,
      opcoes.canceladoEm ?? null,
    )
    .run();
  return id;
}

describe("GET /api/members: a lista do lar", () => {
  it("lar de duas pessoas: titular primeiro, cada uma com os aparelhos, e isMe só em quem pede", async () => {
    const { titularId, conjugeId } = await criaLarDeDuas();
    const app = createApp();

    const corpo = await listaDoLar(app, COOKIE_DO_TITULAR);

    expect(corpo).toEqual({
      members: [
        {
          id: titularId,
          name: "[TEST] Pessoa A",
          email: "pessoa.a@example.com",
          role: "titular",
          isMe: true,
          devicesCount: 1,
        },
        {
          id: conjugeId,
          name: "[TEST] Pessoa B",
          email: "pessoa.b@example.com",
          role: "conjuge",
          isMe: false,
          devicesCount: 1,
        },
      ],
      pendingInvite: null,
    });
  });

  it("vista pelo cônjuge: isMe passa para ele", async () => {
    const { titularId, conjugeId } = await criaLarDeDuas();
    const app = createApp();

    const corpo = await listaDoLar(app, COOKIE_DO_CONJUGE);

    expect(corpo.members.map((pessoa) => [pessoa.id, pessoa.isMe])).toEqual([
      [titularId, false],
      [conjugeId, true],
    ]);
  });

  it("devicesCount conta as passkeys de cada pessoa", async () => {
    const { titularId } = await criaLarDeDuas();
    await env.DB.prepare(
      "INSERT INTO passkeys (id, member_id, public_key, counter, transports, device_name, added_via, created_at, last_used_at) VALUES ('cred-TEST-0107-segundo', ?, 'PUBLICA-TEST-0107', 0, NULL, 'Celular de teste', 'aparelho', ?, NULL)",
    )
      .bind(titularId, new Date().toISOString())
      .run();
    const app = createApp();

    const corpo = await listaDoLar(app, COOKIE_DO_TITULAR);

    expect(corpo.members.map((pessoa) => pessoa.devicesCount)).toEqual([2, 1]);
  });

  it("a resposta não traz o token da sessão, o hash nem a chave pública", async () => {
    await criaLarDeDuas();
    const app = createApp();

    const texto = JSON.stringify(await listaDoLar(app, COOKIE_DO_TITULAR));

    expect(texto).not.toContain(TOKEN_DO_TITULAR);
    expect(texto).not.toContain("PUBLICA-TEST");
    expect(texto).not.toContain("token_hash");
  });

  it("lar de uma pessoa, sem convite: uma pessoa e pendingInvite nulo", async () => {
    const lar = await semearLar(env.DB, { nome: "[TEST] Pessoa A", email: "pessoa.a@example.com" });
    await semearSessao(env.DB, { memberId: lar.memberId, passkeyId: lar.passkeyId });
    const app = createApp();

    const corpo = await listaDoLar(app, COOKIE_DE_SESSAO_DE_TESTE);

    expect(corpo.members).toHaveLength(1);
    expect(corpo.pendingInvite).toBeNull();
  });

  it("outro lar: a sessão de outro lar só vê as próprias pessoas", async () => {
    await criaLarDeDuas();
    const outro = await criaOutroLar();
    const app = createApp();

    const corpo = await listaDoLar(app, `mm_sess=${outro.token}`);

    expect(corpo.members.map((pessoa) => pessoa.name)).toEqual(["[TEST] Pessoa C"]);
    expect(corpo.members[0]?.isMe).toBe(true);
  });
});

describe("pendingInvite: só o convite aguardando", () => {
  it("convite aguardando: id, nome, e-mail e vencimento; a pessoa ainda não entrou", async () => {
    const lar = await semearLar(env.DB, { nome: "[TEST] Pessoa A", email: "pessoa.a@example.com" });
    await semearSessao(env.DB, { memberId: lar.memberId, passkeyId: lar.passkeyId });
    const expira = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();
    const conviteId = await insereConvite(lar.householdId, lar.memberId, { expiraEm: expira });
    const app = createApp();

    const corpo = await listaDoLar(app, COOKIE_DE_SESSAO_DE_TESTE);

    expect(corpo.pendingInvite).toEqual({
      id: conviteId,
      name: "[TEST] Pessoa B",
      email: "pessoa.b@example.com",
      expiresAt: expira,
    });
    expect(corpo.members.map((pessoa) => pessoa.role)).toEqual(["titular"]);
  });

  it("convite usado, cancelado ou vencido não aparece", async () => {
    const lar = await semearLar(env.DB, { nome: "[TEST] Pessoa A", email: "pessoa.a@example.com" });
    await semearSessao(env.DB, { memberId: lar.memberId, passkeyId: lar.passkeyId });
    const agora = Date.now();
    const umDia = 24 * 60 * 60 * 1000;
    await insereConvite(lar.householdId, lar.memberId, { usadoEm: new Date(agora).toISOString() });
    await insereConvite(lar.householdId, lar.memberId, { canceladoEm: new Date(agora).toISOString() });
    await insereConvite(lar.householdId, lar.memberId, { expiraEm: new Date(agora - umDia).toISOString() });
    const app = createApp();

    const corpo = await listaDoLar(app, COOKIE_DE_SESSAO_DE_TESTE);

    expect(corpo.pendingInvite).toBeNull();
  });

  it("convite aguardando de outro lar não aparece no lar da sessão", async () => {
    const lar = await semearLar(env.DB, { nome: "[TEST] Pessoa A", email: "pessoa.a@example.com" });
    await semearSessao(env.DB, { memberId: lar.memberId, passkeyId: lar.passkeyId });
    const outro = await criaOutroLar();
    const linhaDoOutro = await env.DB.prepare("SELECT household_id AS id FROM members WHERE id = ?")
      .bind(outro.memberId)
      .first<{ id: string }>();
    await insereConvite(linhaDoOutro?.id ?? "", outro.memberId);
    const app = createApp();

    const corpo = await listaDoLar(app, COOKIE_DE_SESSAO_DE_TESTE);

    expect(corpo.pendingInvite).toBeNull();
  });

  it("link de recuperação aguardando, do mesmo lar, não aparece como convite de cônjuge", async () => {
    const lar = await semearLar(env.DB, { nome: "[TEST] Pessoa A", email: "pessoa.a@example.com" });
    await semearSessao(env.DB, { memberId: lar.memberId, passkeyId: lar.passkeyId });
    // Um link de recuperação ainda aberto, para a própria pessoa do lar: o tipo é 'recuperacao', não 'conjuge'.
    await env.DB.prepare(
      "INSERT INTO invites (id, household_id, kind, token_hash, member_id, invitee_name, invitee_email, created_by, created_at, expires_at, used_at, cancelled_at) VALUES (?, ?, 'recuperacao', ?, ?, NULL, NULL, NULL, ?, ?, NULL, NULL)",
    )
      .bind(
        crypto.randomUUID(),
        lar.householdId,
        `hash-de-teste-recuperacao-${crypto.randomUUID()}`,
        lar.memberId,
        new Date().toISOString(),
        new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      )
      .run();
    const app = createApp();

    const corpo = await listaDoLar(app, COOKIE_DE_SESSAO_DE_TESTE);

    expect(corpo.pendingInvite).toBeNull();
  });

  it("no instante do vencimento o convite sai da lista; um milissegundo antes, ainda aparece", async () => {
    const lar = await semearLar(env.DB, { nome: "[TEST] Pessoa A", email: "pessoa.a@example.com" });
    await semearSessao(env.DB, { memberId: lar.memberId, passkeyId: lar.passkeyId });
    const expira = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const conviteId = await insereConvite(lar.householdId, lar.memberId, { expiraEm: expira });

    // "agora" é o próprio vencimento: o convite já não está aguardando (a regra é expires_at > agora).
    const noInstante = createApp({ agora: () => new Date(expira) });
    expect((await listaDoLar(noInstante, COOKIE_DE_SESSAO_DE_TESTE)).pendingInvite).toBeNull();

    // Um milissegundo antes do vencimento, o mesmo convite ainda aparece.
    const umMilissegundoAntes = createApp({ agora: () => new Date(Date.parse(expira) - 1) });
    const corpo = await listaDoLar(umMilissegundoAntes, COOKIE_DE_SESSAO_DE_TESTE);
    expect(corpo.pendingInvite?.id).toBe(conviteId);
    expect(corpo.pendingInvite?.expiresAt).toBe(expira);
  });

  it("com o cônjuge já no lar, nenhum convite aguardando aparece", async () => {
    const { householdId, titularId } = await criaLarDeDuas();
    await insereConvite(householdId, titularId);
    const app = createApp();

    const corpo = await listaDoLar(app, COOKIE_DO_TITULAR);

    expect(corpo.pendingInvite).toBeNull();
    expect(corpo.members).toHaveLength(2);
  });
});

describe("autenticação do lar", () => {
  it("cenário 10: sem sessão, 401 nao_autenticado e nenhuma leitura do D1", async () => {
    const medidas: Meter[] = [];
    const app = createApp({ onMeter: (meter) => medidas.push({ ...meter }) });
    await aquecerOPortao(app);
    medidas.length = 0;

    const resposta = await callApi(app, "GET", "/api/members");

    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual({
      error: "nao_autenticado",
      message: "Entre de novo para continuar.",
    });
    expect(medidas.map((m) => m.calls)).toEqual([0]);
  });

  it("com um cookie que não é de sessão, também 401", async () => {
    await criaLarDeDuas();
    const app = createApp();

    const resposta = await callApi(app, "GET", "/api/members", undefined, {
      cookie: "mm_sess=token-que-nao-existe",
    });

    expect(resposta.status).toBe(401);
  });
});
