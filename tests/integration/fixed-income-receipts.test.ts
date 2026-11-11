import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/worker/app";
import { afterIngest } from "../../src/worker/bank/after-ingest";
import { processNewTransactions } from "../../src/worker/categorization/pipeline";
import { ensureCalendar } from "../../src/worker/cycle/calendar";
import { createDb } from "../../src/worker/db/client";
import { newMeter } from "../../src/worker/db/metered-d1";
import type { AppEnv } from "../../src/worker/env";
import { computeCycleIncome } from "../../src/worker/income/cycle-income";
import { addTransactionReceiptStmts } from "../../src/worker/income/receipts";
import { aquecerOPortao, semearPronto } from "./helpers/app";
import { AGORA, contar, criarLar, criarOutroLar, inserirTransacao, type Lar } from "./helpers/regras";

// Recebimentos da renda fixa e renda do ciclo (TASK-0902). Ciclo com início 11: hoje (10/11/2026) está em 2026-10 e o
// anterior é 2026-09. Dados [TEST]; nenhum teste fala com o Banco Central.

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
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const resposta = await app.fetch(new Request(`http://matrimoney.test${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  const texto = await resposta.text();
  return { status: resposta.status, corpo: texto ? (JSON.parse(texto) as Corpo) : {} };
}

const appDoLar = (lar: { householdId: string; memberId: string }): Hono<AppEnv> =>
  createApp({ resolveSession: async () => lar, agora: () => new Date(AGORA) });

async function criarRenda(
  lar: Lar,
  valores: {
    nome: string;
    moeda?: "BRL" | "USD";
    valor: number;
    forma: "auto" | "partes" | "manual";
    texto?: string | null;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO fixed_incomes (id, household_id, name, currency, amount_cents, usual_day, arrival, statement_text,
       kept_usd_is_investment, archived_at) VALUES (?, ?, ?, ?, ?, 5, ?, ?, ?, NULL)`,
  )
    .bind(
      id,
      lar.householdId,
      valores.nome,
      valores.moeda ?? "BRL",
      valores.valor,
      valores.forma,
      valores.texto ?? null,
      valores.moeda === "USD" ? 1 : 0,
    )
    .run();
  return id;
}

// Uma entrada que chega pelo extrato: gravada e passada pelo afterIngest, como a importação faz.
async function entrarPeloExtrato(lar: Lar, descricao: string, valor: number, dia: string): Promise<string> {
  const id = await inserirTransacao(lar, {
    movement: "pix_recebido",
    amountCents: valor,
    descricao,
    localDate: dia,
  });
  await afterIngest(createDb(env.DB, newMeter()), {
    householdId: lar.householdId,
    bankItemId: lar.bankItemId,
    insertedIds: [id],
    updatedIds: [],
    now: AGORA,
  });
  return id;
}

const linhaDaTransacao = (id: string) =>
  env.DB.prepare("SELECT income_kind, fixed_income_id, categorized_by FROM transactions WHERE id = ?")
    .bind(id)
    .first<{ income_kind: string | null; fixed_income_id: string | null; categorized_by: string | null }>();

const CICLO_DE_HOJE = "2026-10";
const CICLO_ANTERIOR = "2026-09";

describe("cenário 1: CLT pelo extrato", () => {
  it("o recebimento é do extrato, a transação sai da fila e a renda do ciclo soma 5.000,00 em salários no Brasil", async () => {
    const lar = await criarLar();
    const rendaId = await criarRenda(lar, {
      nome: "[TEST] Salário CLT",
      valor: 500000,
      forma: "auto",
      texto: "SALARIO",
    });

    const transacao = await entrarPeloExtrato(lar, "SALARIO EMPRESA X", 500000, "2026-11-05");

    const recebimento = await env.DB.prepare(
      "SELECT fixed_income_id, confirmed_by, transaction_id, amount_cents, cycle_key FROM fixed_income_receipts",
    ).first<Record<string, unknown>>();
    expect(recebimento).toMatchObject({
      fixed_income_id: rendaId,
      confirmed_by: "extrato",
      transaction_id: transacao,
      amount_cents: 500000,
      cycle_key: CICLO_DE_HOJE,
    });
    expect(await linhaDaTransacao(transacao)).toEqual({
      income_kind: "parte_salario",
      fixed_income_id: rendaId,
      categorized_by: "regra",
    });

    const renda = await computeCycleIncome(createDb(env.DB, newMeter()), lar.householdId, CICLO_DE_HOJE);
    expect(renda?.brazilSalariesCents).toBe(500000);
    expect(renda?.fixedIncomes[0]).toMatchObject({ received: true, broughtCents: 500000 });
  });
});

