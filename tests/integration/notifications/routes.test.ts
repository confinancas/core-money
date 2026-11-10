import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  ContagemDeNaoLidas,
  ListaDeNotificacoes,
  MarcadasDeNotificacoes,
  PreferenciasDeNotificacao,
} from "../../../src/shared/notifications/api";
import { NOTIFICATION_KINDS } from "../../../src/shared/notifications/kinds";
import { createApp } from "../../../src/worker/app";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import { notificationInsertStatements } from "../../../src/worker/notifications/insert";
import { COOKIE_DO_CONJUGE, COOKIE_DO_TITULAR, criaLarDeDuas, criaOutroLar } from "../helpers/aparelhos";
import { callApi, semearPronto } from "../helpers/app";
import { contaSql } from "../helpers/sessao";

// Central de notificações (TASK-0701), com D1 local e dados [TEST]: cenários 1 a 4, 6, 7 e 8 e as rotas com sessão.
// O relógio é fixo: "agora" é 10/11/2026 às 09:00 de São Paulo, e cada notificação é criada em relação a ele.

const AGORA = new Date("2026-11-10T12:00:00.000Z");
const relogio = (instante: Date) => () => instante;
const horasAtras = (horas: number, base: Date = AGORA) =>
  new Date(base.getTime() - horas * 60 * 60 * 1000).toISOString();
const diasAtras = (dias: number) => horasAtras(dias * 24);

type OpcoesDeNotificacao = {
  id: string;
  kind?: string;
  titulo?: string;
  corpo?: string;
  link?: string;
  dedupe?: string;
  criadaEm?: string;
  lidaEm?: string | null;
};

// Uma notificação direto no D1 de teste, no lar dado. Título e corpo são [TEST].
async function insereNotificacao(householdId: string, opcoes: OpcoesDeNotificacao): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO notifications (id, household_id, kind, title, body, link, dedupe_key, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      opcoes.id,
      householdId,
      opcoes.kind ?? "vencimento",
      opcoes.titulo ?? "[TEST] Fatura de teste vence em 3 dias",
      opcoes.corpo ?? "[TEST] 1.980,00 · vence 15/10 · ainda não foi paga",
      opcoes.link ?? "/contas",
      opcoes.dedupe ?? `dedupe-${opcoes.id}`,
      opcoes.criadaEm ?? horasAtras(1),
      opcoes.lidaEm ?? null,
    )
    .run();
}

async function casaDoLar(memberId: string): Promise<string> {
  const linha = await env.DB.prepare("SELECT household_id FROM members WHERE id = ?")
    .bind(memberId)
    .first<{ household_id: string }>();
  if (!linha) throw new Error("membro de teste sem lar");
  return linha.household_id;
}

const COOKIE_DO_OUTRO_LAR = (token: string) => `mm_sess=${token}`;

async function lista(app: ReturnType<typeof createApp>, cookie: string): Promise<ListaDeNotificacoes> {
  const resposta = await callApi(app, "GET", "/api/notifications", undefined, { cookie });
  expect(resposta.status).toBe(200);
  return (await resposta.json()) as ListaDeNotificacoes;
}

beforeEach(async () => {
  await semearPronto(env.DB);
});

