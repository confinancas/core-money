import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { establishmentKey } from "../../../src/shared/establishment-key";
import { reavaliarCartaoInteiro } from "../../../src/worker/bank/after-ingest";
import type { BillRow, MappedTransaction } from "../../../src/worker/bank/map";
import {
  ingestTransactions,
  upsertAccountsStmts,
  upsertBillsStmts,
  upsertCardsStmts,
} from "../../../src/worker/bank/repository";
import { ensureCalendar } from "../../../src/worker/cycle/calendar";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";

// TASK-0204, B1-2 (e o item 3 da TASK-0801): a gravação não relê o cartão inteiro, e a reavaliação do cartão inteiro
// custa uma vez por execução. Cartão com 13 faturas reais e a aberta, como na avaliação da Fable.

const AGORA = "2026-11-10T12:00:00.000Z";
const DEPOIS = "2026-11-10T13:00:00.000Z";
const FECHAMENTOS = Array.from({ length: 13 }, (_, i) =>
  new Date(Date.UTC(2025, 10 + i, 3)).toISOString().slice(0, 10),
);
const ABERTA_FECHA = "2026-12-03";

const dias = (base: string, n: number): string =>
  new Date(Date.parse(`${base}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const faturaReal = (fecha: string): BillRow => ({
  id: `[TEST] fatura-${fecha}`,
  closes_on: fecha,
  due_on: dias(fecha, 7),
  amount_cents: 100000,
  status: "fechada",
  paid_on: null,
});

const faturaDaData = (data: string, cartaoId: string): string => {
  const real = FECHAMENTOS.find((fecha) => fecha >= data);
  return real ? `[TEST] fatura-${real}` : `sint:${cartaoId}:${ABERTA_FECHA}`;
};

type Lar = { householdId: string; itemId: string; contaId: string; cartaoId: string; connectionId: string };

async function criarLarDireto(): Promise<Lar> {
  const householdId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const contaId = crypto.randomUUID();
  const cartaoId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO households (id, brand, created_at) VALUES (?, 'matrimoney', ?)").bind(
      householdId,
      AGORA,
    ),
    env.DB.prepare(
      "INSERT INTO pluggy_connections (id, household_id, label, created_at) VALUES (?, ?, '[TEST] Conexão', ?)",
    ).bind(connectionId, householdId, AGORA),
    env.DB.prepare(
      "INSERT INTO bank_items (id, connection_id, institution_name, created_at) VALUES (?, ?, '[TEST] Banco', ?)",
    ).bind(itemId, connectionId, AGORA),
  ]);
  const db = createDb(env.DB, newMeter());
  await db.$client.batch([
    ...upsertAccountsStmts(
      db,
      itemId,
      [{ id: contaId, kind: "corrente", name: "[TEST] Conta", balance_cents: 0, overdraft_used_cents: 0 }],
      AGORA,
    ),
    ...upsertCardsStmts(db, itemId, [
      { id: cartaoId, last4: "1234", name: "[TEST] Cartão", limit_cents: 500000, available_cents: 400000 },
    ]),
  ]);
  await ensureCalendar(db, householdId, "2025-01-01", "2027-12-31");
  const aberta: BillRow = {
    id: `sint:${cartaoId}:${ABERTA_FECHA}`,
    closes_on: ABERTA_FECHA,
    due_on: dias(ABERTA_FECHA, 7),
    amount_cents: 12000,
    status: "aberta",
    paid_on: null,
  };
  await db.$client.batch(upsertBillsStmts(db, { id: cartaoId }, FECHAMENTOS.map(faturaReal), aberta));
  return { householdId, itemId, contaId, cartaoId, connectionId };
}

const linhaCartao = (
  lar: Lar,
  ext: string,
  data: string,
  valor: number,
  descricao: string,
): MappedTransaction => ({
  external_id: ext,
  account_id: null,
  card_id: lar.cartaoId,
  bill_id: faturaDaData(data, lar.cartaoId),
  futura: null,
  movement: "compra",
  occurred_at: `${data}T12:00:00.000Z`,
  local_date: data,
  amount_cents: valor,
  original_description: descricao,
  establishment_key: establishmentKey(descricao),
  counterparty_name: null,
  counterparty_doc_masked: null,
  counterparty_bank: null,
  installment_number: null,
  installment_total: null,
  provider_category: null,
  provider_operation_type: null,
});

const linhaConta = (
  lar: Lar,
  ext: string,
  data: string,
  valor: number,
  descricao: string,
): MappedTransaction => ({
  external_id: ext,
  account_id: lar.contaId,
  card_id: null,
  bill_id: null,
  futura: null,
  movement: "debito",
  occurred_at: `${data}T12:00:00.000Z`,
  local_date: data,
  amount_cents: valor,
  original_description: descricao,
  establishment_key: establishmentKey(descricao),
  counterparty_name: null,
  counterparty_doc_masked: null,
  counterparty_bank: null,
  installment_number: null,
  installment_total: null,
  provider_category: null,
  provider_operation_type: "CARTAO",
});

// Histórico do cartão: datas de 2025-10-04 a 2026-10-18, longe da janela das linhas recentes (que ficam em novembro).
const historico = (lar: Lar, n: number): MappedTransaction[] =>
  Array.from({ length: n }, (_, k) =>
    linhaCartao(
      lar,
      `[TEST] hist-${k}`,
      dias("2025-10-04", k % 380),
      -(1000 + (k % 500)),
      `[TEST] Loja ${k % 37}`,
    ),
  );

// Recentes: 2026-11-04 a 11-09, na aberta. São as linhas que a gravação reimporta e a janela de classificação lê.
const recentes = (lar: Lar): MappedTransaction[] =>
  Array.from({ length: 20 }, (_, k) =>
    linhaCartao(lar, `[TEST] recente-${k}`, dias("2026-11-04", k % 6), -(2000 + k), `[TEST] Recente ${k}`),
  );

async function gravarEmJanelas(lar: Lar, linhas: MappedTransaction[], medidor = newMeter()): Promise<void> {
  const db = createDb(env.DB, medidor);
  for (let i = 0; i < linhas.length; i += 200) {
    await ingestTransactions(db, {
      householdId: lar.householdId,
      bankItemId: lar.itemId,
      rows: linhas.slice(i, i + 200),
      now: AGORA,
    });
  }
}

// A gravação de 30 linhas do estado estável: 20 reimportadas (iguais) e 10 novas, todas na aberta.
async function gravacaoDe30(
  lar: Lar,
  recentesJa: MappedTransaction[],
): Promise<{ lidas: number; escritas: number }> {
  const novas = Array.from({ length: 10 }, (_, k) =>
    linhaCartao(lar, `[TEST] nova-${k}`, dias("2026-11-04", k % 6), -(3000 + k), `[TEST] Nova ${k}`),
  );
  const medidor = newMeter();
  await ingestTransactions(createDb(env.DB, medidor), {
    householdId: lar.householdId,
    bankItemId: lar.itemId,
    rows: [...recentesJa, ...novas],
    now: DEPOIS,
  });
  return { lidas: medidor.rowsRead, escritas: medidor.rowsWritten };
}

describe("gravação: não relê o cartão inteiro (TASK-0204, B1-2)", () => {
  it("30 linhas gravadas com cartão de 500, 2.000 e 5.000 lançamentos: as leituras não crescem com o cartão", async () => {
    const medidas: { total: number; lidas: number; escritas: number }[] = [];
    for (const total of [500, 2000, 5000]) {
      const lar = await criarLarDireto();
      const recentesLista = recentes(lar);
      await gravarEmJanelas(lar, [...historico(lar, total - 20), ...recentesLista]);
      const medida = await gravacaoDe30(lar, recentesLista);
      medidas.push({ total, ...medida });
    }
    console.info(`[medicao-b1-2] ${JSON.stringify(medidas)}`);

    // Antes da mudança: 6.270, 21.270 e 51.270 lidas (cerca de 10 por lançamento do cartão). Depois: a mesma, nos três.
    for (const medida of medidas) expect(medida.lidas).toBeLessThanOrEqual(1500);
    expect(medidas[2]?.lidas).toBeLessThanOrEqual((medidas[0]?.lidas ?? 0) * 1.2);
    // A escrita não depende do tamanho do cartão: as mesmas linhas, nos três cartões.
    expect(new Set(medidas.map((medida) => medida.escritas)).size).toBe(1);
  }, 120_000);
});

describe("reavaliação do cartão inteiro (TASK-0204, B1-2: uma vez por execução)", () => {
  it("reavaliar um cartão de 5.000 lançamentos lê cerca de 12 linhas por lançamento, e só essa vez", async () => {
    const lar = await criarLarDireto();
    const recentesLista = recentes(lar);
    await gravarEmJanelas(lar, [...historico(lar, 4980), ...recentesLista]);

    const medidor = newMeter();
    await reavaliarCartaoInteiro(createDb(env.DB, medidor), lar.householdId, lar.cartaoId);
    console.info(`[medicao-b1-2-reavaliacao] cartao 5.000: lidas=${medidor.rowsRead}`);
    expect(medidor.rowsRead).toBeLessThanOrEqual(12 * 5000);
  }, 120_000);
});

describe("importação inteira de um banco: conta e cartão, 2.000 transações em janelas de 200", () => {
  it("lê e escreve por transação dentro do medido", async () => {
    const lar = await criarLarDireto();
    const linhas: MappedTransaction[] = [];
    for (let k = 0; k < 1400; k++) {
      const data = dias("2025-10-04", (k * 7) % 380);
      linhas.push(
        linhaCartao(lar, `[TEST] imp-c-${k}`, data, -(1100 + (k % 400)), `[TEST] Imp Loja ${k % 53}`),
      );
    }
    for (let k = 0; k < 600; k++) {
      const data = dias("2025-11-01", (k * 5) % 370);
      linhas.push(
        linhaConta(lar, `[TEST] imp-a-${k}`, data, -(900 + (k % 300)), `[TEST] Imp Debito ${k % 41}`),
      );
    }
    linhas.sort((a, b) => (a.local_date < b.local_date ? 1 : a.local_date > b.local_date ? -1 : 0));

    const medidor = newMeter();
    await gravarEmJanelas(lar, linhas, medidor);
    // A reavaliação do cartão, uma vez, depois das janelas (a fase de faturas faz o mesmo no início da execução).
    await reavaliarCartaoInteiro(createDb(env.DB, medidor), lar.householdId, lar.cartaoId);
    console.info(
      `[medicao-b1-2-importacao] lidas=${medidor.rowsRead} escritas=${medidor.rowsWritten} chamadas=${medidor.calls} linhas=${linhas.length}`,
    );
    expect(medidor.rowsWritten / linhas.length).toBeLessThanOrEqual(13.5);
    expect(medidor.rowsRead / linhas.length).toBeLessThanOrEqual(45);
  }, 120_000);
});

// D1 que anota o SQL e os parâmetros de cada comando preparado e executa tudo no D1 de teste (sem mudar o que roda).
type Captura = { sql: string; params: unknown[] };
function d1Gravador(registro: Captura[]): D1Database {
  const d1 = env.DB;
  return {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => {
        registro.push({ sql, params });
        return d1.prepare(sql).bind(...params);
      },
    }),
    batch: (comandos: D1PreparedStatement[]) => d1.batch(comandos),
  } as unknown as D1Database;
}

describe("planos de consulta: a gravação e a reavaliação não varrem a tabela de lançamentos", () => {
  it("nenhum comando da gravação de 200 linhas nem da reavaliação do cartão faz SCAN de transactions", async () => {
    const lar = await criarLarDireto();
    await gravarEmJanelas(lar, [...historico(lar, 1000), ...recentes(lar)]);
    const registro: Captura[] = [];
    const db = createDb(d1Gravador(registro), newMeter());
    const linhas = Array.from({ length: 200 }, (_, k) =>
      linhaCartao(lar, `[TEST] plano-${k}`, dias("2026-11-04", k % 6), -(4000 + k), `[TEST] Plano ${k}`),
    );
    await ingestTransactions(db, {
      householdId: lar.householdId,
      bankItemId: lar.itemId,
      rows: linhas,
      now: DEPOIS,
    });
    await reavaliarCartaoInteiro(db, lar.householdId, lar.cartaoId);

    const violacoes: string[] = [];
    for (const { sql, params } of registro) {
      const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .bind(...params)
        .all<{ detail: string }>();
      for (const passo of results) {
        if (/^SCAN (transactions|t|x|y)\b/.test(passo.detail)) {
          violacoes.push(`${sql.replace(/\s+/g, " ").slice(0, 80)} => ${passo.detail}`);
        }
      }
    }
    expect(registro.length).toBeGreaterThan(0);
    expect(violacoes).toEqual([]);
  }, 120_000);
});
