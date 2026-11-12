import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { establishmentKey } from "../../src/shared/establishment-key";
import { createApp } from "../../src/worker/app";
import { processNewTransactions } from "../../src/worker/categorization/pipeline";
import { createDb } from "../../src/worker/db/client";
import { type Meter, newMeter } from "../../src/worker/db/metered-d1";
import type { AppEnv } from "../../src/worker/env";
import { aquecerOPortao, semearPronto } from "./helpers/app";
import {
  AGORA,
  categoriaDoLar,
  contar,
  criarLar,
  criarOutroLar,
  criarRegra,
  inserirTransacao,
  type Lar,
  lerTransacao,
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

// Rodada 1 (A11): lacunas herdadas, N2, cenários que faltavam e a próxima importada.
const AGORA_DATA = new Date(AGORA);
const importarComRegras = async (lar: Lar, id: string) =>
  processNewTransactions(createDb(env.DB, newMeter()), lar.householdId, [id], AGORA_DATA.toISOString());
const membroDoLar = async (lar: Lar): Promise<string> => {
  const membro = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO members (id, household_id, name, role, created_at) VALUES (?, ?, '[TEST] Pessoa C', 'conjuge', ?)",
  )
    .bind(membro, lar.householdId, AGORA)
    .run();
  return membro;
};