describe("casamento pelo extrato", () => {
  it("cenário 13: com dois textos iguais, a entrada fica para classificar", async () => {
    const lar = await criarLar();
    await criarRenda(lar, { nome: "[TEST] Salário A", valor: 500000, forma: "auto", texto: "SALARIO" });
    await criarRenda(lar, { nome: "[TEST] Salário B", valor: 400000, forma: "auto", texto: "salario" });
    const transacao = await entrarPeloExtrato(lar, "SALARIO EMPRESA X", 500000, "2026-11-05");
    expect(await linhaDaTransacao(transacao)).toEqual({
      income_kind: null,
      fixed_income_id: null,
      categorized_by: null,
    });
  });

  it("cenário 13: com SALARIO e SALARIO EMPRESA X, a entrada vai para a mais longa", async () => {
    const lar = await criarLar();
    await criarRenda(lar, { nome: "[TEST] Salário curto", valor: 500000, forma: "auto", texto: "SALARIO" });
    const longa = await criarRenda(lar, {
      nome: "[TEST] Salário longo",
      valor: 500000,
      forma: "auto",
      texto: "SALARIO EMPRESA X",
    });
    const transacao = await entrarPeloExtrato(lar, "SALARIO EMPRESA X 11/2026", 500000, "2026-11-05");
    expect((await linhaDaTransacao(transacao))?.fixed_income_id).toBe(longa);
  });

  it("o pipeline faz no máximo 2 idas ao D1 com o passo do extrato", async () => {
    const lar = await criarLar();
    await criarRenda(lar, { nome: "[TEST] Salário", valor: 500000, forma: "auto", texto: "SALARIO" });
    const id = await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: 500000,
      descricao: "SALARIO EMPRESA X",
      localDate: "2026-11-05",
    });
    await createDb(env.DB, newMeter())
      .$client.prepare("UPDATE transactions SET cycle_key = ? WHERE id = ?")
      .bind(CICLO_DE_HOJE, id)
      .run();
    const medidor = newMeter();
    await processNewTransactions(createDb(env.DB, medidor), lar.householdId, [id], AGORA);
    expect(medidor.calls).toBeLessThanOrEqual(2);
    expect(await linhaDaTransacao(id)).toMatchObject({ income_kind: "parte_salario" });
  });
});

describe("cenário 11: recebimento lançado à mão", () => {
  it("POST grava, a renda do ciclo conta, o DELETE desfaz, e o DELETE de um recebimento do extrato dá 409", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const rendaId = await criarRenda(lar, { nome: "[TEST] Pró-labore", valor: 500000, forma: "manual" });

    const criado = await chamar(app, "POST", `/api/fixed-incomes/${rendaId}/receipts`, {
      receivedOn: "2026-11-05",
      amountCents: 500000,
    });
    expect(criado.status).toBe(201);
    expect(criado.corpo.receipt).toMatchObject({
      receivedOn: "2026-11-05",
      amountCents: 500000,
      manual: true,
      confirmedBy: "pessoa",
    });

    const depois = await chamar(app, "GET", `/api/cycle/income?cycleKey=${CICLO_DE_HOJE}`);
    expect(depois.corpo.brazilSalariesCents).toBe(500000);

    const apagado = await chamar(
      app,
      "DELETE",
      `/api/fixed-incomes/${rendaId}/receipts/${criado.corpo.receipt.id}`,
    );
    expect(apagado.status).toBe(204);
    const sem = await chamar(app, "GET", `/api/cycle/income?cycleKey=${CICLO_DE_HOJE}`);
    expect(sem.corpo.brazilSalariesCents).toBe(0);

    const rendaDoExtrato = await criarRenda(lar, {
      nome: "[TEST] Salário extrato",
      valor: 300000,
      forma: "auto",
      texto: "EXTRATO X",
    });
    await entrarPeloExtrato(lar, "EXTRATO X", 300000, "2026-11-05");
    const doExtrato = await env.DB.prepare("SELECT id FROM fixed_income_receipts WHERE fixed_income_id = ?")
      .bind(rendaDoExtrato)
      .first<{ id: string }>();
    const recusado = await chamar(
      app,
      "DELETE",
      `/api/fixed-incomes/${rendaDoExtrato}/receipts/${doExtrato?.id}`,
    );
    expect(recusado).toMatchObject({ status: 409, corpo: { error: "recebimento_do_extrato" } });
  });

  it("valida o dia (futuro e fora do ciclo de hoje ou do anterior) e o valor (0 em real)", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const rendaId = await criarRenda(lar, { nome: "[TEST] Renda manual", valor: 500000, forma: "manual" });
    const futuro = await chamar(app, "POST", `/api/fixed-incomes/${rendaId}/receipts`, {
      receivedOn: "2026-11-11",
      amountCents: 500000,
    });
    expect(futuro).toMatchObject({ status: 422, corpo: { error: "validacao" } });
    const antigo = await chamar(app, "POST", `/api/fixed-incomes/${rendaId}/receipts`, {
      receivedOn: "2026-06-05",
      amountCents: 500000,
    });
    expect(antigo.status).toBe(422);
    // Um ciclo mais antigo que o anterior, ainda dentro do calendário de 120 dias: também recusado.
    const doisCiclosAtras = await chamar(app, "POST", `/api/fixed-incomes/${rendaId}/receipts`, {
      receivedOn: "2026-08-15",
      amountCents: 500000,
    });
    expect(doisCiclosAtras.status).toBe(422);
    const zero = await chamar(app, "POST", `/api/fixed-incomes/${rendaId}/receipts`, {
      receivedOn: "2026-11-05",
      amountCents: 0,
    });
    expect(zero.corpo.fields).toEqual({ amountCents: "Informe quanto entrou." });
    expect(await contar("SELECT COUNT(*) AS total FROM fixed_income_receipts")).toBe(0);
  });
});

