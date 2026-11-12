import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/worker/app";
import { afterIngest } from "../../src/worker/bank/after-ingest";
import { createDb } from "../../src/worker/db/client";
import { newMeter } from "../../src/worker/db/metered-d1";
import type { AppEnv } from "../../src/worker/env";
import { computeCycleIncome } from "../../src/worker/income/cycle-income";
import { fillPendingFxRates } from "../../src/worker/income/fx";
import { aquecerOPortao, semearPronto } from "./helpers/app";
import { AGORA, criarLar, inserirTransacao, type Lar } from "./helpers/regras";

// Cotação de referência (TASK-0902): o cron que preenche o dia de referência. O Banco Central é falso em todos os testes
// (fetch injetado): nenhum teste fala com ele de verdade. Ciclo: hoje (10/11/2026) está em 2026-10; o anterior, em 2026-09.

beforeEach(async () => {
  await semearPronto(env.DB);
  await aquecerOPortao(createApp({}));
});

// biome-ignore lint/suspicious/noExplicitAny: corpo de resposta de teste, conferido pelas asserções
type Corpo = Record<string, any>;

const AGORA_DATE = new Date(AGORA);

// Resposta da PTAX na forma da API: uma cotação por dia útil, na venda.
function ptax(entradas: [string, number][]): Response {
  return new Response(
    JSON.stringify({
      value: entradas.map(([data, venda]) => ({
        cotacaoCompra: venda,
        cotacaoVenda: venda,
        dataHoraCotacao: `${data} 13:00:00.000`,
      })),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

// fetch falso: registra cada pedido e responde o que o teste disser.
function bcbFalso(responder: (url: string) => Response | Promise<Response>) {
  const chamadas: string[] = [];
  const fetchFalso = (async (url: string | URL | Request) => {
    chamadas.push(String(url));
    return responder(String(url));
  }) as unknown as typeof fetch;
  return { fetch: fetchFalso, chamadas };
}

const deps = (fetchFn: typeof fetch, agora = AGORA_DATE) => ({ now: agora, fetch: fetchFn });

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
  createApp({ resolveSession: async () => lar, agora: () => AGORA_DATE });

async function criarRendaEmDolar(lar: Lar, nome: string, texto: string | null): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO fixed_incomes (id, household_id, name, currency, amount_cents, usual_day, arrival, statement_text,
       kept_usd_is_investment, archived_at) VALUES (?, ?, ?, 'USD', 200000, 5, 'partes', ?, 1, NULL)`,
  )
    .bind(id, lar.householdId, nome, texto)
    .run();
  return id;
}

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

const cotacoesDoPar = (rendaId: string, ciclo: string) =>
  env.DB.prepare(
    "SELECT fx_rate, fx_date FROM fixed_income_receipts WHERE fixed_income_id = ? AND cycle_key = ?",
  )
    .bind(rendaId, ciclo)
    .all<{ fx_rate: number | null; fx_date: string | null }>();

const linhasDeCotacao = async (data: string) =>
  (
    await env.DB.prepare("SELECT rate FROM fx_rates WHERE currency = 'USD' AND date = ?")
      .bind(data)
      .all<{ rate: number }>()
  ).results;

describe("cenário 2: dólar em partes com o depósito de 4.000,00", () => {
  it("o cron busca a PTAX de 05/10 (5,50): previsto 11.000,00, trazido 4.000,00, ficou 7.000,00", async () => {
    const lar = await criarLar();
    await criarRendaEmDolar(lar, "[TEST] Salário em dólar", "[TEST] PAGADORA EXTERIOR");
    await entrarPeloExtrato(lar, "[TEST] PAGADORA EXTERIOR PAGAMENTO", 400000, "2026-10-05");

    const bcb = bcbFalso(() => ptax([["2026-10-05", 5.5]]));
    const resultado = await fillPendingFxRates(env, deps(bcb.fetch));
    expect(resultado).toMatchObject({ pendentes: 1, buscas: 1, preenchidos: 1 });
    expect(bcb.chamadas).toHaveLength(1);
    expect(await linhasDeCotacao("2026-10-05")).toEqual([{ rate: 55000 }]);

    const ciclo = await computeCycleIncome(createDb(env.DB, newMeter()), lar.householdId, "2026-09");
    expect(ciclo?.fixedIncomes[0]).toMatchObject({
      expectedBrlCents: 1100000,
      broughtCents: 400000,
      keptCents: 700000,
      fxPending: false,
      fx: { rateE4: 55000, rate: "5,50", date: "2026-10-05" },
    });

    // A tela (GET) mostra a cotação e o dólar convertido.
    const tela = await chamar(appDoLar(lar), "GET", "/api/fixed-incomes");
    expect(tela.corpo.fixedIncomes[0].lastFx).toEqual({ rateE4: 55000, rate: "5,50", date: "2026-10-05" });
    expect(tela.corpo.expectedPerCycle.usdInBrlCents).toBe(1100000);
  });

  it("com o Pix de 2.000,00 ligado à renda: trazido 6.000,00 e ficou 5.000,00", async () => {
    const lar = await criarLar();
    await criarRendaEmDolar(lar, "[TEST] Salário em dólar", "[TEST] PAGADORA EXTERIOR");
    await entrarPeloExtrato(lar, "[TEST] PAGADORA EXTERIOR PAGAMENTO", 400000, "2026-10-05");
    await entrarPeloExtrato(lar, "[TEST] PAGADORA EXTERIOR PIX AMIGO", 200000, "2026-10-06");
    await fillPendingFxRates(env, deps(bcbFalso(() => ptax([["2026-10-05", 5.5]])).fetch));
    const ciclo = await computeCycleIncome(createDb(env.DB, newMeter()), lar.householdId, "2026-09");
    expect(ciclo?.fixedIncomes[0]).toMatchObject({ broughtCents: 600000, keptCents: 500000 });
    expect(ciclo?.totalCents).toBe(1100000);
  });
});

describe("cenário 3: fim de semana", () => {
  it("domingo 01/11 usa a cotação de sexta 30/10", async () => {
    const lar = await criarLar();
    const rendaId = await criarRendaEmDolar(lar, "[TEST] Salário em dólar", "[TEST] PAGADORA EXTERIOR");
    const dom = await chamar(appDoLar(lar), "POST", `/api/fixed-incomes/${rendaId}/receipts`, {
      receivedOn: "2026-11-01",
      amountCents: 400000,
    });
    expect(dom.status).toBe(201);

    const bcb = bcbFalso(() => ptax([["2026-10-30", 5.4212]]));
    await fillPendingFxRates(env, deps(bcb.fetch));
    const linhas = await cotacoesDoPar(rendaId, "2026-10");
    expect(linhas.results).toEqual([{ fx_rate: 54212, fx_date: "2026-11-01" }]);
  });
});

describe("cenário 4: antes das 13h", () => {
  it("hoje sem PTAX não grava nada; depois da publicação, grava", async () => {
    const lar = await criarLar();
    const rendaId = await criarRendaEmDolar(lar, "[TEST] Salário em dólar", "[TEST] PAGADORA EXTERIOR");
    await chamar(appDoLar(lar), "POST", `/api/fixed-incomes/${rendaId}/receipts`, {
      receivedOn: "2026-11-10",
      amountCents: 400000,
    });

    const antes = await fillPendingFxRates(env, deps(bcbFalso(() => ptax([["2026-11-09", 5.5]])).fetch));
    expect(antes).toMatchObject({ pendentes: 1, buscas: 1, preenchidos: 0 });
    expect((await cotacoesDoPar(rendaId, "2026-10")).results).toEqual([{ fx_rate: null, fx_date: null }]);

    const depois = await fillPendingFxRates(env, deps(bcbFalso(() => ptax([["2026-11-10", 5.5]])).fetch));
    expect(depois.preenchidos).toBe(1);
    expect((await cotacoesDoPar(rendaId, "2026-10")).results).toEqual([
      { fx_rate: 55000, fx_date: "2026-11-10" },
    ]);
  });
});

describe("cenário 5: Banco Central fora", () => {
  it("erro, timeout ou JSON inválido não gravam nada; a renda conta o trazido; a execução seguinte tenta de novo", async () => {
    const lar = await criarLar();
    const rendaId = await criarRendaEmDolar(lar, "[TEST] Salário em dólar", "[TEST] PAGADORA EXTERIOR");
    await entrarPeloExtrato(lar, "[TEST] PAGADORA EXTERIOR PAGAMENTO", 400000, "2026-10-05");

    const erro = await fillPendingFxRates(env, deps(bcbFalso(() => new Response("", { status: 500 })).fetch));
    expect(erro.preenchidos).toBe(0);
    const estouro = await fillPendingFxRates(
      env,
      deps(bcbFalso(() => Promise.reject(new TypeError("falha de rede"))).fetch),
    );
    expect(estouro.preenchidos).toBe(0);
    const invalido = await fillPendingFxRates(
      env,
      deps(bcbFalso(() => new Response("não é json", { status: 200 })).fetch),
    );
    expect(invalido.preenchidos).toBe(0);
    expect(await linhasDeCotacao("2026-10-05")).toEqual([]);

    const ciclo = await computeCycleIncome(createDb(env.DB, newMeter()), lar.householdId, "2026-09");
    expect(ciclo?.fixedIncomes[0]).toMatchObject({ fxPending: true, broughtCents: 400000, keptCents: 0 });

    const seguinte = await fillPendingFxRates(env, deps(bcbFalso(() => ptax([["2026-10-05", 5.5]])).fetch));
    expect(seguinte.preenchidos).toBe(1);
    expect((await cotacoesDoPar(rendaId, "2026-09")).results).toEqual([
      { fx_rate: 55000, fx_date: "2026-10-05" },
    ]);
  });
});

describe("cenário 6: cotação guardada", () => {
  it("com a cotação de 05/10 já em fx_rates, não há chamada ao Banco Central", async () => {
    const lar = await criarLar();
    const rendaId = await criarRendaEmDolar(lar, "[TEST] Salário em dólar", "[TEST] PAGADORA EXTERIOR");
    await entrarPeloExtrato(lar, "[TEST] PAGADORA EXTERIOR PAGAMENTO", 400000, "2026-10-05");
    await env.DB.prepare(
      "INSERT INTO fx_rates (currency, date, rate, source) VALUES ('USD', '2026-10-05', 55000, 'bcb_ptax')",
    ).run();

    const bcb = bcbFalso(() => ptax([]));
    const resultado = await fillPendingFxRates(env, deps(bcb.fetch));
    expect(bcb.chamadas).toEqual([]);
    expect(resultado).toMatchObject({ buscas: 0, preenchidos: 1 });
    expect((await cotacoesDoPar(rendaId, "2026-09")).results).toEqual([
      { fx_rate: 55000, fx_date: "2026-10-05" },
    ]);
  });
});

describe("cenário 7: a referência muda", () => {
  it("um recebimento manual em 03/10 e depois o [TEST] PAGADORA EXTERIOR de 05/10: a cotação é refeita para 05/10", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const rendaId = await criarRendaEmDolar(lar, "[TEST] Salário em dólar", "[TEST] PAGADORA EXTERIOR");
    await chamar(app, "POST", `/api/fixed-incomes/${rendaId}/receipts`, {
      receivedOn: "2026-10-03",
      amountCents: 100000,
    });
    await fillPendingFxRates(env, deps(bcbFalso(() => ptax([["2026-10-03", 5.4]])).fetch));
    expect((await cotacoesDoPar(rendaId, "2026-09")).results[0]).toMatchObject({ fx_date: "2026-10-03" });

    await entrarPeloExtrato(lar, "[TEST] PAGADORA EXTERIOR PAGAMENTO", 400000, "2026-10-05");
    const bcb = bcbFalso(() => ptax([["2026-10-05", 5.5]]));
    await fillPendingFxRates(env, deps(bcb.fetch));
    const linhas = await cotacoesDoPar(rendaId, "2026-09");
    expect(linhas.results).toEqual([
      { fx_rate: 55000, fx_date: "2026-10-05" },
      { fx_rate: 55000, fx_date: "2026-10-05" },
    ]);
  });
});

describe("limite de buscas", () => {
  it("no máximo 2 chamadas ao Banco Central por execução; o par que sobra fica para a próxima", async () => {
    const lar = await criarLar();
    // Três rendas, cada uma com o recebimento num dia útil diferente: três pares sem cotação.
    const dias: [string, string][] = [
      ["[TEST] Um", "2026-10-05"],
      ["[TEST] Dois", "2026-10-06"],
      ["[TEST] Três", "2026-10-07"],
    ];
    for (const [nome, dia] of dias) {
      const rendaId = await criarRendaEmDolar(lar, nome, null);
      await chamar(appDoLar(lar), "POST", `/api/fixed-incomes/${rendaId}/receipts`, {
        receivedOn: dia,
        amountCents: 0,
      });
    }
    // Cada pedido responde só o dia que fecha a janela pedida: cada par precisa do seu próprio pedido.
    const bcb = bcbFalso((url) => {
      const fim = /dataFinalCotacao='(\d{2})-(\d{2})-(\d{4})'/.exec(url);
      const data = fim ? `${fim[3]}-${fim[1]}-${fim[2]}` : "2026-10-05";
      return ptax([[data, 5.5]]);
    });
    const resultado = await fillPendingFxRates(env, deps(bcb.fetch));
    expect(resultado).toMatchObject({ pendentes: 3, buscas: 2, preenchidos: 2 });
    expect(bcb.chamadas).toHaveLength(2);
  });
});

// Rodada 2 (TASK-0902): o cron lê o par inteiro, só aceita a resposta de sucesso, não busca dia futuro e conta no
// medidor de quem o chama. O Banco Central é falso.
describe("rodada 2: o cron lê o par inteiro (F1)", () => {
  it("um par com uma parte fora da janela de 100 dias não é buscado nem regravado", async () => {
    const lar = await criarLar();
    const rendaId = await criarRendaEmDolar(lar, "[TEST] Salário em dólar", "[TEST] PAGADORA EXTERIOR");
    await entrarPeloExtrato(lar, "[TEST] PAGADORA EXTERIOR PARTE 1", 400000, "2026-10-13");
    await entrarPeloExtrato(lar, "[TEST] PAGADORA EXTERIOR PARTE 2", 200000, "2026-10-27");
    // O dia de referência (13/10) já está nas duas partes, com a cotação dele.
    await env.DB.prepare(
      "UPDATE fixed_income_receipts SET fx_rate = 55000, fx_date = '2026-10-13' WHERE fixed_income_id = ?",
    )
      .bind(rendaId)
      .run();

    // 22/01/2027: 13/10 saiu da janela de 100 dias; 27/10 ainda está nela.
    const bcb = bcbFalso(() => ptax([["2026-10-27", 5.8]]));
    const resultado = await fillPendingFxRates(env, deps(bcb.fetch, new Date("2027-01-22T12:00:00Z")));

    expect(resultado.pendentes).toBe(0);
    expect(bcb.chamadas).toEqual([]);
    expect((await cotacoesDoPar(rendaId, "2026-10")).results).toEqual([
      { fx_rate: 55000, fx_date: "2026-10-13" },
      { fx_rate: 55000, fx_date: "2026-10-13" },
    ]);
  });
});

describe("rodada 2: a resposta do Banco Central só vale com status 200 (F6)", () => {
  it("status 404 com um corpo válido não grava cotação", async () => {
    const lar = await criarLar();
    const rendaId = await criarRendaEmDolar(lar, "[TEST] Salário em dólar", "[TEST] PAGADORA EXTERIOR");
    await entrarPeloExtrato(lar, "[TEST] PAGADORA EXTERIOR PAGAMENTO", 400000, "2026-10-05");
    const bcb = bcbFalso(
      () =>
        new Response(
          JSON.stringify({ value: [{ cotacaoVenda: 5.5, dataHoraCotacao: "2026-10-05 13:00:00.000" }] }),
          {
            status: 404,
            headers: { "content-type": "application/json" },
          },
        ),
    );

    const resultado = await fillPendingFxRates(env, deps(bcb.fetch));

    expect(resultado.preenchidos).toBe(0);
    expect(await linhasDeCotacao("2026-10-05")).toEqual([]);
    expect((await cotacoesDoPar(rendaId, "2026-09")).results).toEqual([{ fx_rate: null, fx_date: null }]);
  });
});

describe("rodada 2: um recebimento com dia futuro não é buscado (F6)", () => {
  it("não há par a buscar e o Banco Central não é chamado", async () => {
    const lar = await criarLar();
    const rendaId = await criarRendaEmDolar(lar, "[TEST] Salário em dólar", null);
    await env.DB.prepare(
      "INSERT INTO fixed_income_receipts (id, fixed_income_id, cycle_key, transaction_id, amount_cents, received_on, confirmed_by) VALUES (?, ?, '2026-10', NULL, 400000, '2026-11-11', 'pessoa')",
    )
      .bind(crypto.randomUUID(), rendaId)
      .run();

    const bcb = bcbFalso(() => ptax([["2026-11-11", 5.5]]));
    const resultado = await fillPendingFxRates(env, deps(bcb.fetch));

    expect(resultado.pendentes).toBe(0);
    expect(bcb.chamadas).toEqual([]);
  });
});

describe("rodada 2: a cotação usa o medidor de quem a chama, com 2 idas ao D1 (F6)", () => {
  it("com um par pendente são 2 idas: a leitura e a escrita", async () => {
    const lar = await criarLar();
    await criarRendaEmDolar(lar, "[TEST] Salário em dólar", "[TEST] PAGADORA EXTERIOR");
    await entrarPeloExtrato(lar, "[TEST] PAGADORA EXTERIOR PAGAMENTO", 400000, "2026-10-05");
    const medidor = newMeter();
    const bcb = bcbFalso(() => ptax([["2026-10-05", 5.5]]));

    await fillPendingFxRates(env, { ...deps(bcb.fetch), db: createDb(env.DB, medidor) });

    expect(medidor.calls).toBe(2);
  });

  it("sem nada pendente, é 1 ida: só a leitura", async () => {
    const medidor = newMeter();
    const bcb = bcbFalso(() => ptax([]));

    await fillPendingFxRates(env, { ...deps(bcb.fetch), db: createDb(env.DB, medidor) });

    expect(bcb.chamadas).toEqual([]);
    expect(medidor.calls).toBe(1);
  });
});