describe("rodada 1: lacunas e cenários que faltavam", () => {
  it("lacunas da TASK-0302: outro lar, removida e movimento fora do escopo não mudam", async () => {
    const lar = await criarLar();
    const outroLar = await criarOutroLar();
    const confirmada = await pendente(lar, "[TEST] ASAAS12MAT", { aiCategoryId: SERVICOS(lar) });
    const igualDoOutro = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO transactions (id, household_id, external_id, bank_item_id, card_id, movement, occurred_at, local_date, amount_cents, original_description, establishment_key, last_seen_at) VALUES (?, ?, ?, ?, ?, 'compra', '2026-11-09T12:00:00.000Z', '2026-11-09', -1000, '[TEST] ASAAS12MAT', ?, ?)",
    )
      .bind(
        igualDoOutro,
        outroLar.householdId,
        "outro-" + igualDoOutro,
        lar.bankItemId,
        lar.cardId,
        CHAVE_ASAAS,
        AGORA,
      )
      .run();
    const igualRemovida = await pendente(lar, "[TEST] ASAAS12MAT");
    await env.DB.prepare("UPDATE transactions SET removed_at = ? WHERE id = ?")
      .bind(AGORA, igualRemovida)
      .run();
    const igualDeOutroMovimento = await pendente(lar, "[TEST] ASAAS12MAT", { movement: "pagamento_fatura" });
    const r = await chamar(appDoLar(lar), "POST", "/api/categorization/accept", {
      transactionIds: [confirmada],
    });
    expect(r.status).toBe(200);
    expect((await lerTransacao(igualDoOutro)).category_id).toBeNull();
    expect((await lerTransacao(igualRemovida)).category_id).toBeNull();
    expect((await lerTransacao(igualDeOutroMovimento)).category_id).toBeNull();
  });

  it("N2: linha que virou pagamento de fatura ou transferência sai da fila e não conta", async () => {
    const lar = await criarLar();
    for (const movimento of ["pagamento_fatura", "transferencia_interna"]) {
      const id = await pendente(lar, `[TEST] N2 ${movimento}`, { aiCategoryId: SERVICOS(lar) });
      await env.DB.prepare("UPDATE transactions SET movement = ? WHERE id = ?").bind(movimento, id).run();
    }
    const r = await chamar(appDoLar(lar), "GET", "/api/categorization/queue");
    expect(r.corpo.counts).toEqual({ todos: 0, pix: 0, cartao: 0, entradas: 0 });
    expect(itensDaFila(r.corpo)).toEqual([]);
  });

  it("cenário 8: sugestão de categoria arquivada vira linha sem sugestão, e o aceite a devolve em skipped", async () => {
    const lar = await criarLar();
    const id = await pendente(lar, "[TEST] ARQUIVADA", { aiCategoryId: SERVICOS(lar) });
    await env.DB.prepare("UPDATE categories SET archived_at = ? WHERE id = ?")
      .bind(AGORA, SERVICOS(lar))
      .run();
    const app = appDoLar(lar);
    const r = await chamar(app, "GET", "/api/categorization/queue");
    expect((r.corpo.suggested as Record<string, number>).todos).toBe(0);
    const linha = itensDaFila(r.corpo)[0] as { suggestion: unknown };
    expect(linha.suggestion).toBeNull();
    const aceite = await chamar(app, "POST", "/api/categorization/accept", { transactionIds: [id] });
    expect(aceite.corpo.skipped).toEqual([id]);
  });

  it("cenário 9 (segunda metade): o desfazer de A numa linha que B trocou depois volta em skipped", async () => {
    const lar = await criarLar();
    const membroB = await membroDoLar(lar);
    const id = await pendente(lar, "[TEST] DOIS AO MESMO TEMPO", { aiCategoryId: SERVICOS(lar) });
    const appA = appDoLar(lar);
    const appB = appDoLar({ ...lar, memberId: membroB });
    expect((await chamar(appB, "POST", "/api/categorization/accept", { transactionIds: [id] })).status).toBe(
      200,
    );
    const desfeitoPorA = await chamar(appA, "POST", "/api/categorization/undo", {
      items: [{ transactionId: id, categoryId: SERVICOS(lar) }],
    });
    expect(desfeitoPorA.corpo.skipped).toEqual([id]);
    expect((await lerTransacao(id)).categorized_by).toBe(membroB);
  });

  it("cenário 14 com sugestão: os ids de outro lar voltam em skipped e não aparecem na lista", async () => {
    const lar = await criarLar();
    const outro = await criarOutroLar();
    const id = await pendente(lar, "[TEST] OUTRO LAR", { aiCategoryId: SERVICOS(lar) });
    const appOutro = appDoLar(outro);
    const r = await chamar(appOutro, "POST", "/api/categorization/accept", { transactionIds: [id] });
    expect(r.corpo.skipped).toEqual([id]);
    expect(itensDaFila((await chamar(appOutro, "GET", "/api/categorization/queue")).corpo)).toEqual([]);
    expect((await lerTransacao(id)).category_id).toBeNull();
  });

  it("cenário 10: categorizada depois de a página carregar, a próxima página não a traz", async () => {
    const lar = await criarLar();
    const id = await pendente(lar, "[TEST] MEIO DO CAMINHO", { aiCategoryId: SERVICOS(lar) });
    await env.DB.prepare(
      "UPDATE transactions SET category_id = ?, categorized_at = ?, categorized_by = 'regra' WHERE id = ?",
    )
      .bind(LAZER(lar), AGORA, id)
      .run();
    const r = await chamar(appDoLar(lar), "GET", "/api/categorization/queue");
    expect(itensDaFila(r.corpo).map((l) => l.transactionId)).not.toContain(id);
  });

  it("cenário 18: Pix confirmado vira regra de destinatário, e a próxima importada do mesmo nome entra sozinha", async () => {
    const lar = await criarLar();
    const primeira = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -15000,
      descricao: "[TEST] PIX JOAO",
      localDate: "2026-11-09",
      contraparte: "[TEST] JOAO P SILVA",
      doc: "***.123.456-**",
      aiCategoryId: SERVICOS(lar),
    });
    const r = await chamar(appDoLar(lar), "POST", "/api/categorization/accept", {
      transactionIds: [primeira],
    });
    const ruleId = (r.corpo.accepted as { ruleId: string | null }[])[0]?.ruleId;
    expect(ruleId).toBeTruthy();
    expect(
      await contar("SELECT COUNT(*) AS total FROM rules WHERE id = ? AND scope = 'destinatario'", ruleId),
    ).toBe(1);
    const proxima = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -8000,
      descricao: "[TEST] PIX JOAO 2",
      localDate: "2026-11-10",
      contraparte: "[TEST] JOAO P SILVA",
      doc: "***.123.456-**",
    });
    await importarComRegras(lar, proxima);
    const linha = await lerTransacao(proxima);
    expect(linha.category_id).toBe(SERVICOS(lar));
    expect(linha.categorized_by).toBe("regra");
  });

  it("cenário 15 e 20: a confirmação de ASAAS12MAT ensina a próxima importada; desfazer devolve a fila", async () => {
    const lar = await criarLar();
    const primeira = await pendente(lar, "[TEST] ASAAS12MAT", { aiCategoryId: LAZER(lar) });
    const app = appDoLar(lar);
    const aceite = await chamar(app, "POST", "/api/categorization/accept", { transactionIds: [primeira] });
    const categoria = (aceite.corpo.accepted as { categoryId: string }[])[0]?.categoryId ?? "";
    const proxima = await pendente(lar, "[TEST] ASAAS12MAT", { localDate: "2026-11-10" });
    await importarComRegras(lar, proxima);
    expect((await lerTransacao(proxima)).categorized_by).toBe("regra");
    expect((await lerTransacao(proxima)).category_id).toBe(LAZER(lar));
    await chamar(app, "POST", "/api/categorization/undo", {
      items: [{ transactionId: primeira, categoryId: categoria }],
    });
    const terceira = await pendente(lar, "[TEST] ASAAS12MAT", { localDate: "2026-11-11" });
    await importarComRegras(lar, terceira);
    expect((await lerTransacao(terceira)).categorized_by).toBeNull();
  });

  it("cenário 19: cinco sugestões de três estabelecimentos viram três regras; a chave repetida leva a categoria mais recente", async () => {
    const lar = await criarLar();
    const ids = [
      await pendente(lar, "[TEST] LOJA A", { aiCategoryId: LAZER(lar), localDate: "2026-11-01" }),
      await pendente(lar, "[TEST] LOJA A", { aiCategoryId: SERVICOS(lar), localDate: "2026-11-09" }),
      await pendente(lar, "[TEST] LOJA B", { aiCategoryId: LAZER(lar) }),
      await pendente(lar, "[TEST] LOJA C", { aiCategoryId: SERVICOS(lar) }),
      await pendente(lar, "[TEST] LOJA C 2", { aiCategoryId: LAZER(lar) }),
    ];
    const r = await chamar(appDoLar(lar), "POST", "/api/categorization/accept", { transactionIds: ids });
    expect(r.status).toBe(200);
    expect(r.corpo.accepted).toHaveLength(5);
    expect(
      await contar(
        "SELECT COUNT(*) AS total FROM rules WHERE household_id = ? AND created_from = 'confirmacao'",
        lar.householdId,
      ),
    ).toBe(4);
    const deA = await env.DB.prepare(
      "SELECT set_category_id AS categoria FROM rules WHERE household_id = ? AND match_value = ? AND scope = 'estabelecimento' AND disabled_at IS NULL",
    )
      .bind(lar.householdId, establishmentKey("[TEST] LOJA A") ?? "")
      .first<{ categoria: string }>();
    expect(deA?.categoria).toBe(SERVICOS(lar));
  });

  it("cenário 24: a regra só de nome ganha a categoria; a próxima importada entra com o nome", async () => {
    const lar = await criarLar();
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: establishmentKey("[TEST] NOME SO") ?? "",
      setCustomName: "[TEST] Nome só",
    });
    const id = await pendente(lar, "[TEST] NOME SO", { aiCategoryId: LAZER(lar) });
    await chamar(appDoLar(lar), "POST", "/api/categorization/accept", { transactionIds: [id] });
    const proxima = await pendente(lar, "[TEST] NOME SO", { localDate: "2026-11-10" });
    await importarComRegras(lar, proxima);
    const linha = await lerTransacao(proxima);
    expect(linha.category_id).toBe(LAZER(lar));
    expect(linha.custom_name).toBe("[TEST] Nome só");
  });

  it("cenário 21: Pix recebido do histórico fica fora da fila e não conta", async () => {
    const lar = await criarLar();
    const id = await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: 5000,
      descricao: "[TEST] PIX RECEBIDO HISTORICO",
      localDate: "2026-09-01",
    });
    await env.DB.prepare("UPDATE transactions SET is_backfill = 1 WHERE id = ?").bind(id).run();
    const r = await chamar(appDoLar(lar), "GET", "/api/categorization/queue");
    expect(r.corpo.counts).toEqual({ todos: 0, pix: 0, cartao: 0, entradas: 0 });
  });

  it("cenário 25 (sem renda excluída): a sugestão de entrada de renda desaparecida vira Sem sugestão", async () => {
    const lar = await criarLar();
    const id = await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: 150000,
      descricao: "[TEST] PIX SALARIO",
      localDate: "2026-11-09",
    });
    await env.DB.prepare(
      "UPDATE transactions SET ai_income_kind = 'parte_salario', ai_confidence = 'media', ai_fixed_income_id = 'renda-inexistente' WHERE id = ?",
    )
      .bind(id)
      .run();
    const r = await chamar(appDoLar(lar), "GET", "/api/categorization/queue");
    const linha = itensDaFila(r.corpo)[0] as { suggestion: unknown };
    expect(linha.suggestion).toBeNull();
    expect((r.corpo.suggested as Record<string, number>).entradas).toBe(0);
  });
});

