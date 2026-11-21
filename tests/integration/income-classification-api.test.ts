import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/worker/app";
import { ensureCalendar } from "../../src/worker/cycle/calendar";
import { createDb } from "../../src/worker/db/client";
import { newMeter } from "../../src/worker/db/metered-d1";
import type { AppEnv } from "../../src/worker/env";
import { aquecerOPortao, semearPronto } from "./helpers/app";
import { AGORA, contar, criarLar, criarOutroLar, inserirTransacao, type Lar } from "./helpers/regras";

// Pix recebido (TASK-0903): leitura, prévia e gravação da classificação. Dados [TEST]; nenhum teste fala com o Pluggy.
// O ciclo 2026-10 (início 11/10) é o de AGORA. Cada transação entra com cycle_key definido.

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

async function prepararCiclos(lar: Lar): Promise<void> {
  await ensureCalendar(createDb(env.DB, newMeter()), lar.householdId, "2026-09-01", "2026-11-30");
}

async function criarRenda(
  lar: Lar,
  nome: string,
  valor: number,
  forma: "auto" | "manual" = "manual",
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO fixed_incomes (id, household_id, name, currency, amount_cents, usual_day, arrival, statement_text,
       kept_usd_is_investment, archived_at) VALUES (?, ?, ?, 'BRL', ?, 5, ?, NULL, 0, NULL)`,
  )
    .bind(id, lar.householdId, nome, valor, forma)
    .run();
  return id;
}

// Pix recebido de uma contraparte, no ciclo 2026-10. A contraparte casa a regra de remetente.
async function criarPix(
  lar: Lar,
  valor: number,
  contraparte: string | null = "[TEST] Fulana",
  extras: { movement?: string; doc?: string | null; backfill?: boolean } = {},
): Promise<string> {
  const id = await inserirTransacao(lar, {
    movement: extras.movement ?? "pix_recebido",
    amountCents: valor,
    descricao: `[TEST] Pix de ${contraparte ?? "sem nome"}`,
    localDate: "2026-10-20",
    contraparte: contraparte,
    doc: extras.doc === undefined ? "***.123.456-**" : extras.doc,
  });
  await env.DB.prepare("UPDATE transactions SET cycle_key = '2026-10', is_backfill = ? WHERE id = ?")
    .bind(extras.backfill ? 1 : 0, id)
    .run();
  return id;
}

const linhaDa = (id: string) =>
  env.DB.prepare(
    `SELECT income_kind, income_subtype, fixed_income_id, hidden, hidden_reason, categorized_by, rule_id
     FROM transactions WHERE id = ?`,
  )
    .bind(id)
    .first<{
      income_kind: string | null;
      income_subtype: string | null;
      fixed_income_id: string | null;
      hidden: number;
      hidden_reason: string | null;
      categorized_by: string | null;
      rule_id: string | null;
    }>();

describe("leitura da classificação", () => {
  it("devolve a entrada, as rendas, a renda do ciclo e a sugestão (422 para o que não é entrada, 404 de outro lar)", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const renda = await criarRenda(lar, "[TEST] Salário", 1_000_000);
    const pix = await criarPix(lar, 150_000);
    const enviado = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -5_000,
      descricao: "[TEST] Pix enviado",
      localDate: "2026-10-20",
    });
    const app = appDoLar(lar);

    const ok = await chamar(app, "GET", `/api/transactions/${pix}/income-classification`);
    expect(ok.status).toBe(200);
    expect(ok.corpo.transaction.amountCents).toBe(150_000);
    expect(ok.corpo.classification).toBeNull();
    expect(ok.corpo.canRemember).toBe(true);
    expect(ok.corpo.fixedIncomes.map((r: { id: string }) => r.id)).toContain(renda);
    expect(ok.corpo.transaction.cycleKey).toBe("2026-10");

    expect((await chamar(app, "GET", `/api/transactions/${enviado}/income-classification`)).corpo.error).toBe(
      "nao_e_entrada",
    );
    expect((await chamar(app, "GET", `/api/transactions/${enviado}/income-classification`)).status).toBe(422);

    const outro = await criarOutroLar();
    const deOutro = await chamar(appDoLar(outro), "GET", `/api/transactions/${pix}/income-classification`);
    expect(deOutro.status).toBe(404);
  });
});

describe("prévia (cenário 1)", () => {
  it("renda variável de 1.500,00 soma na renda do ciclo, sem gravar", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const pix = await criarPix(lar, 150_000);
    const app = appDoLar(lar);

    const previa = await chamar(app, "POST", `/api/transactions/${pix}/income-classification/preview`, {
      option: "variavel",
      incomeSubtype: "venda",
    });
    expect(previa.status).toBe(200);
    expect(previa.corpo.cycleKey).toBe("2026-10");
    expect(previa.corpo.afterCents - previa.corpo.beforeCents).toBe(150_000);

    expect((await linhaDa(pix))?.income_kind).toBeNull();
  });

  it("prévia de salário sem renda fixa válida dá 422 com o campo", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const pix = await criarPix(lar, 150_000);
    const app = appDoLar(lar);
    const r = await chamar(app, "POST", `/api/transactions/${pix}/income-classification/preview`, {
      option: "salario",
    });
    expect(r.status).toBe(422);
    expect(r.corpo.fields.fixedIncomeId).toBe("Escolha a renda fixa.");
    const sem = await chamar(app, "POST", `/api/transactions/${pix}/income-classification/preview`, {
      option: "variavel",
    });
    expect(sem.corpo.fields.incomeSubtype).toBe("Escolha o tipo de entrada.");
  });
});

describe("gravação (PUT)", () => {
  it("variável grava o tipo e a renda do ciclo sobe (cenário 1)", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const pix = await criarPix(lar, 150_000);
    const app = appDoLar(lar);
    const r = await chamar(app, "PUT", `/api/transactions/${pix}/income-classification`, {
      option: "variavel",
      incomeSubtype: "venda",
      remember: false,
    });
    expect(r.status).toBe(200);
    expect(r.corpo.classification).toEqual({
      option: "variavel",
      fixedIncomeId: null,
      incomeSubtype: "venda",
    });
    expect(r.corpo.rule).toBeNull();
    const linha = await linhaDa(pix);
    expect(linha?.income_kind).toBe("variavel");
    expect(linha?.income_subtype).toBe("venda");
    expect(linha?.categorized_by).toBe(lar.memberId);
    expect(r.corpo.cycleIncomeCents).toBe(150_000);
  });

  it("parte do salário cria o recebimento e some na renda, e volta a variável (cenário 5)", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const renda = await criarRenda(lar, "[TEST] Salário", 1_000_000);
    const pix = await criarPix(lar, 150_000);
    const app = appDoLar(lar);

    const salario = await chamar(app, "PUT", `/api/transactions/${pix}/income-classification`, {
      option: "salario",
      fixedIncomeId: renda,
      remember: false,
    });
    expect(salario.status).toBe(200);
    expect(
      await contar("SELECT COUNT(*) AS total FROM fixed_income_receipts WHERE transaction_id = ?", pix),
    ).toBe(1);
    expect((await linhaDa(pix))?.fixed_income_id).toBe(renda);
    expect(salario.corpo.cycleIncomeCents).toBe(150_000);

    const variavel = await chamar(app, "PUT", `/api/transactions/${pix}/income-classification`, {
      option: "variavel",
      incomeSubtype: "venda",
      remember: false,
    });
    expect(variavel.status).toBe(200);
    expect(
      await contar("SELECT COUNT(*) AS total FROM fixed_income_receipts WHERE transaction_id = ?", pix),
    ).toBe(0);
    expect((await linhaDa(pix))?.income_kind).toBe("variavel");
    expect(variavel.corpo.cycleIncomeCents).toBe(150_000);
  });

  it("reembolso oculta a transação com o motivo; trocar para venda tira a ocultação (cenário 3 e 5)", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const pix = await criarPix(lar, 150_000);
    const app = appDoLar(lar);

    await chamar(app, "PUT", `/api/transactions/${pix}/income-classification`, {
      option: "reembolso",
      remember: false,
    });
    let linha = await linhaDa(pix);
    expect(linha?.hidden).toBe(1);
    expect(linha?.hidden_reason).toBe("reembolso_terceiros");

    await chamar(app, "PUT", `/api/transactions/${pix}/income-classification`, {
      option: "variavel",
      incomeSubtype: "venda",
      remember: false,
    });
    linha = await linhaDa(pix);
    expect(linha?.hidden).toBe(0);
    expect(linha?.hidden_reason).toBeNull();
  });

  it("transferência não é renda e não fica oculta (cenário 4)", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const pix = await criarPix(lar, 150_000);
    const r = await chamar(appDoLar(lar), "PUT", `/api/transactions/${pix}/income-classification`, {
      option: "transferencia",
      remember: false,
    });
    expect(r.status).toBe(200);
    expect(r.corpo.cycleIncomeCents).toBe(0);
    const linha = await linhaDa(pix);
    expect(linha?.income_kind).toBe("transferencia");
    expect(linha?.hidden).toBe(0);
  });

  it("validações: salário sem renda, variável sem tipo, lembrar sem remetente (cenários 12, 13 e erros de campo)", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const pix = await criarPix(lar, 150_000);
    const semRemetente = await criarPix(lar, 90_000, null, { doc: null });
    const app = appDoLar(lar);

    const semRenda = await chamar(app, "PUT", `/api/transactions/${pix}/income-classification`, {
      option: "salario",
      remember: false,
    });
    expect(semRenda.status).toBe(422);
    expect(semRenda.corpo.fields.fixedIncomeId).toBe("Escolha a renda fixa.");

    const semTipo = await chamar(app, "PUT", `/api/transactions/${pix}/income-classification`, {
      option: "variavel",
      remember: false,
    });
    expect(semTipo.corpo.fields.incomeSubtype).toBe("Escolha o tipo de entrada.");

    const lembrarSem = await chamar(app, "PUT", `/api/transactions/${semRemetente}/income-classification`, {
      option: "reembolso",
      remember: true,
    });
    expect(lembrarSem.status).toBe(422);
    expect(lembrarSem.corpo.fields.remember).toBe("Este Pix não tem remetente para lembrar.");
  });

  it("lembrar: o Pix e os iguais da fila saem com o recebimento 'regra'; desligar o lembrar desativa a regra (cenários 6, 7 e 15)", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const renda = await criarRenda(lar, "[TEST] Salário em dólar", 1_100_000);
    const pix = await criarPix(lar, 150_000);
    const igual = await criarPix(lar, 200_000);
    const app = appDoLar(lar);

    const lembrado = await chamar(app, "PUT", `/api/transactions/${pix}/income-classification`, {
      option: "salario",
      fixedIncomeId: renda,
      remember: true,
    });
    expect(lembrado.status).toBe(200);
    expect(lembrado.corpo.rule.id).toBeTruthy();
    expect(lembrado.corpo.alsoResolved).toContain(igual);
    const linhaIgual = await linhaDa(igual);
    expect(linhaIgual?.income_kind).toBe("parte_salario");
    expect(linhaIgual?.categorized_by).toBe("regra");
    expect(
      await contar(
        "SELECT COUNT(*) AS total FROM fixed_income_receipts WHERE transaction_id = ? AND confirmed_by = 'regra'",
        igual,
      ),
    ).toBe(1);

    const regra = await env.DB.prepare("SELECT disabled_at, set_fixed_income_id FROM rules WHERE id = ?")
      .bind(lembrado.corpo.rule.id)
      .first<{ disabled_at: string | null; set_fixed_income_id: string }>();
    expect(regra?.disabled_at).toBeNull();
    expect(regra?.set_fixed_income_id).toBe(renda);

    const desligado = await chamar(app, "PUT", `/api/transactions/${pix}/income-classification`, {
      option: "variavel",
      incomeSubtype: "venda",
      remember: false,
    });
    expect(desligado.status).toBe(200);
    const depois = await env.DB.prepare("SELECT disabled_at FROM rules WHERE id = ?")
      .bind(lembrado.corpo.rule.id)
      .first<{ disabled_at: string | null }>();
    expect(depois?.disabled_at).not.toBeNull();
  });

  it("outro lar: prévia e gravação dão 404", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const pix = await criarPix(lar, 150_000);
    const outro = await criarOutroLar();
    const app = appDoLar(outro);
    expect(
      (
        await chamar(app, "POST", `/api/transactions/${pix}/income-classification/preview`, {
          option: "reembolso",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await chamar(app, "PUT", `/api/transactions/${pix}/income-classification`, {
          option: "reembolso",
          remember: false,
        })
      ).status,
    ).toBe(404);
  });
});