describe("GET /api/notifications: a lista do lar", () => {
  it("cenário 1: 4 não lidas em Novas, mais novas primeiro, e 4 lidas em Anteriores", async () => {
    const { householdId } = await criaLarDeDuas();
    for (const [i, horas] of [1, 2, 3, 4].entries()) {
      await insereNotificacao(householdId, { id: `nova-${i}`, criadaEm: horasAtras(horas) });
    }
    for (const [i, horas] of [5, 6, 7, 8].entries()) {
      await insereNotificacao(householdId, {
        id: `lida-${i}`,
        criadaEm: horasAtras(horas),
        lidaEm: horasAtras(horas - 1),
      });
    }
    const app = createApp({ agora: relogio(AGORA) });

    const corpo = await lista(app, COOKIE_DO_TITULAR);

    expect(corpo.unreadCount).toBe(4);
    expect(corpo.new.map((item) => item.id)).toEqual(["nova-0", "nova-1", "nova-2", "nova-3"]);
    expect(corpo.previous.map((item) => item.id)).toEqual(["lida-0", "lida-1", "lida-2", "lida-3"]);
    expect(Object.keys(corpo.new[0] ?? {}).sort()).toEqual([
      "body",
      "createdAt",
      "id",
      "kind",
      "link",
      "title",
    ]);
  });

  it("Novas leva até 50 e o contador conta todas; Anteriores leva até 30", async () => {
    const { householdId } = await criaLarDeDuas();
    for (let i = 0; i < 55; i++) {
      await insereNotificacao(householdId, { id: `nova-${i}`, criadaEm: horasAtras(1 + i / 100) });
    }
    for (let i = 0; i < 35; i++) {
      await insereNotificacao(householdId, {
        id: `lida-${i}`,
        criadaEm: horasAtras(100 + i / 100),
        lidaEm: horasAtras(99),
      });
    }
    const app = createApp({ agora: relogio(AGORA) });

    const corpo = await lista(app, COOKIE_DO_TITULAR);

    expect(corpo.unreadCount).toBe(55);
    expect(corpo.new).toHaveLength(50);
    expect(corpo.previous).toHaveLength(30);
  });

  it("Anteriores só traz lidas dos últimos 90 dias", async () => {
    const { householdId } = await criaLarDeDuas();
    await insereNotificacao(householdId, {
      id: "lida-antiga",
      criadaEm: diasAtras(100),
      lidaEm: horasAtras(1),
    });
    await insereNotificacao(householdId, {
      id: "lida-recente",
      criadaEm: diasAtras(10),
      lidaEm: horasAtras(1),
    });
    const app = createApp({ agora: relogio(AGORA) });

    const corpo = await lista(app, COOKIE_DO_TITULAR);

    expect(corpo.previous.map((item) => item.id)).toEqual(["lida-recente"]);
  });

  it("o cônjuge vê a mesma lista do lar", async () => {
    const { householdId } = await criaLarDeDuas();
    await insereNotificacao(householdId, { id: "do-lar", criadaEm: horasAtras(2) });
    const app = createApp({ agora: relogio(AGORA) });

    const corpo = await lista(app, COOKIE_DO_CONJUGE);

    expect(corpo.new.map((item) => item.id)).toEqual(["do-lar"]);
    expect(corpo.unreadCount).toBe(1);
  });

  it("outro lar: a lista nunca traz as notificações de outro lar", async () => {
    const { householdId } = await criaLarDeDuas();
    await insereNotificacao(householdId, { id: "do-meu-lar" });
    const outro = await criaOutroLar();
    const outroLar = await casaDoLar(outro.memberId);
    await insereNotificacao(outroLar, { id: "do-outro-lar", criadaEm: horasAtras(1) });
    await insereNotificacao(outroLar, {
      id: "do-outro-lar-lida",
      criadaEm: horasAtras(2),
      lidaEm: horasAtras(1),
    });
    const app = createApp({ agora: relogio(AGORA) });

    const corpo = await lista(app, COOKIE_DO_TITULAR);

    expect(corpo.new.map((item) => item.id)).toEqual(["do-meu-lar"]);
    expect(corpo.previous).toEqual([]);
    expect(corpo.unreadCount).toBe(1);
  });

  it("sem sessão: 401", async () => {
    const app = createApp({ agora: relogio(AGORA) });

    const resposta = await callApi(app, "GET", "/api/notifications");

    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toMatchObject({ error: "nao_autenticado" });
  });
});

describe("GET /api/notifications/unread-count: o contador do sino", () => {
  it("conta só as não lidas do lar da sessão", async () => {
    const { householdId } = await criaLarDeDuas();
    await insereNotificacao(householdId, { id: "a" });
    await insereNotificacao(householdId, { id: "b" });
    await insereNotificacao(householdId, { id: "c", lidaEm: horasAtras(1) });
    const outro = await criaOutroLar();
    await insereNotificacao(await casaDoLar(outro.memberId), { id: "de-outro-lar" });
    const app = createApp({ agora: relogio(AGORA) });

    const resposta = await callApi(app, "GET", "/api/notifications/unread-count", undefined, {
      cookie: COOKIE_DO_TITULAR,
    });

    expect(resposta.status).toBe(200);
    expect((await resposta.json()) as ContagemDeNaoLidas).toEqual({ count: 2 });
  });

  it("sem sessão: 401", async () => {
    const app = createApp({ agora: relogio(AGORA) });

    const resposta = await callApi(app, "GET", "/api/notifications/unread-count");

    expect(resposta.status).toBe(401);
  });
});