describe("rodada 1: o aceite só grava em linha pendente (nota da Fable)", () => {
  it("oculta, do histórico e que virou pagamento de fatura voltam em skipped, sem categoria nem regra", async () => {
    const lar = await criarLar();
    const oculta = await pendente(lar, "[TEST] ACEITE OCULTA", { aiCategoryId: SERVICOS(lar) });
    await env.DB.prepare("UPDATE transactions SET hidden = 1 WHERE id = ?").bind(oculta).run();
    const historico = await pendente(lar, "[TEST] ACEITE HISTORICO", { aiCategoryId: SERVICOS(lar) });
    await env.DB.prepare("UPDATE transactions SET is_backfill = 1 WHERE id = ?").bind(historico).run();
    const fatura = await pendente(lar, "[TEST] ACEITE FATURA", { aiCategoryId: SERVICOS(lar) });
    await env.DB.prepare("UPDATE transactions SET movement = 'pagamento_fatura' WHERE id = ?")
      .bind(fatura)
      .run();
    const ids = [oculta, historico, fatura];
    const r = await chamar(appDoLar(lar), "POST", "/api/categorization/accept", { transactionIds: ids });
    expect(r.corpo.accepted).toEqual([]);
    expect(r.corpo.skipped).toEqual(ids);
    for (const id of ids) expect((await lerTransacao(id)).category_id).toBeNull();
    expect(await contar("SELECT COUNT(*) AS total FROM rules WHERE household_id = ?", lar.householdId)).toBe(
      0,
    );
  });
});

