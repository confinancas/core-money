import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../src/shared/access-code";
import { createApp } from "../../src/worker/app";
import type { WebAuthnLoginVerifier, WebAuthnVerifier } from "../../src/worker/auth/webauthn";
import { callApi, semearPronto } from "./helpers/app";
import { contaSql, semearLar, semearSessao, valorDoCookie } from "./helpers/sessao";

// Convites de cônjuge (TASK-0105), com D1 local e createApp(). O registro da passkey usa um verificador falso (a
// criptografia real já é provada na TASK-0103); a sessão e o desafio são os de verdade (linhas no banco e cookies).
// Cada teste de segurança é ligado a uma mutação em MUTACOES (ver Evidências).

const CONVIDADA = { nome: "[TEST] Pessoa B", email: "pessoa.b@example.com" };

type Lar = { householdId: string; memberId: string; cookie: string; passkeyId: string };

// Um lar [TEST] com o titular e a sessão dele. Cada lar tem a própria passkey e o próprio token de sessão.
async function criaLar(indice: number): Promise<Lar> {
  const passkeyId = `cred-TEST-0105-titular-${indice}`;
  const token = `TESTE-SESSAO-0105-lar-${indice}-token-de-teste-0000000`;
  const lar = await semearLar(env.DB, {
    nome: `[TEST] Pessoa A${indice}`,
    email: `pessoa.a${indice}@example.com`,
    passkeyId,
  });
  await semearSessao(env.DB, { memberId: lar.memberId, passkeyId, token });
  return { householdId: lar.householdId, memberId: lar.memberId, cookie: `mm_sess=${token}`, passkeyId };
}

// Verificador de registro falso: aceita a passkey com o id dado (ou recusa, com null). aoVerificar roda antes da
// resposta, para simular o que acontece no meio da verificação (o convite vence, é cancelado ou o lar ganha cônjuge).
function verificadorFalso(
  id: string | null,
  aoVerificar?: () => Promise<void>,
): {
  webauthn: WebAuthnVerifier & Partial<WebAuthnLoginVerifier>;
  verifyRegistration: ReturnType<typeof vi.fn>;
} {
  const verifyRegistration = vi.fn(async () => {
    if (aoVerificar) await aoVerificar();
    if (id === null) return null;
    return { id, publicKey: `PUBLICA-${id}`, counter: 0, transports: null };
  });
  return {
    webauthn: { verifyRegistration: verifyRegistration as WebAuthnVerifier["verifyRegistration"] },
    verifyRegistration,
  };
}

const RESPOSTA_DE_REGISTRO = (id: string) =>
  ({
    id,
    rawId: id,
    type: "public-key",
    response: { clientDataJSON: "TEST", attestationObject: "TEST" },
  }) as unknown;

const comCookie = (cookie: string, extra: Record<string, string> = {}) => ({ cookie, ...extra });

async function criaConvite(
  app: ReturnType<typeof createApp>,
  lar: Lar,
  nome = CONVIDADA.nome,
  email: string | null = CONVIDADA.email,
) {
  return callApi(app, "POST", "/api/invites/conjuge", { name: nome, email }, comCookie(lar.cookie));
}

function tokenDoLink(link: string): string {
  return link.slice(link.indexOf("/convite/") + "/convite/".length);
}

// Pede as opções de aceite e devolve o cookie do desafio (mm_chal), de uso único.
async function pedeOpcoesDeAceite(
  app: ReturnType<typeof createApp>,
  token: string,
  nome = CONVIDADA.nome,
  cookie = "",
) {
  const resposta = await callApi(
    app,
    "POST",
    "/api/invites/accept/options",
    { token, name: nome },
    cookie ? { cookie } : {},
  );
  expect(resposta.status).toBe(200);
  const desafio = valorDoCookie(resposta, "mm_chal");
  expect(desafio).toBeTruthy();
  return desafio ?? "";
}

async function verificaAceite(
  app: ReturnType<typeof createApp>,
  desafio: string,
  token: string,
  id: string,
  nome = CONVIDADA.nome,
): Promise<Response> {
  return callApi(
    app,
    "POST",
    "/api/invites/accept/verify",
    { token, name: nome, response: RESPOSTA_DE_REGISTRO(id) },
    { cookie: `mm_chal=${desafio}` },
  );
}

