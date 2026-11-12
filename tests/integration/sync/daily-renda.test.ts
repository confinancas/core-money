import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import { pluggyFalsoEmMemoria } from "../../../src/worker/dev/pluggy-fake-fetch";
import { computeCycleIncome } from "../../../src/worker/income/cycle-income";
import { addTransactionReceiptStmts } from "../../../src/worker/income/receipts";
import { startRun } from "../../../src/worker/sync/runs";
import { AGORA, type Banco, rodar, semearBanco, urlDe } from "./importacao-helpers";

// Renda do ciclo pelo caminho da sincronização diária (TASK-0205, item herdado da TASK-0902): uma entrada casada com a
// renda fixa volta do banco com o valor corrigido e a renda do ciclo muda; uma que some do banco sai da soma.
// Pluggy falso com as transações de cada conta; dados [TEST]; sem rede.

const DOZE_HORAS_UTC = "2026-11-10T12:00:00.000Z";
const TREZE_HORAS_UTC = "2026-11-10T13:00:00.000Z";
const DEZESSEIS_HORAS_UTC = "2026-11-10T16:00:00.000Z";

type Tx = { id: string; conta: string; data: string; valor: number };

// Mesmo formato do Pluggy que o pluggy-fake-fetch já usa; só as transações deste teste.
function pluggyComTransacoes(porConta: (conta: string) => Tx[]): typeof fetch {
  const base = pluggyFalsoEmMemoria(0);
  return async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlDe(entrada);
    if (url.pathname !== "/v2/transactions") return base(entrada, init);
    const de = url.searchParams.get("dateFrom") ?? "";
    const ate = url.searchParams.get("dateTo") ?? "";
    const results = porConta(url.searchParams.get("accountId") ?? "")
      .filter((tx) => tx.data >= de && tx.data <= ate)
      .map((tx) => ({
        id: tx.id,
        accountId: tx.conta,
        date: `${tx.data}T15:00:00.000Z`,
        description: `[TEST] ${tx.id}`,
        descriptionRaw: `[TEST] ${tx.id}`,
        amount: tx.valor,
        type: "CREDIT",
        category: "Salary",
        operationType: "PIX",
        paymentData: null,
        creditCardMetadata: null,
        status: "POSTED",
      }));
    return new Response(JSON.stringify({ results, next: null }), {
      headers: { "content-type": "application/json" },
    });
  };
}

// Renda fixa [TEST] do lar e o recebimento ligado à transação, pelo mesmo caminho que o extrato usa.
async function ligaRecebimento(
  banco: Banco,
  transacaoExterna: string,
  cicloDaTransacao: string,
): Promise<string> {
  const rendaId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO fixed_incomes (id, household_id, name, currency, amount_cents, usual_day, arrival, statement_text,
       kept_usd_is_investment, archived_at) VALUES (?, ?, '[TEST] Salário', 'BRL', 300000, 5, 'auto', NULL, 0, NULL)`,
  )
    .bind(rendaId, banco.householdId)
    .run();
  const transacao = await env.DB.prepare("SELECT id FROM transactions WHERE external_id = ?")
    .bind(transacaoExterna)
    .first<{ id: string }>();
  const db = createDb(env.DB, newMeter());
  await db.$client.batch(
    addTransactionReceiptStmts(db, banco.householdId, {
      receiptId: crypto.randomUUID(),
      fixedIncomeId: rendaId,
      cycleKey: cicloDaTransacao,
      transactionId: transacao?.id ?? "",
      receivedOn: "2026-11-05",
      amountCents: 300000,
      confirmedBy: "extrato",
      categorizedBy: "extrato",
      agora: AGORA,
    }),
  );
  return rendaId;
}

async function rendaDoCiclo(banco: Banco, cicloDaTransacao: string, rendaId: string) {
  const resposta = await computeCycleIncome(
    createDb(env.DB, newMeter()),
    banco.householdId,
    cicloDaTransacao,
  );
  const renda = resposta?.fixedIncomes.find((item) => item.id === rendaId);
  return {
    recebido: renda?.broughtCents ?? 0,
    recebimentos: renda?.receipts.length ?? 0,
    trazido: renda?.broughtCents ?? 0,
  };
}

// A entrada casada e uma outra transação na mesma janela: a leitura não fica vazia (a guarda de leitura vazia não entra).
const entrada = (conta: string, valor: number): Tx => ({
  id: "[TEST]-renda",
  conta,
  data: "2026-11-05",
  valor,
});
const outra = (conta: string): Tx => ({ id: "[TEST]-outra", conta, data: "2026-11-06", valor: -20 });

describe("renda do ciclo pela sincronização diária (TASK-0902, herdado)", () => {
  it("entrada casada volta com valor corrigido e muda a renda; uma que some do banco sai da soma", async () => {
    const banco = await semearBanco();
    const conta = `${banco.itemId}-corrente`;

    // Dia 1: a entrada de R$ 3.000,00 entra pela sincronização.
    const primeira = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "diaria",
      DOZE_HORAS_UTC,
    )) as string;
    await rodar(
      primeira,
      pluggyComTransacoes((c) => (c === conta ? [entrada(conta, 3000), outra(conta)] : [])),
      0,
      1,
      DOZE_HORAS_UTC,
    );
    const linha = await env.DB.prepare("SELECT cycle_key FROM transactions WHERE external_id = ?")
      .bind("[TEST]-renda")
      .first<{ cycle_key: string }>();
    const ciclo = linha?.cycle_key ?? "";
    expect(ciclo).not.toBe("");

    const rendaId = await ligaRecebimento(banco, "[TEST]-renda", ciclo);
    expect((await rendaDoCiclo(banco, ciclo, rendaId)).recebido).toBe(300000);

    // Dia 2: o banco devolve a mesma entrada com R$ 3.100,00. A renda do ciclo acompanha o valor atual.
    const segunda = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "diaria",
      TREZE_HORAS_UTC,
    )) as string;
    await rodar(
      segunda,
      pluggyComTransacoes((c) => (c === conta ? [entrada(conta, 3100), outra(conta)] : [])),
      0,
      1,
      TREZE_HORAS_UTC,
    );
    expect((await rendaDoCiclo(banco, ciclo, rendaId)).recebido).toBe(310000);

    // Dia 3: a entrada some do banco. A leitura da janela não traz nada: o recebimento deixa de contar.
    const terceira = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "diaria",
      DEZESSEIS_HORAS_UTC,
    )) as string;
    await rodar(
      terceira,
      pluggyComTransacoes((c) => (c === conta ? [outra(conta)] : [])),
      0,
      1,
      DEZESSEIS_HORAS_UTC,
    );
    expect(await rendaDoCiclo(banco, ciclo, rendaId)).toEqual({ recebido: 0, recebimentos: 0, trazido: 0 });
    const marcada = await env.DB.prepare("SELECT removed_at FROM transactions WHERE external_id = ?")
      .bind("[TEST]-renda")
      .first<{ removed_at: string | null }>();
    expect(marcada?.removed_at).toBe(DEZESSEIS_HORAS_UTC);
  });
});