describe("cenário 12: dólar com 0,00 trazido", () => {
  it("um segundo 0,00 no mesmo ciclo devolve 409 ja_confirmada", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const rendaId = await criarRenda(lar, {
      nome: "[TEST] Dólar em partes",
      moeda: "USD",
      valor: 200000,
      forma: "partes",
      texto: "[TEST] PAGADORA EXTERIOR",
    });

    const primeiro = await chamar(app, "POST", `/api/fixed-incomes/${rendaId}/receipts`, {
      receivedOn: "2026-11-05",
      amountCents: 0,
    });
    expect(primeiro.status).toBe(201);
    const segundo = await chamar(app, "POST", `/api/fixed-incomes/${rendaId}/receipts`, {
      receivedOn: "2026-11-05",
      amountCents: 0,
    });
    expect(segundo).toMatchObject({ status: 409, corpo: { error: "ja_confirmada" } });
  });

  it("numa renda manual, depois de uma confirmação no ciclo, outra confirmação dá 409", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const rendaId = await criarRenda(lar, {
      nome: "[TEST] Dólar manual",
      moeda: "USD",
      valor: 200000,
      forma: "manual",
    });
    expect(
      (
        await chamar(app, "POST", `/api/fixed-incomes/${rendaId}/receipts`, {
          receivedOn: "2026-11-05",
          amountCents: 500000,
        })
      ).status,
    ).toBe(201);
    const outra = await chamar(app, "POST", `/api/fixed-incomes/${rendaId}/receipts`, {
      receivedOn: "2026-11-06",
      amountCents: 100000,
    });
    expect(outra).toMatchObject({ status: 409, corpo: { error: "ja_confirmada" } });
  });
});

describe("cenário 14: recasar pelo texto", () => {
  it("corrigir o texto casa as entradas do ciclo; trocar por outro texto solta os recebimentos do extrato", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const rendaId = await criarRenda(lar, {
      nome: "[TEST] Dólar",
      moeda: "USD",
      valor: 200000,
      forma: "partes",
      texto: "OUTRO",
    });
    const transacao = await entrarPeloExtrato(
      lar,
      "[TEST] PAGADORA EXTERIOR PAGAMENTO",
      400000,
      "2026-11-05",
    );
    expect((await linhaDaTransacao(transacao))?.income_kind).toBeNull();

    const casou = await chamar(app, "PATCH", `/api/fixed-incomes/${rendaId}`, {
      statementText: "[TEST] PAGADORA EXTERIOR",
    });
    expect(casou.status).toBe(200);
    expect(await linhaDaTransacao(transacao)).toMatchObject({
      income_kind: "parte_salario",
      fixed_income_id: rendaId,
    });

    const trocou = await chamar(app, "PATCH", `/api/fixed-incomes/${rendaId}`, { statementText: "OUTRO" });
    expect(trocou.status).toBe(200);
    expect(await contar("SELECT COUNT(*) AS total FROM fixed_income_receipts")).toBe(0);
    expect(await linhaDaTransacao(transacao)).toEqual({
      income_kind: null,
      fixed_income_id: null,
      categorized_by: null,
    });
  });
});

describe("cenário 15: ao mesmo tempo", () => {
  it("uma transação tem no máximo um recebimento, pelo índice único, e a marca é uma só", async () => {
    const lar = await criarLar();
    await criarRenda(lar, { nome: "[TEST] Salário", valor: 500000, forma: "auto", texto: "SALARIO" });
    const transacao = await entrarPeloExtrato(lar, "SALARIO EMPRESA X", 500000, "2026-11-05");

    // Um segundo recebimento com a mesma transação é recusado pelo índice único parcial.
    const renda = (
      await env.DB.prepare("SELECT fixed_income_id FROM fixed_income_receipts").first<{
        fixed_income_id: string;
      }>()
    )?.fixed_income_id as string;
    await expect(
      env.DB.prepare(
        "INSERT INTO fixed_income_receipts (id, fixed_income_id, cycle_key, transaction_id, amount_cents, received_on, confirmed_by) VALUES (?, ?, ?, ?, 1, '2026-11-05', 'pessoa')",
      )
        .bind(crypto.randomUUID(), renda, CICLO_DE_HOJE, transacao)
        .run(),
    ).rejects.toThrow();

    // A segunda gravação do mesmo casamento não entra: a instrução checa a transação e o recebimento.
    const db = createDb(env.DB, newMeter());
    await db.$client.batch(
      addTransactionReceiptStmts(db, lar.householdId, {
        receiptId: crypto.randomUUID(),
        fixedIncomeId: renda,
        cycleKey: CICLO_DE_HOJE,
        transactionId: transacao,
        receivedOn: "2026-11-05",
        amountCents: 500000,
        confirmedBy: "extrato",
        categorizedBy: "regra",
        agora: AGORA,
      }),
    );
    expect(
      await contar("SELECT COUNT(*) AS total FROM fixed_income_receipts WHERE transaction_id = ?", transacao),
    ).toBe(1);
    expect(await linhaDaTransacao(transacao)).toMatchObject({ income_kind: "parte_salario" });
  });
});