// Cria o convite pelo titular, aceita pela pessoa convidada e devolve o token e as respostas.
async function convidaEAceita(
  app: ReturnType<typeof createApp>,
  lar: Lar,
  id = "cred-TEST-0105-convidada-1",
) {
  const criado = await criaConvite(app, lar);
  const { link } = (await criado.json()) as { link: string };
  const token = tokenDoLink(link);
  const desafio = await pedeOpcoesDeAceite(app, token);
  const aceito = await verificaAceite(app, desafio, token, id);
  return { token, link, aceito };
}

const contagem = (sql: string, ...valores: unknown[]) => contaSql(sql, ...valores);

beforeEach(async () => {
  await semearPronto(env.DB);
});

describe("cenário 1: criar o convite", () => {
  it("devolve o link uma vez; o banco guarda só o hash; a lista mostra o convite aguardando por 7 dias", async () => {
    const lar = await criaLar(1);
    const app = createApp({ webauthn: verificadorFalso(null).webauthn });

    const resposta = await criaConvite(app, lar);
    expect(resposta.status).toBe(201);
    const corpo = (await resposta.json()) as {
      invite: {
        id: string;
        kind: string;
        name: string;
        email: string;
        expiresAt: string;
        createdByName: string;
      };
      link: string;
    };
    expect(corpo.invite).toMatchObject({
      kind: "conjuge",
      name: CONVIDADA.nome,
      email: CONVIDADA.email,
      createdByName: "[TEST] Pessoa A1",
    });
    const token = tokenDoLink(corpo.link);
    expect(corpo.link).toMatch(/^http:\/\/matrimoney\.test\/convite\/[A-Za-z0-9_-]{43}$/);

    // O banco guarda só o sha256 do token.
    const linhas = await env.DB.prepare("SELECT token_hash FROM invites WHERE kind = 'conjuge'").all<{
      token_hash: string;
    }>();
    expect(linhas.results.map((linha) => linha.token_hash)).toEqual([await sha256Hex(token)]);
    expect(await contagem("SELECT COUNT(*) AS n FROM invites WHERE token_hash = ?", token)).toBe(0);

    // Vence em 7 dias (com uma folga de um minuto).
    const setedias = Date.now() + 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(Date.parse(corpo.invite.expiresAt) - setedias)).toBeLessThan(60_000);

    // A lista mostra o convite, sem o link nem o token.
    const lista = await callApi(app, "GET", "/api/invites", undefined, comCookie(lar.cookie));
    expect(lista.status).toBe(200);
    const texto = await lista.text();
    expect(texto).not.toContain("/convite/");
    expect(texto).not.toContain(token);
    const { invites } = JSON.parse(texto) as { invites: { id: string; name: string }[] };
    expect(invites).toHaveLength(1);
    expect(invites[0]?.name).toBe(CONVIDADA.nome);
  });
});

describe("cenário 3: aceitar o convite", () => {
  it("a pessoa confirma o nome e cria a passkey: nasce o cônjuge com o e-mail do convite, a passkey 'convite' e a sessão; o convite fica usado", async () => {
    const lar = await criaLar(3);
    const { webauthn, verifyRegistration } = verificadorFalso("cred-TEST-0105-convidada-3");
    const app = createApp({ webauthn });

    const criado = await criaConvite(app, lar);
    const { link } = (await criado.json()) as { link: string };
    const token = tokenDoLink(link);

    const inspecao = await callApi(app, "POST", "/api/invites/inspect", { token });
    expect(inspecao.status).toBe(200);
    expect(await inspecao.json()).toMatchObject({
      kind: "conjuge",
      invitedBy: "[TEST] Pessoa A3",
      name: CONVIDADA.nome,
      email: CONVIDADA.email,
    });

    const desafio = await pedeOpcoesDeAceite(app, token, "[TEST] Pessoa B (nome no app)");
    const aceito = await verificaAceite(
      app,
      desafio,
      token,
      "cred-TEST-0105-convidada-3",
      "[TEST] Pessoa B (nome no app)",
    );
    expect(aceito.status).toBe(201);
    const corpo = (await aceito.json()) as {
      member: { id: string; name: string; email: string; role: string };
      household: { id: string };
    };
    expect(corpo.member).toMatchObject({
      name: "[TEST] Pessoa B (nome no app)",
      email: CONVIDADA.email,
      role: "conjuge",
    });
    expect(corpo.household.id).toBe(lar.householdId);
    expect(valorDoCookie(aceito, "mm_sess")).toBeTruthy();
    expect(verifyRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ expectedChallenge: expect.any(String) }),
    );

    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM members WHERE household_id = ? AND role = 'conjuge' AND email = ?",
        lar.householdId,
        CONVIDADA.email,
      ),
    ).toBe(1);
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM passkeys WHERE member_id = ? AND added_via = 'convite'",
        corpo.member.id,
      ),
    ).toBe(1);
    expect(await contagem("SELECT COUNT(*) AS n FROM sessions WHERE member_id = ?", corpo.member.id)).toBe(1);
    expect(
      await contagem("SELECT COUNT(*) AS n FROM invites WHERE kind = 'conjuge' AND used_at IS NOT NULL"),
    ).toBe(1);

    // A sessão do titular passa a listar dois membros.
    const sessaoDoTitular = await callApi(app, "GET", "/api/auth/session", undefined, comCookie(lar.cookie));
    const { members } = (await sessaoDoTitular.json()) as { members: { role: string }[] };
    expect(members.map((pessoa) => pessoa.role).sort()).toEqual(["conjuge", "titular"]);
  });
});