describe("rodada 1: mutações que sobreviviam à suíte", () => {
  it("filtro da página: o filtro cartão não traz o Pix", async () => {
    const lar = await criarLar();
    await pendente(lar, "[TEST] FILTRO PIX", { movement: "pix_enviado", aiCategoryId: SERVICOS(lar) });
    const compra = await pendente(lar, "[TEST] FILTRO CARTAO", { na: "cartao", aiCategoryId: LAZER(lar) });
    const r = await chamar(appDoLar(lar), "GET", "/api/categorization/queue?filtro=cartao");
    expect(itensDaFila(r.corpo).map((l) => l.transactionId)).toEqual([compra]);
  });

  it("aceite: linha removida vai para skipped e não recebe categoria", async () => {
    const lar = await criarLar();
    const id = await pendente(lar, "[TEST] ACEITE REMOVIDA", { aiCategoryId: SERVICOS(lar) });
    await env.DB.prepare("UPDATE transactions SET removed_at = ? WHERE id = ?").bind(AGORA, id).run();
    const r = await chamar(appDoLar(lar), "POST", "/api/categorization/accept", { transactionIds: [id] });
    expect(r.corpo.accepted).toEqual([]);
    expect(r.corpo.skipped).toEqual([id]);
    expect((await lerTransacao(id)).category_id).toBeNull();
  });

  it("desfazer: uma categoria diferente da gravada não desfaz a linha", async () => {
    const lar = await criarLar();
    const id = await pendente(lar, "[TEST] DESFAZER CATEGORIA", { aiCategoryId: SERVICOS(lar) });
    const app = appDoLar(lar);
    await chamar(app, "POST", "/api/categorization/accept", { transactionIds: [id] });
    const r = await chamar(app, "POST", "/api/categorization/undo", {
      items: [{ transactionId: id, categoryId: LAZER(lar) }],
    });
    expect(r.corpo.skipped).toEqual([id]);
    expect((await lerTransacao(id)).category_id).toBe(SERVICOS(lar));
  });

  it("desativar regra: a regra de confirmação de outra pessoa continua ativa", async () => {
    const lar = await criarLar();
    const membroB = await membroDoLar(lar);
    const regra = await criarRegra(
      { householdId: lar.householdId, memberId: membroB },
      {
        scope: "estabelecimento",
        matchValue: "TEST REGRA DE B",
        setCategoryId: LAZER(lar),
        createdFrom: "confirmacao",
      },
    );
    const id = await pendente(lar, "[TEST] REGRA DE B", { aiCategoryId: SERVICOS(lar) });
    await env.DB.prepare(
      "UPDATE transactions SET category_id = ?, categorized_at = ?, categorized_by = ?, rule_id = ? WHERE id = ?",
    )
      .bind(SERVICOS(lar), AGORA, lar.memberId, regra, id)
      .run();
    const r = await chamar(appDoLar(lar), "POST", "/api/categorization/undo", {
      items: [{ transactionId: id, categoryId: SERVICOS(lar) }],
    });
    expect(r.corpo.undone).toEqual([id]);
    expect(
      await contar("SELECT COUNT(*) AS total FROM rules WHERE id = ? AND disabled_at IS NULL", regra),
    ).toBe(1);
  });

  it("volta: as linhas de uma regra de outra pessoa não voltam quando eu desfaço a minha", async () => {
    const lar = await criarLar();
    const membroB = await membroDoLar(lar);
    const regra = await criarRegra(
      { householdId: lar.householdId, memberId: membroB },
      {
        scope: "estabelecimento",
        matchValue: establishmentKey("[TEST] VOLTA DE B") ?? "",
        setCategoryId: LAZER(lar),
        createdFrom: "confirmacao",
      },
    );
    const minha = await pendente(lar, "[TEST] VOLTA DE B", { aiCategoryId: SERVICOS(lar) });
    const dela = await pendente(lar, "[TEST] VOLTA DE B", { aiCategoryId: LAZER(lar) });
    for (const [id, categoria, por] of [
      [minha, SERVICOS(lar), lar.memberId],
      [dela, LAZER(lar), "regra"],
    ] as const) {
      await env.DB.prepare(
        "UPDATE transactions SET category_id = ?, categorized_at = ?, categorized_by = ?, rule_id = ? WHERE id = ?",
      )
        .bind(categoria, AGORA, por, regra, id)
        .run();
    }
    await chamar(appDoLar(lar), "POST", "/api/categorization/undo", {
      items: [{ transactionId: minha, categoryId: SERVICOS(lar) }],
    });
    const linha = await lerTransacao(dela);
    expect(linha.category_id).toBe(LAZER(lar));
    expect(linha.categorized_by).toBe("regra");
  });
});