describe("cenário 16: renda excluída", () => {
  it("o ciclo atual perde o recebimento do extrato; os recebimentos de ciclos antigos continuam contando", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const rendaId = await criarRenda(lar, {
      nome: "[TEST] Salário",
      valor: 500000,
      forma: "auto",
      texto: "SALARIO",
    });
    const transacao = await entrarPeloExtrato(lar, "SALARIO EMPRESA X", 500000, "2026-11-05");
    await env.DB.prepare(
      `INSERT INTO fixed_income_receipts (id, fixed_income_id, cycle_key, transaction_id, amount_cents, received_on, confirmed_by)
       VALUES (?, ?, ?, NULL, 300000, '2026-10-05', 'pessoa')`,
    )
      .bind(crypto.randomUUID(), rendaId, CICLO_ANTERIOR)
      .run();

    await ensureCalendar(createDb(env.DB, newMeter()), lar.householdId, "2026-09-15", "2026-09-15");
    const excluida = await chamar(app, "DELETE", `/api/fixed-incomes/${rendaId}`);
    expect(excluida.status).toBe(204);
    expect(await linhaDaTransacao(transacao)).toEqual({
      income_kind: null,
      fixed_income_id: null,
      categorized_by: null,
    });
    expect(
      await contar("SELECT COUNT(*) AS total FROM fixed_income_receipts WHERE cycle_key = ?", CICLO_DE_HOJE),
    ).toBe(0);

    const antigo = await computeCycleIncome(createDb(env.DB, newMeter()), lar.householdId, CICLO_ANTERIOR);
    expect(antigo?.brazilSalariesCents).toBe(300000);
  });
});

describe("cenário 17: rendimento", () => {
  it("o rendimento sem marca entra na variável do ciclo", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const id = await inserirTransacao(lar, {
      movement: "rendimento",
      amountCents: 56870,
      descricao: "[TEST] RENDIMENTO CAIXINHA",
      localDate: "2026-11-05",
    });
    // A importação passa pelo afterIngest, que atribui o ciclo.
    await afterIngest(createDb(env.DB, newMeter()), {
      householdId: lar.householdId,
      bankItemId: lar.bankItemId,
      insertedIds: [id],
      updatedIds: [],
      now: AGORA,
    });
    const renda = await chamar(app, "GET", `/api/cycle/income?cycleKey=${CICLO_DE_HOJE}`);
    expect(renda.corpo.variableCents).toBe(56870);
    expect(renda.corpo.totalCents).toBe(56870);
  });
});

describe("cenário 18: outro lar e sessão", () => {
  it("o lar B não vê nem grava na renda do lar A; sem sessão, 401", async () => {
    const lar = await criarLar();
    const outro = await criarOutroLar();
    const rendaA = await criarRenda(lar, { nome: "[TEST] Salário", valor: 500000, forma: "manual" });
    await entrarPeloExtrato(lar, "SALARIO EMPRESA X", 500000, "2026-11-05");

    const visto = await chamar(appDoLar(outro), "GET", `/api/cycle/income?cycleKey=${CICLO_DE_HOJE}`);
    expect(visto.status).toBe(200);
    expect(visto.corpo.brazilSalariesCents).toBe(0);
    expect(visto.corpo.fixedIncomes).toEqual([]);

    const gravado = await chamar(appDoLar(outro), "POST", `/api/fixed-incomes/${rendaA}/receipts`, {
      receivedOn: "2026-11-05",
      amountCents: 500000,
    });
    expect(gravado.status).toBe(404);

    const semSessao = await chamar(createApp({}), "GET", `/api/cycle/income?cycleKey=${CICLO_DE_HOJE}`);
    expect(semSessao.status).toBe(401);
  });
});

// Rodada 2 (TASK-0902): a avaliação da Fable e as decisões do Opus. Cada teste falha sem a correção do item.
const linhaDoRecebimentoDaTransacao = (transacao: string) =>
  env.DB.prepare("SELECT COUNT(*) AS total FROM fixed_income_receipts WHERE transaction_id = ?")
    .bind(transacao)
    .first<{ total: number }>();