describe("cenário 4: vencido, usado, cancelado e inválido", () => {
  it("vencido: 410 com quem convidou e o vencimento, no inspect e no aceite", async () => {
    const lar = await criaLar(4);
    const app = createApp({ webauthn: verificadorFalso(null).webauthn });
    const { link } = (await (await criaConvite(app, lar)).json()) as { link: string };
    const token = tokenDoLink(link);
    await env.DB.prepare(
      "UPDATE invites SET expires_at = '2026-11-01T00:00:00.000Z' WHERE kind = 'conjuge'",
    ).run();

    const inspecao = await callApi(app, "POST", "/api/invites/inspect", { token });
    expect(inspecao.status).toBe(410);
    expect(await inspecao.json()).toMatchObject({
      error: "convite_vencido",
      invitedBy: "[TEST] Pessoa A4",
      expiresAt: "2026-11-01T00:00:00.000Z",
    });
    const aceite = await callApi(app, "POST", "/api/invites/accept/options", { token, name: CONVIDADA.nome });
    expect(aceite.status).toBe(410);
    expect((await aceite.json()) as { error: string }).toMatchObject({ error: "convite_vencido" });
  });

  it("usado: 410 convite_usado depois de aceito", async () => {
    const lar = await criaLar(5);
    const { webauthn } = verificadorFalso("cred-TEST-0105-usado-5");
    const app = createApp({ webauthn });
    const { token } = await convidaEAceita(app, lar, "cred-TEST-0105-usado-5");

    const inspecao = await callApi(app, "POST", "/api/invites/inspect", { token });
    expect(inspecao.status).toBe(410);
    expect((await inspecao.json()) as { error: string }).toMatchObject({ error: "convite_usado" });
  });

  it("cancelado: 410 convite_cancelado", async () => {
    const lar = await criaLar(6);
    const app = createApp({ webauthn: verificadorFalso(null).webauthn });
    const { link } = (await (await criaConvite(app, lar)).json()) as { link: string };
    const criado = await callApi(app, "GET", "/api/invites", undefined, comCookie(lar.cookie));
    const { invites } = (await criado.json()) as { invites: { id: string }[] };
    const cancelado = await callApi(
      app,
      "DELETE",
      `/api/invites/${invites[0]?.id}`,
      undefined,
      comCookie(lar.cookie),
    );
    expect(cancelado.status).toBe(200);

    const inspecao = await callApi(app, "POST", "/api/invites/inspect", { token: tokenDoLink(link) });
    expect(inspecao.status).toBe(410);
    expect((await inspecao.json()) as { error: string }).toMatchObject({ error: "convite_cancelado" });
  });

  it("inválido: token que não existe, ou de outro tipo de convite, dá 404 convite_invalido", async () => {
    const lar = await criaLar(7);
    const app = createApp({ webauthn: verificadorFalso(null).webauthn });
    await criaConvite(app, lar);

    const inexistente = await callApi(app, "POST", "/api/invites/inspect", {
      token: "token-que-nao-existe-0000000000",
    });
    expect(inexistente.status).toBe(404);
    expect((await inexistente.json()) as { error: string }).toMatchObject({ error: "convite_invalido" });

    // Um convite de recuperação com o mesmo formato de token não é um convite de cônjuge.
    await env.DB.prepare(
      "INSERT INTO invites (id, household_id, kind, token_hash, member_id, created_at, expires_at) VALUES (?, ?, 'recuperacao', ?, ?, '2026-11-08T00:00:00.000Z', '2026-11-20T00:00:00.000Z')",
    )
      .bind(
        "convite-recuperacao-0105",
        lar.householdId,
        await sha256Hex("TOKEN-DE-RECUPERACAO-TEST-0105"),
        lar.memberId,
      )
      .run();
    const outroTipo = await callApi(app, "POST", "/api/invites/inspect", {
      token: "TOKEN-DE-RECUPERACAO-TEST-0105",
    });
    expect(outroTipo.status).toBe(404);
    expect((await outroTipo.json()) as { error: string }).toMatchObject({ error: "convite_invalido" });
  });
});