describe("POST /api/notifications/:id/read: abrir uma notificação", () => {
  it("cenário 2: marca como lida para o lar e some das Novas", async () => {
    const { householdId } = await criaLarDeDuas();
    await insereNotificacao(householdId, { id: "fatura", criadaEm: horasAtras(2) });
    const app = createApp({ agora: relogio(AGORA) });

    const resposta = await callApi(app, "POST", "/api/notifications/fatura/read", undefined, {
      cookie: COOKIE_DO_TITULAR,
    });

    expect(resposta.status).toBe(204);
    const linha = await env.DB.prepare("SELECT read_at FROM notifications WHERE id = 'fatura'").first<{
      read_at: string | null;
    }>();
    expect(linha?.read_at).toBe(AGORA.toISOString());
    const depois = await lista(app, COOKIE_DO_TITULAR);
    expect(depois.new).toEqual([]);
    expect(depois.previous.map((item) => item.id)).toEqual(["fatura"]);
  });

  it("guarda a primeira leitura: a segunda, mais tarde, não muda read_at e ainda responde 204", async () => {
    const { householdId } = await criaLarDeDuas();
    await insereNotificacao(householdId, { id: "idempotente" });
    const primeira = new Date("2026-11-10T12:00:00.000Z");
    const segunda = new Date("2026-11-10T15:00:00.000Z");

    const respostaUm = await callApi(
      createApp({ agora: relogio(primeira) }),
      "POST",
      "/api/notifications/idempotente/read",
      undefined,
      {
        cookie: COOKIE_DO_TITULAR,
      },
    );
    const respostaDois = await callApi(
      createApp({ agora: relogio(segunda) }),
      "POST",
      "/api/notifications/idempotente/read",
      undefined,
      {
        cookie: COOKIE_DO_TITULAR,
      },
    );

    expect(respostaUm.status).toBe(204);
    expect(respostaDois.status).toBe(204);
    const linha = await env.DB.prepare("SELECT read_at FROM notifications WHERE id = 'idempotente'").first<{
      read_at: string;
    }>();
    expect(linha?.read_at).toBe(primeira.toISOString());
  });

  it("cenário 4: quem abre marca para os dois, e o sino do cônjuge diminui junto", async () => {
    const { householdId } = await criaLarDeDuas();
    await insereNotificacao(householdId, { id: "para-os-dois" });
    await insereNotificacao(householdId, { id: "outra" });
    const app = createApp({ agora: relogio(AGORA) });
    const contagemDoConjuge = async () =>
      (
        (await (
          await callApi(app, "GET", "/api/notifications/unread-count", undefined, {
            cookie: COOKIE_DO_CONJUGE,
          })
        ).json()) as ContagemDeNaoLidas
      ).count;
    expect(await contagemDoConjuge()).toBe(2);

    await callApi(app, "POST", "/api/notifications/para-os-dois/read", undefined, {
      cookie: COOKIE_DO_TITULAR,
    });

    expect(await contagemDoConjuge()).toBe(1);
    const doConjuge = await lista(app, COOKIE_DO_CONJUGE);
    expect(doConjuge.new.map((item) => item.id)).toEqual(["outra"]);
    expect(doConjuge.previous.map((item) => item.id)).toEqual(["para-os-dois"]);
  });

  it("cenário 7: uma notificação de outro lar responde 404 e não muda nada", async () => {
    await criaLarDeDuas();
    const outro = await criaOutroLar();
    await insereNotificacao(await casaDoLar(outro.memberId), { id: "de-outro-lar" });
    const app = createApp({ agora: relogio(AGORA) });

    const resposta = await callApi(app, "POST", "/api/notifications/de-outro-lar/read", undefined, {
      cookie: COOKIE_DO_TITULAR,
    });

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toMatchObject({ error: "notificacao_nao_encontrada" });
    const linha = await env.DB.prepare("SELECT read_at FROM notifications WHERE id = 'de-outro-lar'").first<{
      read_at: string | null;
    }>();
    expect(linha?.read_at).toBeNull();
  });

  it("id que não existe: 404", async () => {
    await criaLarDeDuas();
    const app = createApp({ agora: relogio(AGORA) });

    const resposta = await callApi(app, "POST", "/api/notifications/nao-existe/read", undefined, {
      cookie: COOKIE_DO_TITULAR,
    });

    expect(resposta.status).toBe(404);
  });

  it("sem sessão: 401, e nada muda", async () => {
    const { householdId } = await criaLarDeDuas();
    await insereNotificacao(householdId, { id: "sem-sessao" });
    const app = createApp({ agora: relogio(AGORA) });

    const resposta = await callApi(app, "POST", "/api/notifications/sem-sessao/read");

    expect(resposta.status).toBe(401);
    expect(await contaSql("SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL")).toBe(1);
  });
});