describe("rodada 2: o recasamento não mexe no que uma pessoa ou uma regra confirmou (F2)", () => {
  it("mudar o texto da renda não apaga a parte confirmada por uma pessoa", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const rendaId = await criarRenda(lar, {
      nome: "[TEST] Salário",
      valor: 500000,
      forma: "auto",
      texto: "SALARIO",
    });
    const transacao = await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: 200000,
      descricao: "[TEST] PIX DE AMIGO",
      localDate: "2026-11-05",
    });
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE transactions SET cycle_key = ?, income_kind = 'parte_salario', fixed_income_id = ?, categorized_by = 'regra' WHERE id = ?",
      ).bind(CICLO_DE_HOJE, rendaId, transacao),
      env.DB.prepare(
        "INSERT INTO fixed_income_receipts (id, fixed_income_id, cycle_key, transaction_id, amount_cents, received_on, confirmed_by) VALUES (?, ?, ?, ?, 200000, '2026-11-05', 'pessoa')",
      ).bind(crypto.randomUUID(), rendaId, CICLO_DE_HOJE, transacao),
    ]);

    const trocou = await chamar(app, "PATCH", `/api/fixed-incomes/${rendaId}`, { statementText: "OUTRO" });
    expect(trocou.status).toBe(200);
    expect(await linhaDoRecebimentoDaTransacao(transacao)).toEqual({ total: 1 });
    expect(await linhaDaTransacao(transacao)).toMatchObject({
      income_kind: "parte_salario",
      fixed_income_id: rendaId,
    });
  });

  it("excluir a renda não apaga a parte confirmada por uma regra", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const rendaId = await criarRenda(lar, {
      nome: "[TEST] Salário",
      valor: 500000,
      forma: "auto",
      texto: "SALARIO",
    });
    const transacao = await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: 200000,
      descricao: "[TEST] PIX DE AMIGO",
      localDate: "2026-11-05",
    });
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE transactions SET cycle_key = ?, income_kind = 'parte_salario', fixed_income_id = ?, categorized_by = 'regra' WHERE id = ?",
      ).bind(CICLO_DE_HOJE, rendaId, transacao),
      env.DB.prepare(
        "INSERT INTO fixed_income_receipts (id, fixed_income_id, cycle_key, transaction_id, amount_cents, received_on, confirmed_by) VALUES (?, ?, ?, ?, 200000, '2026-11-05', 'regra')",
      ).bind(crypto.randomUUID(), rendaId, CICLO_DE_HOJE, transacao),
    ]);

    expect((await chamar(app, "DELETE", `/api/fixed-incomes/${rendaId}`)).status).toBe(204);
    expect(await linhaDoRecebimentoDaTransacao(transacao)).toEqual({ total: 1 });
  });
});

describe("rodada 2: o recasamento garante o calendário do dia (F3)", () => {
  it("num lar sem o ciclo de hoje no calendário, mudar o texto casa a entrada do ciclo atual", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const rendaId = await criarRenda(lar, {
      nome: "[TEST] Salário",
      valor: 500000,
      forma: "auto",
      texto: "SALARI0",
    });
    const transacao = await entrarPeloExtrato(lar, "SALARIO EMPRESA X", 500000, "2026-11-05");
    expect(await linhaDaTransacao(transacao)).toMatchObject({ income_kind: null });
    await env.DB.prepare("DELETE FROM cycles WHERE household_id = ? AND key = ?")
      .bind(lar.householdId, CICLO_DE_HOJE)
      .run();

    const trocou = await chamar(app, "PATCH", `/api/fixed-incomes/${rendaId}`, { statementText: "SALARIO" });
    expect(trocou.status).toBe(200);
    expect(await linhaDaTransacao(transacao)).toMatchObject({
      income_kind: "parte_salario",
      fixed_income_id: rendaId,
    });
  });
});

describe("rodada 2: a entrada casada não entra em pendentes nem na fila da IA (F6)", () => {
  it("processNewTransactions tira a entrada casada de pending e não a enfileira", async () => {
    const lar = await criarLar();
    await criarRenda(lar, { nome: "[TEST] Salário", valor: 500000, forma: "auto", texto: "SALARIO" });
    const transacao = await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: 500000,
      descricao: "SALARIO EMPRESA X",
      localDate: "2026-11-05",
    });
    await env.DB.prepare("UPDATE transactions SET cycle_key = ? WHERE id = ?")
      .bind(CICLO_DE_HOJE, transacao)
      .run();

    const resultado = await processNewTransactions(
      createDb(env.DB, newMeter()),
      lar.householdId,
      [transacao],
      AGORA,
    );
    expect(resultado.pending).not.toContain(transacao);
    expect(await linhaDaTransacao(transacao)).toMatchObject({ income_kind: "parte_salario" });
    expect(
      await contar("SELECT COUNT(*) AS total FROM categorization_queue WHERE transaction_id = ?", transacao),
    ).toBe(0);
  });
});

