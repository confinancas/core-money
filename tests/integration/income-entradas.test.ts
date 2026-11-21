import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/worker/app";
import { applyRuleToTransactionStmt, type RegraParaAplicar } from "../../src/worker/categorization/apply";
import { processNewTransactions } from "../../src/worker/categorization/pipeline";
import { ensureCalendar } from "../../src/worker/cycle/calendar";
import { createDb } from "../../src/worker/db/client";
import { newMeter } from "../../src/worker/db/metered-d1";
import type { AppEnv } from "../../src/worker/env";
import { historicoDaEntradaStmts } from "../../src/worker/income/classification-entradas";
import { aquecerOPortao, semearPronto } from "./helpers/app";
import { AGORA, categoriaDoLar, contar, criarLar, inserirTransacao, type Lar } from "./helpers/regras";

// Pix recebido nas filas e na importação (TASK-0903): regra de remetente no pipeline, precedência do extrato, guarda de
// saída, aceite e desfazer de entradas (com o limite de 20), e a sugestão de entrada aplicada no histórico.
// Dados [TEST]; nenhum teste fala com o Banco Central nem com o Pluggy.

beforeEach(async () => {
  await semearPronto(env.DB);
  await aquecerOPortao(createApp({}));
});

// biome-ignore lint/suspicious/noExplicitAny: corpo de resposta de teste, conferido pelas asserções
type Corpo = Record<string, any>;