describe("cenário 5 e 13: um convite aberto por vez", () => {
  it("cenário 5: criar outro com um aberto dá 409 convite_ativo", async () => {
    const lar = await criaLar(8);
    const app = createApp({ webauthn: verificadorFalso(null).webauthn });
    expect((await criaConvite(app, lar)).status).toBe(201);
    const segundo = await criaConvite(app, lar, "[TEST] Outra pessoa", null);
    expect(segundo.status).toBe(409);
    expect((await segundo.json()) as { error: string }).toMatchObject({ error: "convite_ativo" });
    expect(await contagem("SELECT COUNT(*) AS n FROM invites WHERE kind = 'conjuge'")).toBe(1);
  });

  it("cenário 13: dois pedidos juntos criam um convite só", async () => {
    const lar = await criaLar(9);
    const app = createApp({ webauthn: verificadorFalso(null).webauthn });
    const [a, b] = await Promise.all([criaConvite(app, lar), criaConvite(app, lar)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await contagem("SELECT COUNT(*) AS n FROM invites WHERE kind = 'conjuge'")).toBe(1);
  });
});

describe("cenário 6: já há cônjuge", () => {
  it("depois do aceite, criar outro convite dá 409 conjuge_ja_existe", async () => {
    const lar = await criaLar(10);
    const app = createApp({ webauthn: verificadorFalso("cred-TEST-0105-seis-10").webauthn });
    await convidaEAceita(app, lar, "cred-TEST-0105-seis-10");

    const outro = await criaConvite(app, lar, "[TEST] Terceira pessoa", null);
    expect(outro.status).toBe(409);
    expect((await outro.json()) as { error: string }).toMatchObject({ error: "conjuge_ja_existe" });
  });
});

describe("cenário 7 e 8: cancelar e gerar um link novo", () => {
  it("cancelar: o link deixa de funcionar; cancelar de novo dá 404", async () => {
    const lar = await criaLar(11);
    const app = createApp({ webauthn: verificadorFalso(null).webauthn });
    const { link } = (await (await criaConvite(app, lar)).json()) as { link: string };
    const { invites } = (await (
      await callApi(app, "GET", "/api/invites", undefined, comCookie(lar.cookie))
    ).json()) as { invites: { id: string }[] };
    const id = invites[0]?.id ?? "";

    expect(
      (await callApi(app, "DELETE", `/api/invites/${id}`, undefined, comCookie(lar.cookie))).status,
    ).toBe(200);
    expect((await callApi(app, "POST", "/api/invites/inspect", { token: tokenDoLink(link) })).status).toBe(
      410,
    );
    const de_novo = await callApi(app, "DELETE", `/api/invites/${id}`, undefined, comCookie(lar.cookie));
    expect(de_novo.status).toBe(404);
  });

  it("gerar novo: o antigo dá 410 convite_cancelado e o novo funciona com o mesmo nome e e-mail", async () => {
    const lar = await criaLar(12);
    const app = createApp({ webauthn: verificadorFalso("cred-TEST-0105-novo-12").webauthn });
    const { link: antigo } = (await (await criaConvite(app, lar)).json()) as { link: string };
    const { invites } = (await (
      await callApi(app, "GET", "/api/invites", undefined, comCookie(lar.cookie))
    ).json()) as { invites: { id: string }[] };

    const renovado = await callApi(
      app,
      "POST",
      `/api/invites/${invites[0]?.id}/renew`,
      {},
      comCookie(lar.cookie),
    );
    expect(renovado.status).toBe(201);
    const corpo = (await renovado.json()) as { invite: { name: string; email: string }; link: string };
    expect(corpo.invite).toMatchObject({ name: CONVIDADA.nome, email: CONVIDADA.email });
    expect(corpo.link).not.toBe(antigo);

    expect((await callApi(app, "POST", "/api/invites/inspect", { token: tokenDoLink(antigo) })).status).toBe(
      410,
    );
    const novoAberto = await callApi(app, "POST", "/api/invites/inspect", { token: tokenDoLink(corpo.link) });
    expect(novoAberto.status).toBe(200);
    expect(
      await contagem("SELECT COUNT(*) AS n FROM invites WHERE kind = 'conjuge' AND cancelled_at IS NULL"),
    ).toBe(1);
  });
});

describe("cenário 9: duas aceitações juntas", () => {
  it("só um cônjuge, uma passkey, uma sessão e o convite gasto uma vez; a outra recebe 409", async () => {
    const lar = await criaLar(13);
    // As duas verificações só seguem depois que ambas passaram das checagens (a barreira): o aceite é simultâneo de verdade.
    let chegaram = 0;
    let liberar: () => void = () => undefined;
    const pronta = new Promise<void>((resolver) => {
      liberar = resolver;
    });
    const app = createApp({
      webauthn: {
        verifyRegistration: (async (entrada: { response: { id: string } }) => {
          chegaram++;
          if (chegaram === 2) liberar();
          await pronta;
          return {
            id: entrada.response.id,
            publicKey: `PUBLICA-${entrada.response.id}`,
            counter: 0,
            transports: null,
          };
        }) as WebAuthnVerifier["verifyRegistration"],
      },
    });
    const { link } = (await (await criaConvite(app, lar)).json()) as { link: string };
    const token = tokenDoLink(link);

    const desafioA = await pedeOpcoesDeAceite(app, token, "[TEST] Pessoa B1");
    const desafioB = await pedeOpcoesDeAceite(app, token, "[TEST] Pessoa B2");
    const [a, b] = await Promise.all([
      verificaAceite(app, desafioA, token, "cred-TEST-0105-juntos-a", "[TEST] Pessoa B1"),
      verificaAceite(app, desafioB, token, "cred-TEST-0105-juntos-b", "[TEST] Pessoa B2"),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const perdedora = a.status === 409 ? a : b;
    expect(await perdedora.json()).toMatchObject({ error: "conjuge_ja_existe" });
    expect(chegaram).toBe(2);

    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM members WHERE household_id = ? AND role = 'conjuge'",
        lar.householdId,
      ),
    ).toBe(1);
    expect(await contagem("SELECT COUNT(*) AS n FROM passkeys WHERE added_via = 'convite'")).toBe(1);
    expect(await contagem("SELECT COUNT(*) AS n FROM sessions")).toBe(2);
    expect(
      await contagem("SELECT COUNT(*) AS n FROM invites WHERE kind = 'conjuge' AND used_at IS NOT NULL"),
    ).toBe(1);
  });
});

describe("cenário 10: o titular abre o próprio link", () => {
  it("com a sessão deste navegador, o aceite dá 409 ja_conectado; a consulta continua funcionando", async () => {
    const lar = await criaLar(14);
    const app = createApp({ webauthn: verificadorFalso("cred-TEST-0105-titular-14").webauthn });
    const { link } = (await (await criaConvite(app, lar)).json()) as { link: string };
    const token = tokenDoLink(link);

    const consulta = await callApi(app, "POST", "/api/invites/inspect", { token }, comCookie(lar.cookie));
    expect(consulta.status).toBe(200);
    const aceite = await callApi(
      app,
      "POST",
      "/api/invites/accept/options",
      { token, name: CONVIDADA.nome },
      comCookie(lar.cookie),
    );
    expect(aceite.status).toBe(409);
    expect((await aceite.json()) as { error: string }).toMatchObject({ error: "ja_conectado" });
    expect(await contagem("SELECT COUNT(*) AS n FROM members WHERE role = 'conjuge'")).toBe(0);
  });
});

describe("cenário 11: passkey cancelada no aceite", () => {
  it("o convite continua aguardando, e tentar de novo entra", async () => {
    const lar = await criaLar(15);
    const falso = verificadorFalso(null);
    const app = createApp({ webauthn: falso.webauthn });
    const { link } = (await (await criaConvite(app, lar)).json()) as { link: string };
    const token = tokenDoLink(link);

    const desafio = await pedeOpcoesDeAceite(app, token);
    const recusado = await verificaAceite(app, desafio, token, "cred-TEST-0105-recusada");
    expect(recusado.status).toBe(400);
    expect((await recusado.json()) as { error: string }).toMatchObject({ error: "passkey_invalida" });
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM invites WHERE kind = 'conjuge' AND used_at IS NULL AND cancelled_at IS NULL",
      ),
    ).toBe(1);
    expect(await contagem("SELECT COUNT(*) AS n FROM members WHERE role = 'conjuge'")).toBe(0);

    // O desafio foi gasto: o próximo passo começa de novo pelas opções.
    falso.verifyRegistration.mockImplementation(async () => ({
      id: "cred-TEST-0105-segunda",
      publicKey: "PUBLICA-segunda",
      counter: 0,
      transports: null,
    }));
    const desafioNovo = await pedeOpcoesDeAceite(app, token);
    expect((await verificaAceite(app, desafioNovo, token, "cred-TEST-0105-segunda")).status).toBe(201);
  });
});