describe("POST /api/notifications/read-all: marcar todas como lidas", () => {
  it("cenário 3: marca só as não lidas do lar e devolve quantas foram", async () => {
    const { householdId } = await criaLarDeDuas();
    await insereNotificacao(householdId, { id: "a" });
    await insereNotificacao(householdId, { id: "b" });
    await insereNotificacao(householdId, { id: "ja-lida", lidaEm: horasAtras(3) });
    const outro = await criaOutroLar();
    await insereNotificacao(await casaDoLar(outro.memberId), { id: "de-outro-lar" });
    const app = createApp({ agora: relogio(AGORA) });

    const resposta = await callApi(app, "POST", "/api/notifications/read-all", undefined, {
      cookie: COOKIE_DO_TITULAR,
    });

    expect(resposta.status).toBe(200);
    expect((await resposta.json()) as MarcadasDeNotificacoes).toEqual({ marked: 2 });
    expect(
      await contaSql(
        "SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL AND household_id = (SELECT household_id FROM members WHERE id = ?)",
        outro.memberId,
      ),
    ).toBe(1);
    const depois = await lista(app, COOKIE_DO_TITULAR);
    expect(depois.unreadCount).toBe(0);
    expect(depois.new).toEqual([]);
  });

  it("de novo, sem nada novo: marked 0", async () => {
    await criaLarDeDuas();
    const app = createApp({ agora: relogio(AGORA) });

    const resposta = await callApi(app, "POST", "/api/notifications/read-all", undefined, {
      cookie: COOKIE_DO_TITULAR,
    });

    expect((await resposta.json()) as MarcadasDeNotificacoes).toEqual({ marked: 0 });
  });

  it("sem sessão: 401", async () => {
    const app = createApp({ agora: relogio(AGORA) });

    const resposta = await callApi(app, "POST", "/api/notifications/read-all");

    expect(resposta.status).toBe(401);
  });
});