describe("rodada 2: um lar não mexe no recebimento de outro (F6, cenário 18)", () => {
  it("o DELETE de recebimento manual do lar A, pelo lar B, dá 404 e a linha fica; o lar B não soma nada do lar A", async () => {
    const lar = await criarLar();
    const outro = await criarOutroLar();
    const rendaId = await criarRenda(lar, { nome: "[TEST] Pró-labore", valor: 500000, forma: "manual" });
    const criado = await chamar(appDoLar(lar), "POST", `/api/fixed-incomes/${rendaId}/receipts`, {
      receivedOn: "2026-11-05",
      amountCents: 500000,
    });
    expect(criado.status).toBe(201);
    const receitaId = criado.corpo.receipt.id as string;

    const apagado = await chamar(
      appDoLar(outro),
      "DELETE",
      `/api/fixed-incomes/${rendaId}/receipts/${receitaId}`,
    );
    expect(apagado.status).toBe(404);
    expect(await contar("SELECT COUNT(*) AS total FROM fixed_income_receipts WHERE id = ?", receitaId)).toBe(
      1,
    );

    const visto = await chamar(appDoLar(outro), "GET", `/api/cycle/income?cycleKey=${CICLO_DE_HOJE}`);
    expect(visto.corpo.brazilSalariesCents).toBe(0);
    expect(visto.corpo.fixedIncomes).toEqual([]);
  });
});

describe("rodada 2: a janela do recasamento é o ciclo atual e o anterior (F6)", () => {
  it("mudar o texto solta a parte do ciclo anterior e deixa a de dois ciclos atrás", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const rendaId = await criarRenda(lar, {
      nome: "[TEST] Salário",
      valor: 500000,
      forma: "auto",
      texto: "SALARIO",
    });
    // Ciclo anterior (2026-09): a entrada de 05/10.
    const anterior = await entrarPeloExtrato(lar, "SALARIO EMPRESA X", 300000, "2026-10-05");
    // Dois ciclos atrás (2026-08): uma entrada ligada à renda pelo extrato, de 05/09.
    const antigo = await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: 200000,
      descricao: "SALARIO ANTIGO",
      localDate: "2026-09-05",
    });
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE transactions SET cycle_key = '2026-08', income_kind = 'parte_salario', fixed_income_id = ?, categorized_by = 'regra' WHERE id = ?",
      ).bind(rendaId, antigo),
      env.DB.prepare(
        "INSERT INTO fixed_income_receipts (id, fixed_income_id, cycle_key, transaction_id, amount_cents, received_on, confirmed_by) VALUES (?, ?, '2026-08', ?, 200000, '2026-09-05', 'extrato')",
      ).bind(crypto.randomUUID(), rendaId, antigo),
    ]);

    const trocou = await chamar(app, "PATCH", `/api/fixed-incomes/${rendaId}`, { statementText: "OUTRO" });
    expect(trocou.status).toBe(200);
    expect(await linhaDaTransacao(anterior)).toEqual({
      income_kind: null,
      fixed_income_id: null,
      categorized_by: null,
    });
    expect(await linhaDoRecebimentoDaTransacao(antigo)).toEqual({ total: 1 });
  });
});

describe("rodada 2: entrada oculta ou de saída não casa (F6)", () => {
  it("uma entrada oculta e um valor negativo com o texto da renda não viram recebimento", async () => {
    const lar = await criarLar();
    await criarRenda(lar, { nome: "[TEST] Salário", valor: 500000, forma: "auto", texto: "SALARIO" });
    const oculta = await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: 500000,
      descricao: "SALARIO OCULTO",
      localDate: "2026-11-05",
    });
    await env.DB.prepare("UPDATE transactions SET hidden = 1 WHERE id = ?").bind(oculta).run();
    const saida = await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: -500000,
      descricao: "SALARIO NEGATIVO",
      localDate: "2026-11-05",
    });
    await afterIngest(createDb(env.DB, newMeter()), {
      householdId: lar.householdId,
      bankItemId: lar.bankItemId,
      insertedIds: [oculta, saida],
      updatedIds: [],
      now: AGORA,
    });
    expect(await linhaDaTransacao(oculta)).toMatchObject({ income_kind: null, fixed_income_id: null });
    expect(await linhaDaTransacao(saida)).toMatchObject({ income_kind: null, fixed_income_id: null });
    expect(await contar("SELECT COUNT(*) AS total FROM fixed_income_receipts")).toBe(0);
  });
});