describe("segurança do aceite", () => {
  it("token de uso único: depois de aceito, a mesma pessoa não aceita de novo (410 convite_usado)", async () => {
    const lar = await criaLar(16);
    const app = createApp({ webauthn: verificadorFalso("cred-TEST-0105-uso-16").webauthn });
    const { token } = await convidaEAceita(app, lar, "cred-TEST-0105-uso-16");

    const de_novo = await callApi(app, "POST", "/api/invites/accept/options", {
      token,
      name: "[TEST] Outra",
    });
    expect(de_novo.status).toBe(410);
    expect((await de_novo.json()) as { error: string }).toMatchObject({ error: "convite_usado" });
  });

  it("finalidade: um desafio de cadastro (com a pessoa) não serve no aceite; a finalidade é conferida", async () => {
    const lar = await criaLar(17);
    const app = createApp({ webauthn: verificadorFalso("cred-TEST-0105-finalidade-17").webauthn });
    const { link } = (await (await criaConvite(app, lar)).json()) as { link: string };
    const token = tokenDoLink(link);

    // Um desafio de cadastro tem a pessoa (member_id): só a finalidade o barra no aceite.
    await env.DB.prepare(
      "INSERT INTO webauthn_challenges (id, challenge, member_id, purpose, expires_at) VALUES ('desafio-de-cadastro-0105', 'DESAFIO-DE-CADASTRO-TEST', 'membro-de-cadastro-0105', 'cadastro', '2099-01-01T00:00:00.000Z')",
    ).run();
    const recusado = await verificaAceite(
      app,
      "desafio-de-cadastro-0105",
      token,
      "cred-TEST-0105-finalidade-17",
    );
    expect(recusado.status).toBe(400);
    expect((await recusado.json()) as { error: string }).toMatchObject({ error: "desafio_expirado" });
    expect(await contagem("SELECT COUNT(*) AS n FROM members WHERE role = 'conjuge'")).toBe(0);
    expect(await contagem("SELECT COUNT(*) AS n FROM webauthn_challenges")).toBe(0);
  });

  it("finalidade: um desafio de login (sem a pessoa) também não serve no aceite", async () => {
    const lar = await criaLar(19);
    const app = createApp({ webauthn: verificadorFalso("cred-TEST-0105-login-19").webauthn });
    const { link } = (await (await criaConvite(app, lar)).json()) as { link: string };
    const token = tokenDoLink(link);

    const login = await callApi(app, "POST", "/api/auth/login/options", {});
    const desafioDeLogin = valorDoCookie(login, "mm_chal") ?? "";
    expect(desafioDeLogin).toBeTruthy();
    const recusado = await verificaAceite(app, desafioDeLogin, token, "cred-TEST-0105-login-19");
    expect(recusado.status).toBe(400);
    expect((await recusado.json()) as { error: string }).toMatchObject({ error: "desafio_expirado" });
    expect(await contagem("SELECT COUNT(*) AS n FROM members WHERE role = 'conjuge'")).toBe(0);
  });

  it("uso único do desafio: uma passkey recusada já gasta o desafio; a mesma resposta de novo dá 400", async () => {
    const lar = await criaLar(18);
    const falso = verificadorFalso(null);
    const app = createApp({ webauthn: falso.webauthn });
    const { link } = (await (await criaConvite(app, lar)).json()) as { link: string };
    const token = tokenDoLink(link);
    const desafio = await pedeOpcoesDeAceite(app, token);

    const recusada = await verificaAceite(app, desafio, token, "cred-TEST-0105-dupla-18");
    expect(recusada.status).toBe(400);
    expect((await recusada.json()) as { error: string }).toMatchObject({ error: "passkey_invalida" });

    // O mesmo desafio, agora com uma passkey que o verificador aceitaria: já não serve.
    falso.verifyRegistration.mockImplementation(async () => ({
      id: "cred-TEST-0105-dupla-18",
      publicKey: "PUBLICA-dupla-18",
      counter: 0,
      transports: null,
    }));
    const segunda = await verificaAceite(app, desafio, token, "cred-TEST-0105-dupla-18");
    expect(segunda.status).toBe(400);
    expect((await segunda.json()) as { error: string }).toMatchObject({ error: "desafio_expirado" });
    expect(await contagem("SELECT COUNT(*) AS n FROM members WHERE role = 'conjuge'")).toBe(0);
  });

  it("o convite vence durante a verificação: nada entra, e a resposta diz que venceu", async () => {
    const lar = await criaLar(19);
    const { link } = (await (await criaConvite(createApp(), lar)).json()) as { link: string };
    const token = tokenDoLink(link);
    const app0 = createApp({ webauthn: verificadorFalso(null).webauthn });
    const desafio = await pedeOpcoesDeAceite(app0, token);

    const app = createApp({
      webauthn: verificadorFalso("cred-TEST-0105-vencido-19", async () => {
        await env.DB.prepare(
          "UPDATE invites SET expires_at = '2026-11-01T00:00:00.000Z' WHERE kind = 'conjuge'",
        ).run();
      }).webauthn,
    });
    const resposta = await verificaAceite(app, desafio, token, "cred-TEST-0105-vencido-19");
    expect(resposta.status).toBe(410);
    expect((await resposta.json()) as { error: string }).toMatchObject({ error: "convite_vencido" });
    expect(await contagem("SELECT COUNT(*) AS n FROM members WHERE role = 'conjuge'")).toBe(0);
    expect(
      await contagem("SELECT COUNT(*) AS n FROM invites WHERE kind = 'conjuge' AND used_at IS NOT NULL"),
    ).toBe(0);
  });

  it("o convite é cancelado durante a verificação: nada entra e o convite não fica gasto", async () => {
    const lar = await criaLar(20);
    const { link } = (await (await criaConvite(createApp(), lar)).json()) as { link: string };
    const token = tokenDoLink(link);
    const desafio = await pedeOpcoesDeAceite(createApp({ webauthn: verificadorFalso(null).webauthn }), token);

    const app = createApp({
      webauthn: verificadorFalso("cred-TEST-0105-cancelado-20", async () => {
        await env.DB.prepare(
          "UPDATE invites SET cancelled_at = '2026-11-08T12:00:00.000Z' WHERE kind = 'conjuge'",
        ).run();
      }).webauthn,
    });
    const resposta = await verificaAceite(app, desafio, token, "cred-TEST-0105-cancelado-20");
    expect(resposta.status).toBe(410);
    expect((await resposta.json()) as { error: string }).toMatchObject({ error: "convite_cancelado" });
    expect(await contagem("SELECT COUNT(*) AS n FROM members WHERE role = 'conjuge'")).toBe(0);
    expect(
      await contagem("SELECT COUNT(*) AS n FROM invites WHERE kind = 'conjuge' AND used_at IS NOT NULL"),
    ).toBe(0);
  });

  it("o lar ganha cônjuge durante a verificação: o convite não é gasto e a resposta é 409", async () => {
    const lar = await criaLar(21);
    const { link } = (await (await criaConvite(createApp(), lar)).json()) as { link: string };
    const token = tokenDoLink(link);
    const desafio = await pedeOpcoesDeAceite(createApp({ webauthn: verificadorFalso(null).webauthn }), token);

    const app = createApp({
      webauthn: verificadorFalso("cred-TEST-0105-corrida-21", async () => {
        await env.DB.prepare(
          "INSERT INTO members (id, household_id, name, email, role, created_at) VALUES ('membro-corrida-21', ?, '[TEST] Pessoa C', NULL, 'conjuge', '2026-11-08T12:00:00.000Z')",
        )
          .bind(lar.householdId)
          .run();
      }).webauthn,
    });
    const resposta = await verificaAceite(app, desafio, token, "cred-TEST-0105-corrida-21");
    expect(resposta.status).toBe(409);
    expect((await resposta.json()) as { error: string }).toMatchObject({ error: "conjuge_ja_existe" });
    // Só o cônjuge que entrou antes; o convite continua aguardando.
    expect(await contagem("SELECT COUNT(*) AS n FROM members WHERE role = 'conjuge'")).toBe(1);
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM invites WHERE kind = 'conjuge' AND used_at IS NULL AND cancelled_at IS NULL",
      ),
    ).toBe(1);
    expect(await contagem("SELECT COUNT(*) AS n FROM passkeys WHERE added_via = 'convite'")).toBe(0);
  });

  it("terceira pessoa num lar de duas: um convite aberto de novo não aceita (409 conjuge_ja_existe)", async () => {
    const lar = await criaLar(22);
    const app = createApp({ webauthn: verificadorFalso("cred-TEST-0105-dois-22").webauthn });
    await convidaEAceita(app, lar, "cred-TEST-0105-dois-22");
    // O lar já tem cônjuge; um convite aguardando que sobrou (o banco é a fonte) não pode ser aceito.
    await env.DB.prepare(
      "INSERT INTO invites (id, household_id, kind, token_hash, invitee_name, invitee_email, created_by, created_at, expires_at) VALUES ('convite-sobra-22', ?, 'conjuge', ?, '[TEST] Pessoa D', NULL, ?, '2026-11-08T00:00:00.000Z', '2026-11-20T00:00:00.000Z')",
    )
      .bind(lar.householdId, await sha256Hex("TOKEN-SOBRA-TEST-22"), lar.memberId)
      .run();

    const aceite = await callApi(app, "POST", "/api/invites/accept/options", {
      token: "TOKEN-SOBRA-TEST-22",
      name: "[TEST] Pessoa D",
    });
    expect(aceite.status).toBe(409);
    expect((await aceite.json()) as { error: string }).toMatchObject({ error: "conjuge_ja_existe" });
    expect(await contagem("SELECT COUNT(*) AS n FROM members WHERE role = 'conjuge'")).toBe(1);
  });
});