describe("GET e PUT /api/notification-prefs: ligar e desligar cada tipo", () => {
  it("sem linhas gravadas, os 11 tipos aparecem ligados", async () => {
    await criaLarDeDuas();
    const app = createApp({ agora: relogio(AGORA) });

    const resposta = await callApi(app, "GET", "/api/notification-prefs", undefined, {
      cookie: COOKIE_DO_TITULAR,
    });

    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as PreferenciasDeNotificacao;
    expect(Object.keys(corpo.kinds)).toEqual([...NOTIFICATION_KINDS]);
    expect(Object.values(corpo.kinds).every((ligado) => ligado === true)).toBe(true);
  });

  it("cenário 6: desligar Vencimentos grava, e recarregar mantém", async () => {
    await criaLarDeDuas();
    const app = createApp({ agora: relogio(AGORA) });

    const resposta = await callApi(
      app,
      "PUT",
      "/api/notification-prefs",
      { kinds: { vencimento: false } },
      { cookie: COOKIE_DO_TITULAR },
    );

    expect(resposta.status).toBe(200);
    const devolvido = (await resposta.json()) as PreferenciasDeNotificacao;
    expect(devolvido.kinds.vencimento).toBe(false);
    expect(devolvido.kinds.insight).toBe(true);
    expect(
      await contaSql(
        "SELECT COUNT(*) AS n FROM notification_prefs WHERE kind = 'vencimento' AND enabled = 0",
      ),
    ).toBe(1);
    const depois = (await (
      await callApi(app, "GET", "/api/notification-prefs", undefined, { cookie: COOKIE_DO_CONJUGE })
    ).json()) as PreferenciasDeNotificacao;
    expect(depois.kinds.vencimento).toBe(false);
  });

  it("a mudança é parcial: os tipos não enviados ficam como estavam", async () => {
    await criaLarDeDuas();
    const app = createApp({ agora: relogio(AGORA) });
    await callApi(
      app,
      "PUT",
      "/api/notification-prefs",
      { kinds: { insight: false } },
      { cookie: COOKIE_DO_TITULAR },
    );

    const resposta = await callApi(
      app,
      "PUT",
      "/api/notification-prefs",
      { kinds: { vencimento: false } },
      { cookie: COOKIE_DO_TITULAR },
    );

    const corpo = (await resposta.json()) as PreferenciasDeNotificacao;
    expect(corpo.kinds.insight).toBe(false);
    expect(corpo.kinds.vencimento).toBe(false);
    expect(corpo.kinds.balanco).toBe(true);
  });

  it("ligar de volta grava 1 e a preferência volta a ser a padrão", async () => {
    await criaLarDeDuas();
    const app = createApp({ agora: relogio(AGORA) });
    await callApi(
      app,
      "PUT",
      "/api/notification-prefs",
      { kinds: { pix_recebido: false } },
      { cookie: COOKIE_DO_TITULAR },
    );

    const resposta = await callApi(
      app,
      "PUT",
      "/api/notification-prefs",
      { kinds: { pix_recebido: true } },
      { cookie: COOKIE_DO_TITULAR },
    );

    expect(((await resposta.json()) as PreferenciasDeNotificacao).kinds.pix_recebido).toBe(true);
    expect(
      await contaSql(
        "SELECT COUNT(*) AS n FROM notification_prefs WHERE kind = 'pix_recebido' AND enabled = 1",
      ),
    ).toBe(1);
  });

  it.each([
    ["tipo desconhecido", { kinds: { limite_pct: false } }],
    ["valor que não é booleano", { kinds: { vencimento: "não" } }],
    ["valor numérico", { kinds: { vencimento: 0 } }],
    ["chave a mais no corpo", { kinds: { vencimento: false }, extra: true }],
    ["kinds ausente", { vencimento: false }],
    ["lista no lugar do objeto", { kinds: [false] }],
    ["texto no corpo", "vencimento"],
  ])("%s: 400 preferencia_invalida, e nada é gravado", async (_nome, corpo) => {
    await criaLarDeDuas();
    const app = createApp({ agora: relogio(AGORA) });

    const resposta = await callApi(app, "PUT", "/api/notification-prefs", corpo, {
      cookie: COOKIE_DO_TITULAR,
    });

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ error: "preferencia_invalida" });
    expect(await contaSql("SELECT COUNT(*) AS n FROM notification_prefs")).toBe(0);
  });

  it("as preferências são do lar: o desligar de um lar não aparece no outro", async () => {
    await criaLarDeDuas();
    const outro = await criaOutroLar();
    const app = createApp({ agora: relogio(AGORA) });
    await callApi(
      app,
      "PUT",
      "/api/notification-prefs",
      { kinds: { vencimento: false } },
      { cookie: COOKIE_DO_TITULAR },
    );

    const resposta = await callApi(app, "GET", "/api/notification-prefs", undefined, {
      cookie: COOKIE_DO_OUTRO_LAR(outro.token),
    });

    expect(((await resposta.json()) as PreferenciasDeNotificacao).kinds.vencimento).toBe(true);
  });

  it("sem sessão: 401 nas duas", async () => {
    const app = createApp({ agora: relogio(AGORA) });

    expect((await callApi(app, "GET", "/api/notification-prefs")).status).toBe(401);
    expect(
      (await callApi(app, "PUT", "/api/notification-prefs", { kinds: { vencimento: false } })).status,
    ).toBe(401);
  });
});

describe("notificationInsertStatements: a mesma chave não duplica (cenário 8)", () => {
  it("a mesma dedupe_key inserida duas vezes gera uma linha só, e outro lar tem a sua", async () => {
    const { householdId } = await criaLarDeDuas();
    const db = createDb(env.DB, newMeter());
    const linha = {
      householdId,
      kind: "vencimento" as const,
      title: "[TEST] Fatura de teste vence em 3 dias",
      body: "[TEST] 1.980,00 · vence 15/10",
      link: "/contas",
      dedupeKey: "vencimento:fatura:teste-1",
      createdAt: AGORA.toISOString(),
    };

    await db.$client.batch(notificationInsertStatements(db, [linha, linha]));
    await db.$client.batch(notificationInsertStatements(db, [linha]));

    expect(
      await contaSql(
        "SELECT COUNT(*) AS n FROM notifications WHERE dedupe_key = 'vencimento:fatura:teste-1'",
      ),
    ).toBe(1);

    const outro = await criaOutroLar();
    await db.$client.batch(
      notificationInsertStatements(db, [{ ...linha, householdId: await casaDoLar(outro.memberId) }]),
    );
    expect(
      await contaSql(
        "SELECT COUNT(*) AS n FROM notifications WHERE dedupe_key = 'vencimento:fatura:teste-1'",
      ),
    ).toBe(2);
  });
});
