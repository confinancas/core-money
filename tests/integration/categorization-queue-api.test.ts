import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { establishmentKey } from "../../src/shared/establishment-key";
import { createApp } from "../../src/worker/app";
import type { Meter } from "../../src/worker/db/metered-d1";
import type { AppEnv } from "../../src/worker/env";
import { aquecerOPortao, semearPronto } from "./helpers/app";
import {
  AGORA,
  categoriaDoLar,
  criarLar,
  criarOutroLar,
  criarRegra,
  inserirTransacao,
  type Lar,
} from "./helpers/regras";

// Fila Para categorizar (TASK-0304): contagens, aceite, aprendizado, desfazer e os cenários de concorrência e de
// outro lar. Dados [TEST]. Cada rota é uma ida ao D1 (db.batch), e a medida de calls prova isso.

beforeEach(async () => {
  await semearPronto(env.DB);
  await aquecerOPortao(createApp({}));
});

type App = Hono<AppEnv>;
type Resposta = { status: number; corpo: Record<string, unknown> };

async function chamar(app: App, metodo: string, caminho: string, corpo?: unknown): Promise<Resposta> {
  const ctx = createExecutionContext();
  const init: RequestInit = { method: metodo };
  if (corpo !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(corpo);
  }
  const resposta = await app.fetch(new Request(`http://matrimoney.test${caminho}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  const texto = await resposta.text();
  return { status: resposta.status, corpo: texto ? (JSON.parse(texto) as Record<string, unknown>) : {} };
}

const appDoLar = (sessao: { householdId: string; memberId: string }, medidos?: Meter[]): App =>
  createApp({
    resolveSession: async () => sessao,
    agora: () => new Date(AGORA),
    onMeter: medidos ? (meter) => medidos.push({ ...meter }) : undefined,
  });

const CHAVE_ASAAS = establishmentKey("[TEST] ASAAS12MAT") ?? "";
const SERVICOS = (lar: Lar): string => categoriaDoLar(lar, "servicos");
const LAZER = (lar: Lar): string => categoriaDoLar(lar, "lazer");

const pendente = (lar: Lar, descricao: string, extra: Partial<Parameters<typeof inserirTransacao>[1]> = {}) =>
  inserirTransacao(lar, {
    movement: "compra",
    amountCents: -1000,
    descricao,
    localDate: "2026-11-09",
    ...extra,
  });

type Linha = { transactionId: string };
const itensDaFila = (corpo: Record<string, unknown>): Linha[] => corpo.items as Linha[];

describe("GET /api/categorization/queue", () => {
  it("cenário 1: contagens e sugestões por filtro, e a linha de compra com sugestão", async () => {
    const lar = await criarLar();
    for (let i = 0; i < 3; i++)
      await pendente(lar, `[TEST] PIX ${i}`, {
        movement: "pix_enviado",
        aiCategoryId: SERVICOS(lar),
        contraparte: `[TEST] PESSOA ${i}`,
      });
    for (let i = 0; i < 2; i++)
      await pendente(lar, `[TEST] PIX SEM ${i}`, { movement: "pix_enviado", contraparte: `[TEST] SEM ${i}` });
    await pendente(lar, "[TEST] COMPRA A", { aiCategoryId: LAZER(lar), na: "cartao" });
    await pendente(lar, "[TEST] COMPRA B", { aiCategoryId: LAZER(lar), na: "cartao" });
    await pendente(lar, "[TEST] ENTRADA", { movement: "pix_recebido", amountCents: 5000 });

    const medidos: Meter[] = [];
    const r = await chamar(
      appDoLar({ householdId: lar.householdId, memberId: lar.memberId }, medidos),
      "GET",
      "/api/categorization/queue",
    );
    expect(r.status).toBe(200);
    expect(r.corpo.counts).toEqual({ todos: 8, pix: 5, cartao: 2, entradas: 1 });
    expect((r.corpo.suggested as Record<string, number>).todos).toBe(5);
    expect(medidos[0]?.calls).toBe(1);
  });

  it("cenário 7 e 21: oculta e histórico ficam fora", async () => {
    const lar = await criarLar();
    const oculta = await pendente(lar, "[TEST] OCULTA");
    await env.DB.prepare("UPDATE transactions SET hidden = 1 WHERE id = ?").bind(oculta).run();
    await pendente(lar, "[TEST] HISTORICO", { aiCategoryId: null });
    await env.DB.prepare(
      "UPDATE transactions SET is_backfill = 1 WHERE original_description = '[TEST] HISTORICO'",
    ).run();
    const r = await chamar(appDoLar(lar), "GET", "/api/categorization/queue");
    expect((r.corpo.counts as Record<string, number>).todos).toBe(0);
    expect(itensDaFila(r.corpo)).toEqual([]);
  });

  it("cenário 11: 120 pendentes saem em páginas de 50, sem repetir nem pular", async () => {
    const lar = await criarLar();
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 120)
       INSERT INTO transactions (id, household_id, external_id, bank_item_id, card_id, movement, occurred_at, local_date,
         amount_cents, original_description, establishment_key, last_seen_at)
       SELECT 'pag-' || i, ?, 'pag-ext-' || i, ?, ?, 'compra', '2026-11-05T12:00:00.000Z', '2026-11-05', -1000,
         '[TEST] PAG ' || i, 'TEST PAG ' || i, ? FROM n`,
    )
      .bind(lar.householdId, lar.bankItemId, lar.cardId, AGORA)
      .run();
    const app = appDoLar(lar);
    const primeira = await chamar(app, "GET", "/api/categorization/queue");
    expect(itensDaFila(primeira.corpo)).toHaveLength(50);
    const cursor = primeira.corpo.nextCursor as string;
    expect(cursor).toBeTruthy();
    const segunda = await chamar(
      app,
      "GET",
      `/api/categorization/queue?cursor=${encodeURIComponent(cursor)}`,
    );
    const segundaIds = itensDaFila(segunda.corpo).map((l) => l.transactionId);
    expect(segundaIds).toHaveLength(50);
    const todas = new Set([...itensDaFila(primeira.corpo).map((l) => l.transactionId), ...segundaIds]);
    expect(todas.size).toBe(100);
    const terceira = await chamar(
      app,
      "GET",
      `/api/categorization/queue?cursor=${encodeURIComponent(segunda.corpo.nextCursor as string)}`,
    );
    expect(itensDaFila(terceira.corpo)).toHaveLength(20);
    expect(terceira.corpo.nextCursor).toBeNull();
  });

  it("filtro inválido, cursor inválido → 422; sem sessão → 401", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    expect((await chamar(app, "GET", "/api/categorization/queue?filtro=nada")).status).toBe(422);
    expect((await chamar(app, "GET", "/api/categorization/queue?cursor=%%%")).status).toBe(422);
    const semSessao = createApp({ agora: () => new Date(AGORA) });
    expect((await chamar(semSessao, "GET", "/api/categorization/queue")).status).toBe(401);
  });

  it("lista vazia: tudo categorizado", async () => {
    const lar = await criarLar();
    const r = await chamar(appDoLar(lar), "GET", "/api/categorization/queue?filtro=pix");
    expect(r.status).toBe(200);
    expect(itensDaFila(r.corpo)).toEqual([]);
  });
});