async function chamar(
  app: Hono<AppEnv>,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; corpo: Corpo }> {
  const ctx = createExecutionContext();
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const resposta = await app.fetch(new Request(`http://matrimoney.test${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  const texto = await resposta.text();
  return { status: resposta.status, corpo: texto ? (JSON.parse(texto) as Corpo) : {} };
}

const appDoLar = (lar: { householdId: string; memberId: string }): Hono<AppEnv> =>
  createApp({ resolveSession: async () => lar, agora: () => new Date(AGORA) });

const db = () => createDb(env.DB, newMeter());

async function prepararCiclos(lar: Lar): Promise<void> {
  await ensureCalendar(db(), lar.householdId, "2026-09-01", "2026-11-30");
}

async function criarRegraRemetente(
  lar: Lar,
  chave: string,
  valores: { kind: string; subtipo?: string | null; rendaId?: string | null; categoriaId?: string | null },
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO rules (id, household_id, scope, match_value, set_custom_name, set_category_id, set_spend_type,
       set_income_kind, set_income_subtype, set_fixed_income_id, set_movement, created_from, created_by, created_at, disabled_at)
     VALUES (?, ?, 'remetente', ?, NULL, ?, NULL, ?, ?, ?, NULL, 'manual', ?, ?, NULL)`,
  )
    .bind(
      id,
      lar.householdId,
      chave,
      valores.categoriaId ?? null,
      valores.kind,
      valores.subtipo ?? null,
      valores.rendaId ?? null,
      lar.memberId,
      AGORA,
    )
    .run();
  return id;
}

async function criarRendaFixa(
  lar: Lar,
  nome: string,
  arrival: "manual" | "auto" = "manual",
  texto: string | null = null,
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO fixed_incomes (id, household_id, name, currency, amount_cents, usual_day, arrival, statement_text,
       kept_usd_is_investment, archived_at) VALUES (?, ?, ?, 'BRL', 1000000, 5, ?, ?, 0, NULL)`,
  )
    .bind(id, lar.householdId, nome, arrival, texto)
    .run();
  return id;
}

async function pixDe(
  lar: Lar,
  nome: string,
  valor: number,
  dia = "2026-10-20",
  extras: { descricao?: string } = {},
): Promise<string> {
  const id = await inserirTransacao(lar, {
    movement: "pix_recebido",
    amountCents: valor,
    descricao: extras.descricao ?? `[TEST] Pix de ${nome}`,
    localDate: dia,
    contraparte: nome,
    doc: "***.123.456-**",
  });
  await env.DB.prepare("UPDATE transactions SET cycle_key = '2026-10' WHERE id = ?").bind(id).run();
  return id;
}

const linha = (id: string) =>
  env.DB.prepare(
    "SELECT income_kind, income_subtype, fixed_income_id, categorized_by, categorized_at, rule_id, spend_type, hidden FROM transactions WHERE id = ?",
  )
    .bind(id)
    .first<{
      income_kind: string | null;
      income_subtype: string | null;
      fixed_income_id: string | null;
      categorized_by: string | null;
      categorized_at: string | null;
      rule_id: string | null;
      spend_type: string | null;
      hidden: number;
    }>();

describe("pipeline: regra de remetente na importação", () => {
  it("classifica o Pix novo com a regra e grava a marca 'regra' com o rule_id (escrita só para a frente)", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const regra = await criarRegraRemetente(lar, "[TEST] FULANA|***.123.456-**", {
      kind: "variavel",
      subtipo: "venda",
    });
    const pix = await pixDe(lar, "[TEST] Fulana", 150_000);

    const resultado = await processNewTransactions(db(), lar.householdId, [pix], AGORA);

    expect(resultado.categorizedByRule).toContain(pix);
    expect(resultado.pending).not.toContain(pix);
    const depois = await linha(pix);
    expect(depois?.income_kind).toBe("variavel");
    expect(depois?.income_subtype).toBe("venda");
    expect(depois?.categorized_by).toBe("regra");
    expect(depois?.rule_id).toBe(regra);
    expect(depois?.spend_type).toBeNull();
  });

  it("parte do salário sem renda fixa ativa fica para classificar (não vira recebimento)", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    await criarRegraRemetente(lar, "[TEST] BELTRANA|***.123.456-**", {
      kind: "parte_salario",
      rendaId: "renda-inexistente",
    });
    const pix = await pixDe(lar, "[TEST] Beltrana", 90_000);

    const resultado = await processNewTransactions(db(), lar.householdId, [pix], AGORA);

    expect(resultado.pending).toContain(pix);
    expect((await linha(pix))?.income_kind).toBeNull();
    expect(
      await contar("SELECT COUNT(*) AS total FROM fixed_income_receipts WHERE transaction_id = ?", pix),
    ).toBe(0);
  });

  it("parte do salário com renda ativa vira recebimento com confirmed_by 'regra'", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const renda = await criarRendaFixa(lar, "[TEST] Salário em partes");
    await criarRegraRemetente(lar, "[TEST] CICRANA|***.123.456-**", {
      kind: "parte_salario",
      rendaId: renda,
    });
    const pix = await pixDe(lar, "[TEST] Cicrana", 70_000);

    await processNewTransactions(db(), lar.householdId, [pix], AGORA);

    expect((await linha(pix))?.income_kind).toBe("parte_salario");
    const recebimento = await env.DB.prepare(
      "SELECT confirmed_by, fixed_income_id FROM fixed_income_receipts WHERE transaction_id = ?",
    )
      .bind(pix)
      .first<{ confirmed_by: string; fixed_income_id: string }>();
    expect(recebimento?.confirmed_by).toBe("regra");
    expect(recebimento?.fixed_income_id).toBe(renda);
  });

  it("o extrato tem precedência: a entrada casada com a renda não é reclassificada pela regra", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const renda = await criarRendaFixa(lar, "[TEST] Salário dólar", "auto", "PAGADORA EXTERIOR");
    await criarRegraRemetente(lar, "[TEST] DEBORA|***.123.456-**", { kind: "variavel", subtipo: "venda" });
    const pix = await pixDe(lar, "[TEST] Debora", 300_000, "2026-10-20", {
      descricao: "[TEST] PAGADORA EXTERIOR Pix",
    });

    await processNewTransactions(db(), lar.householdId, [pix], AGORA);

    const recebimento = await env.DB.prepare(
      "SELECT confirmed_by, fixed_income_id FROM fixed_income_receipts WHERE transaction_id = ?",
    )
      .bind(pix)
      .first<{ confirmed_by: string; fixed_income_id: string }>();
    expect(recebimento?.confirmed_by).toBe("extrato");
    expect(recebimento?.fixed_income_id).toBe(renda);
    expect((await linha(pix))?.income_kind).toBe("parte_salario");
  });

  it("guarda de saída: uma regra de remetente com categoria não grava tipo de gasto numa entrada", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const pix = await pixDe(lar, "[TEST] Erica", 40_000);
    const regra: RegraParaAplicar = {
      id: "regra-remetente-com-categoria",
      scope: "remetente",
      matchValue: "[TEST] ERICA|***.123.456-**",
      setCustomName: null,
      setCategoryId: categoriaDoLar(lar, "mercado"),
      setSpendType: null,
      setMovement: null,
    };
    await env.DB.prepare(
      `INSERT INTO rules (id, household_id, scope, match_value, set_category_id, created_from, created_by, created_at)
       VALUES (?, ?, 'remetente', ?, ?, 'manual', ?, ?)`,
    )
      .bind(regra.id, lar.householdId, regra.matchValue, regra.setCategoryId, lar.memberId, AGORA)
      .run();
    const medidor = db();
    const comando = applyRuleToTransactionStmt(medidor, {
      householdId: lar.householdId,
      transactionId: pix,
      rule: regra,
      now: AGORA,
    });
    if (comando) await medidor.$client.batch([comando]);
    expect((await linha(pix))?.spend_type).toBeNull();
  });
});

describe("aceite e desfazer de entradas", () => {
  it("aceita até 20 entradas com lembrar, deixa 5 na lista, e o desfazer tira o recebimento e a regra (cenário 18 e 17)", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      const id = await pixDe(lar, `[TEST] Pagadora ${i}`, 10_000 + i);
      await env.DB.prepare(
        "UPDATE transactions SET ai_income_kind = 'variavel', ai_income_subtype = 'venda', ai_confidence = 'alta', ai_reason = 'venda' WHERE id = ?",
      )
        .bind(id)
        .run();
      ids.push(id);
    }
    const app = appDoLar(lar);

    const aceite = await chamar(app, "POST", "/api/categorization/accept", { transactionIds: ids });
    expect(aceite.status).toBe(200);
    expect(aceite.corpo.accepted).toHaveLength(20);
    expect(aceite.corpo.skipped).toHaveLength(5);
    const primeira = aceite.corpo.accepted[0].transactionId as string;
    expect((await linha(primeira))?.income_kind).toBe("variavel");
    expect((await linha(primeira))?.categorized_by).toBe(lar.memberId);
    expect(
      await contar(
        "SELECT COUNT(*) AS total FROM rules WHERE scope = 'remetente' AND created_from = 'confirmacao'",
      ),
    ).toBe(20);

    const desfeito = await chamar(app, "POST", "/api/categorization/undo", {
      items: [{ transactionId: primeira, categoryId: null }],
    });
    expect(desfeito.corpo.undone).toContain(primeira);
    expect((await linha(primeira))?.income_kind).toBeNull();
    expect((await linha(primeira))?.categorized_at).toBeNull();
    expect(
      await contar(
        "SELECT COUNT(*) AS total FROM rules WHERE match_value = ? AND disabled_at IS NULL",
        "[TEST] PAGADORA 0|***.123.456-**",
      ),
    ).toBe(0);
  });

  it("entrada sem sugestão de renda fica na lista (skipped)", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const semSugestao = await pixDe(lar, "[TEST] Sem sugestão", 5_000);
    const r = await chamar(appDoLar(lar), "POST", "/api/categorization/accept", {
      transactionIds: [semSugestao],
    });
    expect(r.corpo.skipped).toEqual([semSugestao]);
  });
});

describe("histórico: sugestão de entrada aplicada direto", () => {
  it("entrada de ciclo antigo (is_backfill = 1) é classificada pela IA, sem regra e sem fila", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const id = await pixDe(lar, "[TEST] Histórico", 80_000);
    await env.DB.prepare(
      "UPDATE transactions SET is_backfill = 1, ai_income_kind = 'variavel', ai_income_subtype = 'cashback' WHERE id = ?",
    )
      .bind(id)
      .run();

    const medidor = db();
    await medidor.$client.batch(historicoDaEntradaStmts(medidor, lar.householdId, id, AGORA));

    const depois = await linha(id);
    expect(depois?.income_kind).toBe("variavel");
    expect(depois?.income_subtype).toBe("cashback");
    expect(depois?.categorized_by).toBe("ia");
    expect(depois?.rule_id).toBeNull();
  });
});