describe("rodada 2: a variável não soma transação oculta (F6)", () => {
  it("um rendimento oculto fica fora da variável do ciclo", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const id = await inserirTransacao(lar, {
      movement: "rendimento",
      amountCents: 56870,
      descricao: "[TEST] RENDIMENTO OCULTO",
      localDate: "2026-11-05",
    });
    await afterIngest(createDb(env.DB, newMeter()), {
      householdId: lar.householdId,
      bankItemId: lar.bankItemId,
      insertedIds: [id],
      updatedIds: [],
      now: AGORA,
    });
    await env.DB.prepare("UPDATE transactions SET hidden = 1 WHERE id = ?").bind(id).run();
    const renda = await chamar(app, "GET", `/api/cycle/income?cycleKey=${CICLO_DE_HOJE}`);
    expect(renda.corpo.variableCents).toBe(0);
  });
});

describe("rodada 2: a renda do ciclo segue a transação (item 7)", () => {
  it("uma parte cuja transação está oculta ou removida sai da renda do ciclo", async () => {
    const lar = await criarLar();
    await criarRenda(lar, { nome: "[TEST] Salário", valor: 500000, forma: "auto", texto: "SALARIO" });
    const transacao = await entrarPeloExtrato(lar, "SALARIO EMPRESA X", 500000, "2026-11-05");
    const brasil = async () =>
      (await computeCycleIncome(createDb(env.DB, newMeter()), lar.householdId, CICLO_DE_HOJE))
        ?.brazilSalariesCents;
    expect(await brasil()).toBe(500000);

    await env.DB.prepare("UPDATE transactions SET hidden = 1 WHERE id = ?").bind(transacao).run();
    expect(await brasil()).toBe(0);

    await env.DB.prepare("UPDATE transactions SET hidden = 0, removed_at = ? WHERE id = ?")
      .bind(AGORA, transacao)
      .run();
    expect(await brasil()).toBe(0);
  });

  it("a renda do ciclo mostra o valor atual da transação, corrigido pelo banco", async () => {
    const lar = await criarLar();
    await criarRenda(lar, { nome: "[TEST] Salário", valor: 500000, forma: "auto", texto: "SALARIO" });
    const transacao = await entrarPeloExtrato(lar, "SALARIO EMPRESA X", 500000, "2026-11-05");
    await env.DB.prepare("UPDATE transactions SET amount_cents = 450000 WHERE id = ?").bind(transacao).run();
    const renda = await computeCycleIncome(createDb(env.DB, newMeter()), lar.householdId, CICLO_DE_HOJE);
    expect(renda?.brazilSalariesCents).toBe(450000);
  });
});

describe("rodada 2: o recebimento manual tem o teto da renda fixa (item 8)", () => {
  it("acima de 100 milhões em reais é recusado com 422; no teto, entra", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const rendaId = await criarRenda(lar, { nome: "[TEST] Pró-labore", valor: 500000, forma: "manual" });
    const acima = await chamar(app, "POST", `/api/fixed-incomes/${rendaId}/receipts`, {
      receivedOn: "2026-11-05",
      amountCents: 10_000_000_001,
    });
    expect(acima).toMatchObject({
      status: 422,
      corpo: { fields: { amountCents: "Informe quanto entrou." } },
    });
    const noTeto = await chamar(app, "POST", `/api/fixed-incomes/${rendaId}/receipts`, {
      receivedOn: "2026-11-05",
      amountCents: 10_000_000_000,
    });
    expect(noTeto.status).toBe(201);
  });
});

describe("rodada 2: o DELETE de recebimento manual só no ciclo atual e no anterior (item 9)", () => {
  it("um recebimento de dois ciclos atrás dá 422 e fica; o do ciclo anterior se apaga", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const rendaId = await criarRenda(lar, { nome: "[TEST] Pró-labore", valor: 500000, forma: "manual" });
    const antigo = crypto.randomUUID();
    const doAnterior = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO fixed_income_receipts (id, fixed_income_id, cycle_key, transaction_id, amount_cents, received_on, confirmed_by) VALUES (?, ?, '2026-08', NULL, 300000, '2026-08-15', 'pessoa')",
      ).bind(antigo, rendaId),
      env.DB.prepare(
        "INSERT INTO fixed_income_receipts (id, fixed_income_id, cycle_key, transaction_id, amount_cents, received_on, confirmed_by) VALUES (?, ?, '2026-09', NULL, 300000, '2026-10-05', 'pessoa')",
      ).bind(doAnterior, rendaId),
    ]);

    const recusado = await chamar(app, "DELETE", `/api/fixed-incomes/${rendaId}/receipts/${antigo}`);
    expect(recusado.status).toBe(422);
    expect(await contar("SELECT COUNT(*) AS total FROM fixed_income_receipts WHERE id = ?", antigo)).toBe(1);

    const apagado = await chamar(app, "DELETE", `/api/fixed-incomes/${rendaId}/receipts/${doAnterior}`);
    expect(apagado.status).toBe(204);
  });
});