describe("convite de outro lar", () => {
  it("o outro lar não lista, não cancela e não gera link novo do convite alheio (404)", async () => {
    const lar1 = await criaLar(30);
    const lar2 = await criaLar(31);
    const app = createApp({ webauthn: verificadorFalso(null).webauthn });
    await criaConvite(app, lar1);
    const { invites } = (await (
      await callApi(app, "GET", "/api/invites", undefined, comCookie(lar1.cookie))
    ).json()) as { invites: { id: string }[] };
    const id = invites[0]?.id ?? "";

    const listaDoOutro = await callApi(app, "GET", "/api/invites", undefined, comCookie(lar2.cookie));
    expect(((await listaDoOutro.json()) as { invites: unknown[] }).invites).toEqual([]);

    const cancela = await callApi(app, "DELETE", `/api/invites/${id}`, undefined, comCookie(lar2.cookie));
    expect(cancela.status).toBe(404);
    const renova = await callApi(app, "POST", `/api/invites/${id}/renew`, {}, comCookie(lar2.cookie));
    expect(renova.status).toBe(404);
    expect((await renova.json()) as { error: string }).toMatchObject({ error: "convite_nao_encontrado" });

    // O convite do lar 1 continua aguardando.
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM invites WHERE kind = 'conjuge' AND cancelled_at IS NULL AND used_at IS NULL",
      ),
    ).toBe(1);
  });
});