describe("POST /api/categorization/accept", () => {
  it("valida o corpo: lista vazia e mais de 100 ids → 422", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    expect((await chamar(app, "POST", "/api/categorization/accept", { transactionIds: [] })).status).toBe(
      422,
    );
    const cem = Array.from({ length: 101 }, (_, i) => `x-${i}`);
    expect((await chamar(app, "POST", "/api/categorization/accept", { transactionIds: cem })).status).toBe(
      422,
    );
  });

  it("cenário 2: aceitar confirma as com sugestão e a conta é de uma chamada", async () => {
    const lar = await criarLar();
    const a = await pendente(lar, "[TEST] ASAAS12MAT", { aiCategoryId: SERVICOS(lar) });
    const b = await pendente(lar, "[TEST] SEM SUGESTAO");
    const medidos: Meter[] = [];
    const r = await chamar(appDoLar(lar, medidos), "POST", "/api/categorization/accept", {
      transactionIds: [a, b],
    });
    expect(r.status).toBe(200);
    expect((r.corpo.accepted as { transactionId: string }[]).map((x) => x.transactionId)).toEqual([a]);
    expect(r.corpo.skipped).toEqual([b]);
    expect(medidos[0]?.calls).toBe(1);
  });

  it("cenário 8: categoria arquivada volta em skipped", async () => {
    const lar = await criarLar();
    const a = await pendente(lar, "[TEST] ARQUIVADA", { aiCategoryId: SERVICOS(lar) });
    await env.DB.prepare("UPDATE categories SET archived_at = ? WHERE id = ?")
      .bind(AGORA, SERVICOS(lar))
      .run();
    const r = await chamar(appDoLar(lar), "POST", "/api/categorization/accept", { transactionIds: [a] });
    expect(r.corpo.skipped).toEqual([a]);
  });

  it("cenário 9: o parceiro confirmou antes; o aceite de A vem em skipped", async () => {
    const lar = await criarLar();
    const a = await pendente(lar, "[TEST] CONCORRENTE", { aiCategoryId: SERVICOS(lar) });
    await env.DB.prepare(
      "UPDATE transactions SET category_id = ?, categorized_by = ?, categorized_at = ? WHERE id = ?",
    )
      .bind(LAZER(lar), "outro-membro", "2026-11-10T09:00:00.000Z", a)
      .run();
    const r = await chamar(appDoLar(lar), "POST", "/api/categorization/accept", { transactionIds: [a] });
    expect(r.corpo.accepted).toEqual([]);
    expect(r.corpo.skipped).toEqual([a]);
    const linha = await env.DB.prepare("SELECT category_id FROM transactions WHERE id = ?")
      .bind(a)
      .first<{ category_id: string }>();
    expect(linha?.category_id).toBe(LAZER(lar));
  });

  it("cenário 14: id de outro lar volta em skipped e nada muda", async () => {
    const lar = await criarLar();
    const outro = await criarOutroLar();
    const doOutro = await inserirTransacao(
      { ...lar, householdId: outro.householdId, memberId: outro.memberId },
      { movement: "compra", amountCents: -500, descricao: "[TEST] DO OUTRO", aiCategoryId: null },
    );
    const r = await chamar(appDoLar(lar), "POST", "/api/categorization/accept", {
      transactionIds: [doOutro],
    });
    expect(r.corpo.skipped).toEqual([doOutro]);
  });

  it("cenário 15: a confirmação cria a regra de estabelecimento e a próxima igual já é categorizada pela regra", async () => {
    const lar = await criarLar();
    const a = await pendente(lar, "[TEST] ASAAS12MAT", { aiCategoryId: SERVICOS(lar), movement: "compra" });
    const r = await chamar(appDoLar(lar), "POST", "/api/categorization/accept", { transactionIds: [a] });
    const aceita = (r.corpo.accepted as { ruleId: string | null }[])[0];
    expect(aceita?.ruleId).toBeTruthy();
    const regra = await env.DB.prepare(
      "SELECT scope, created_from, set_category_id, disabled_at FROM rules WHERE household_id = ? AND match_value = '" +
        CHAVE_ASAAS +
        "' AND disabled_at IS NULL",
    )
      .bind(lar.householdId)
      .first<{ scope: string; created_from: string; set_category_id: string; disabled_at: string | null }>();
    expect(regra).toMatchObject({
      scope: "estabelecimento",
      created_from: "confirmacao",
      set_category_id: SERVICOS(lar),
    });
  });

  it("cenário 16: os iguais que esperavam saem da fila e os do histórico passam para a categoria confirmada", async () => {
    const lar = await criarLar();
    const pendentes = [
      await pendente(lar, "[TEST] ASAAS12MAT"),
      await pendente(lar, "[TEST] ASAAS12MAT"),
      await pendente(lar, "[TEST] ASAAS12MAT"),
    ];
    const historico: string[] = [];
    for (let i = 0; i < 5; i++) {
      historico.push(
        await pendente(lar, "[TEST] ASAAS12MAT", {
          aiCategoryId: SERVICOS(lar),
          movement: "compra",
          localDate: "2026-07-01",
        }),
      );
    }
    await env.DB.prepare(
      `UPDATE transactions SET is_backfill = 1, category_id = ai_category_id, categorized_by = 'ia', categorized_at = ?
       WHERE id IN (${historico.map(() => "?").join(",")})`,
    )
      .bind(AGORA, ...historico)
      .run();
    const academia = categoriaDoLar(lar, "lazer");
    await env.DB.prepare("UPDATE transactions SET ai_category_id = ? WHERE id = ?")
      .bind(academia, pendentes[0])
      .run();
    const r = await chamar(appDoLar(lar), "POST", "/api/categorization/accept", {
      transactionIds: [pendentes[0]],
    });
    expect(r.status).toBe(200);
    expect((r.corpo.alsoResolved as unknown[]).length).toBe(2);
    expect((r.corpo.alsoResolved as { transactionId: string }[]).map((x) => x.transactionId).sort()).toEqual(
      pendentes.slice(1).sort(),
    );
    const doHistorico = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM transactions WHERE id IN (${historico.map(() => "?").join(",")}) AND category_id = ?`,
    )
      .bind(...historico, academia)
      .first<{ n: number }>();
    expect(doHistorico?.n).toBe(5);
  });

  it("cenário 17: a compra igual que uma pessoa escolheu fica como está", async () => {
    const lar = await criarLar();
    const escolhida = await pendente(lar, "[TEST] ASAAS12MAT", {
      categoryId: LAZER(lar),
      categorizedBy: lar.memberId,
      aiCategoryId: SERVICOS(lar),
    });
    const a = await pendente(lar, "[TEST] ASAAS12MAT", { aiCategoryId: SERVICOS(lar) });
    await chamar(appDoLar(lar), "POST", "/api/categorization/accept", { transactionIds: [a] });
    const linha = await env.DB.prepare("SELECT category_id FROM transactions WHERE id = ?")
      .bind(escolhida)
      .first<{ category_id: string }>();
    expect(linha?.category_id).toBe(LAZER(lar));
  });

  it("cenário 25: entrada com renda ativa conta como sugestão; com a renda excluída, sem sugestão", async () => {
    const lar = await criarLar();
    const rendaAtiva = crypto.randomUUID();
    const rendaExcluida = crypto.randomUUID();
    for (const [id, nome, arquivada] of [
      [rendaAtiva, "[TEST] Salário em dólar", null],
      [rendaExcluida, "[TEST] Renda antiga", AGORA],
    ] as const) {
      await env.DB.prepare(
        "INSERT INTO fixed_incomes (id, household_id, name, currency, amount_cents, usual_day, arrival, statement_text, kept_usd_is_investment, archived_at) VALUES (?, ?, ?, 'USD', 500000, 5, 'partes', NULL, 1, ?)",
      )
        .bind(id, lar.householdId, nome, arquivada)
        .run();
    }
    await pendente(lar, "[TEST] SALARIO DOLAR", {
      id: "ent-ativa",
      movement: "pix_recebido",
      amountCents: 500000,
      descricao: "[TEST] SALARIO DOLAR",
    });
    await pendente(lar, "[TEST] RENDA ANTIGA", {
      id: "ent-excluida",
      movement: "pix_recebido",
      amountCents: 300000,
      descricao: "[TEST] RENDA ANTIGA",
    });
    await env.DB.prepare(
      "UPDATE transactions SET ai_income_kind = 'parte_salario', ai_income_subtype = NULL, ai_fixed_income_id = ?, ai_confidence = 'media' WHERE id = 'ent-ativa'",
    )
      .bind(rendaAtiva)
      .run();
    await env.DB.prepare(
      "UPDATE transactions SET ai_income_kind = 'parte_salario', ai_income_subtype = NULL, ai_fixed_income_id = ?, ai_confidence = 'media' WHERE id = 'ent-excluida'",
    )
      .bind(rendaExcluida)
      .run();
    const r = await chamar(appDoLar(lar), "GET", "/api/categorization/queue?filtro=entradas");
    expect((r.corpo.counts as Record<string, number>).entradas).toBe(2);
    expect((r.corpo.suggested as Record<string, number>).entradas).toBe(1);
    const itens = r.corpo.items as {
      transactionId: string;
      suggestion: { option: string; fixedIncomeName: string } | null;
    }[];
    const ativa = itens.find((i) => i.transactionId === "ent-ativa");
    expect(ativa?.suggestion).toMatchObject({
      option: "salario",
      fixedIncomeName: "[TEST] Salário em dólar",
    });
    expect(itens.find((i) => i.transactionId === "ent-excluida")?.suggestion).toBeNull();
  });

  it("desempate da regra em massa: a compra mais recente manda; na mesma data, o maior id", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const chave = establishmentKey("[TEST] DESEMPATE") ?? "";
    await pendente(lar, "[TEST] DESEMPATE", {
      id: "tb-antiga",
      aiCategoryId: SERVICOS(lar),
      localDate: "2026-11-08",
    });
    await pendente(lar, "[TEST] DESEMPATE", {
      id: "tb-nova",
      aiCategoryId: LAZER(lar),
      localDate: "2026-11-10",
    });
    await chamar(app, "POST", "/api/categorization/accept", { transactionIds: ["tb-antiga", "tb-nova"] });
    const porDatas = await env.DB.prepare(
      "SELECT set_category_id FROM rules WHERE household_id = ? AND match_value = ? AND disabled_at IS NULL",
    )
      .bind(lar.householdId, chave)
      .first<{ set_category_id: string }>();
    expect(porDatas?.set_category_id).toBe(LAZER(lar));

    const chaveDois = establishmentKey("[TEST] EMPATE") ?? "";
    await pendente(lar, "[TEST] EMPATE", {
      id: "te-1",
      aiCategoryId: SERVICOS(lar),
      localDate: "2026-11-09",
    });
    await pendente(lar, "[TEST] EMPATE", { id: "te-2", aiCategoryId: LAZER(lar), localDate: "2026-11-09" });
    await chamar(app, "POST", "/api/categorization/accept", { transactionIds: ["te-1", "te-2"] });
    const porId = await env.DB.prepare(
      "SELECT set_category_id FROM rules WHERE household_id = ? AND match_value = ? AND disabled_at IS NULL",
    )
      .bind(lar.householdId, chaveDois)
      .first<{ set_category_id: string }>();
    expect(porId?.set_category_id).toBe(LAZER(lar));
  });

  it("cenário 22: saída sem chave não cria regra e ruleId é nulo", async () => {
    const lar = await criarLar();
    const a = await pendente(lar, "", { aiCategoryId: SERVICOS(lar), movement: "outro", amountCents: -300 });
    const r = await chamar(appDoLar(lar), "POST", "/api/categorization/accept", { transactionIds: [a] });
    const aceita = (r.corpo.accepted as { ruleId: string | null }[])[0];
    expect(aceita?.ruleId ?? null).toBeNull();
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM rules WHERE household_id = ?")
      .bind(lar.householdId)
      .first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("cenário 23: regra ativa com categoria arquivada recebe a categoria confirmada", async () => {
    const lar = await criarLar();
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: CHAVE_ASAAS,
      setCategoryId: LAZER(lar),
      createdFrom: "aplicar_todas",
    });
    await env.DB.prepare("UPDATE categories SET archived_at = ? WHERE id = ?").bind(AGORA, LAZER(lar)).run();
    const a = await pendente(lar, "[TEST] ASAAS12MAT", { aiCategoryId: SERVICOS(lar) });
    await chamar(appDoLar(lar), "POST", "/api/categorization/accept", { transactionIds: [a] });
    const regra = await env.DB.prepare(
      "SELECT set_category_id, created_from FROM rules WHERE household_id = ? AND disabled_at IS NULL",
    )
      .bind(lar.householdId)
      .first<{ set_category_id: string; created_from: string }>();
    expect(regra).toMatchObject({ set_category_id: SERVICOS(lar), created_from: "confirmacao" });
  });

  it("cenário 24: regra só de nome ganha a categoria; desfazer só tira a categoria e o nome continua", async () => {
    const lar = await criarLar();
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: CHAVE_ASAAS,
      setCustomName: "[TEST] Academia",
      createdFrom: "aplicar_todas",
    });
    const a = await pendente(lar, "[TEST] ASAAS12MAT", { aiCategoryId: SERVICOS(lar) });
    const app = appDoLar(lar);
    await chamar(app, "POST", "/api/categorization/accept", { transactionIds: [a] });
    const desfez = await chamar(app, "POST", "/api/categorization/undo", {
      items: [{ transactionId: a, categoryId: SERVICOS(lar) }],
    });
    expect(desfez.corpo.undone).toEqual([a]);
    const regra = await env.DB.prepare(
      "SELECT set_custom_name, set_category_id, disabled_at FROM rules WHERE household_id = ? AND match_value = '" +
        CHAVE_ASAAS +
        "'",
    )
      .bind(lar.householdId)
      .first<{ set_custom_name: string; set_category_id: string | null; disabled_at: string | null }>();
    expect(regra).toMatchObject({
      set_custom_name: "[TEST] Academia",
      set_category_id: null,
      disabled_at: null,
    });
  });
});

describe("POST /api/categorization/undo", () => {
  it("valida o corpo: lista vazia e mais de 100 itens → 422", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    expect((await chamar(app, "POST", "/api/categorization/undo", { items: [] })).status).toBe(422);
    const muitos = Array.from({ length: 101 }, (_, i) => ({ transactionId: `x-${i}`, categoryId: "c" }));
    expect((await chamar(app, "POST", "/api/categorization/undo", { items: muitos })).status).toBe(422);
  });

  it("cenário 4 e 20: desfazer devolve à fila com a sugestão; a regra cai e o histórico volta à IA", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const a = await pendente(lar, "[TEST] ASAAS12MAT", { aiCategoryId: SERVICOS(lar) });
    const historico = await pendente(lar, "[TEST] ASAAS12MAT", {
      aiCategoryId: SERVICOS(lar),
      localDate: "2026-07-01",
    });
    await env.DB.prepare(
      "UPDATE transactions SET is_backfill = 1, category_id = ai_category_id, categorized_by = 'ia', categorized_at = ? WHERE id = ?",
    )
      .bind(AGORA, historico)
      .run();
    await chamar(app, "POST", "/api/categorization/accept", { transactionIds: [a] });
    const desfez = await chamar(app, "POST", "/api/categorization/undo", {
      items: [{ transactionId: a, categoryId: SERVICOS(lar) }],
    });
    expect(desfez.corpo.undone).toEqual(expect.arrayContaining([a, historico]));
    const fila = await chamar(app, "GET", "/api/categorization/queue");
    expect(itensDaFila(fila.corpo).map((l) => l.transactionId)).toEqual([a]);
    const hist = await env.DB.prepare(
      "SELECT category_id, categorized_by, rule_id FROM transactions WHERE id = ?",
    )
      .bind(historico)
      .first();
    expect(hist).toMatchObject({ category_id: SERVICOS(lar), categorized_by: "ia", rule_id: null });
    const regra = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM rules WHERE household_id = ? AND disabled_at IS NULL",
    )
      .bind(lar.householdId)
      .first<{ n: number }>();
    expect(regra?.n).toBe(0);
  });

  it("mutação da troca: item de outra categoria ou de outra pessoa volta em skipped", async () => {
    const lar = await criarLar();
    const a = await pendente(lar, "[TEST] OUTRA", { aiCategoryId: SERVICOS(lar) });
    await env.DB.prepare(
      "UPDATE transactions SET category_id = ?, categorized_by = ?, categorized_at = ? WHERE id = ?",
    )
      .bind(LAZER(lar), "outro-membro", AGORA, a)
      .run();
    const r = await chamar(appDoLar(lar), "POST", "/api/categorization/undo", {
      items: [{ transactionId: a, categoryId: SERVICOS(lar) }],
    });
    expect(r.corpo.skipped).toEqual([a]);
  });

  it("outro lar: o desfazer não toca", async () => {
    const lar = await criarLar();
    const outro = await criarOutroLar();
    const doOutro = await inserirTransacao(
      { ...lar, householdId: outro.householdId, memberId: outro.memberId },
      { movement: "compra", amountCents: -500, descricao: "[TEST] OUTRO DESFAZ", categoryId: null },
    );
    const r = await chamar(appDoLar(lar), "POST", "/api/categorization/undo", {
      items: [{ transactionId: doOutro, categoryId: SERVICOS(lar) }],
    });
    expect(r.corpo.skipped).toEqual([doOutro]);
  });
});