describe("rodada 2: a parte nova copia a cotação do ciclo (F6)", () => {
  it("uma parte casada no mesmo ciclo de uma parte com cotação recebe a mesma cotação", async () => {
    const lar = await criarLar();
    await criarRenda(lar, { nome: "[TEST] Salário", valor: 500000, forma: "auto", texto: "SALARIO" });
    const primeira = await entrarPeloExtrato(lar, "SALARIO EMPRESA X", 400000, "2026-11-05");
    await env.DB.prepare(
      "UPDATE fixed_income_receipts SET fx_rate = 55000, fx_date = '2026-11-05' WHERE transaction_id = ?",
    )
      .bind(primeira)
      .run();
    const segunda = await entrarPeloExtrato(lar, "SALARIO EMPRESA X", 200000, "2026-11-06");
    const linha = await env.DB.prepare(
      "SELECT fx_rate, fx_date FROM fixed_income_receipts WHERE transaction_id = ?",
    )
      .bind(segunda)
      .first();
    expect(linha).toEqual({ fx_rate: 55000, fx_date: "2026-11-05" });
  });
});

describe("rodada 2: lastFx é a cotação do dia de referência mais novo (F6)", () => {
  it("entre duas cotações da renda, a da data mais nova", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const rendaId = await criarRenda(lar, {
      nome: "[TEST] Salário em dólar",
      moeda: "USD",
      valor: 200000,
      forma: "partes",
    });
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO fixed_income_receipts (id, fixed_income_id, cycle_key, transaction_id, amount_cents, received_on, fx_rate, fx_date, confirmed_by) VALUES (?, ?, '2026-09', NULL, 100000, '2026-10-05', 55000, '2026-10-05', 'pessoa')",
      ).bind(crypto.randomUUID(), rendaId),
      env.DB.prepare(
        "INSERT INTO fixed_income_receipts (id, fixed_income_id, cycle_key, transaction_id, amount_cents, received_on, fx_rate, fx_date, confirmed_by) VALUES (?, ?, '2026-09', NULL, 100000, '2026-10-06', 56000, '2026-10-06', 'pessoa')",
      ).bind(crypto.randomUUID(), rendaId),
    ]);
    const tela = await chamar(app, "GET", "/api/fixed-incomes");
    expect(tela.corpo.fixedIncomes[0].lastFx).toEqual({ rateE4: 56000, rate: "5,60", date: "2026-10-06" });
  });
});

// Rodada 3 (TASK-0902, Fable): o recasamento pelo PATCH do texto só casa a entrada boa. Mata as três mutações vivas do
// filtro de candidatas: a entrada de ciclo fora de chaves, a oculta e a saída (valor negativo) no SQL.
describe("rodada 3: o recasamento só casa a entrada boa (filtros de ciclo, oculta e saída)", () => {
  it("PATCH do texto: só a entrada boa do ciclo atual casa; a de dois ciclos atrás, a oculta e a saída ficam sem renda", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const rendaId = await criarRenda(lar, {
      nome: "[TEST] Salário",
      valor: 500000,
      forma: "auto",
      texto: "OUTRO",
    });
    // Dois ciclos atrás (05/09 cai no ciclo 2026-08): tem o texto, mas está fora do ciclo atual e do anterior.
    const antiga = await entrarPeloExtrato(lar, "SALARIO ANTIGO", 300000, "2026-09-05");
    // Entrada oculta com o texto da renda.
    const oculta = await entrarPeloExtrato(lar, "SALARIO OCULTO", 300000, "2026-11-05");
    await env.DB.prepare("UPDATE transactions SET hidden = 1 WHERE id = ?").bind(oculta).run();
    // Saída (valor negativo) de movimento "outro", com o texto da renda.
    const saida = await inserirTransacao(lar, {
      movement: "outro",
      amountCents: -100000,
      descricao: "SALARIO SAIDA",
      localDate: "2026-11-05",
    });
    await afterIngest(createDb(env.DB, newMeter()), {
      householdId: lar.householdId,
      bankItemId: lar.bankItemId,
      insertedIds: [saida],
      updatedIds: [],
      now: AGORA,
    });
    // Entrada boa: do ciclo atual, visível, de entrada.
    const boa = await entrarPeloExtrato(lar, "SALARIO BOM", 200000, "2026-11-06");

    // Com o texto "OUTRO", nenhuma entrada casa.
    expect(await linhaDaTransacao(boa)).toMatchObject({ income_kind: null, fixed_income_id: null });

    const trocou = await chamar(app, "PATCH", `/api/fixed-incomes/${rendaId}`, { statementText: "SALARIO" });
    expect(trocou.status).toBe(200);

    expect(await linhaDaTransacao(boa)).toMatchObject({
      income_kind: "parte_salario",
      fixed_income_id: rendaId,
    });
    for (const id of [antiga, oculta, saida]) {
      expect(await linhaDaTransacao(id)).toMatchObject({ income_kind: null, fixed_income_id: null });
    }
    expect(await contar("SELECT COUNT(*) AS total FROM fixed_income_receipts")).toBe(1);
  });
});