describe("validação e sessão", () => {
  it("nome e e-mail inválidos dão 400 validacao com os campos", async () => {
    const lar = await criaLar(40);
    const app = createApp({ webauthn: verificadorFalso(null).webauthn });
    const resposta = await callApi(
      app,
      "POST",
      "/api/invites/conjuge",
      { name: " ", email: "nao-e-email" },
      comCookie(lar.cookie),
    );
    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toMatchObject({
      error: "validacao",
      fields: { name: expect.any(String), email: "Confira o e-mail." },
    });
    expect(await contagem("SELECT COUNT(*) AS n FROM invites WHERE kind = 'conjuge'")).toBe(0);
  });

  it("sem sessão, as rotas com sessão respondem 401 e nada é gravado", async () => {
    const app = createApp({ webauthn: verificadorFalso(null).webauthn });
    expect(
      (await callApi(app, "POST", "/api/invites/conjuge", { name: CONVIDADA.nome, email: null })).status,
    ).toBe(401);
    expect((await callApi(app, "GET", "/api/invites")).status).toBe(401);
    expect(await contagem("SELECT COUNT(*) AS n FROM invites WHERE kind = 'conjuge'")).toBe(0);
  });

  it("o aceite não expõe o hash, o token nem o link nas respostas", async () => {
    const lar = await criaLar(41);
    const app = createApp({ webauthn: verificadorFalso("cred-TEST-0105-sem-vazamento").webauthn });
    const { token, aceito } = await convidaEAceita(app, lar, "cred-TEST-0105-sem-vazamento");
    const texto = await aceito.text();
    expect(texto).not.toContain(token);
    expect(texto).not.toContain("/convite/");
    const hash = await sha256Hex(token);
    expect(texto).not.toContain(hash);
  });

  it("corpo sem o token dá 400 dados_invalidos", async () => {
    const app = createApp({ webauthn: verificadorFalso(null).webauthn });
    const resposta = await callApi(app, "POST", "/api/invites/inspect", {});
    expect(resposta.status).toBe(400);
    expect((await resposta.json()) as { error: string }).toMatchObject({ error: "dados_invalidos" });
  });
});
