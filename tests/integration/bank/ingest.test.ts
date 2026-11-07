import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { afterIngest } from "../../../src/worker/bank/after-ingest";
import type { BillRow, MappedTransaction } from "../../../src/worker/bank/map";
import {
  ingestTransactions,
  upsertAccountsStmts,
  upsertBillsStmts,
  upsertCardsStmts,
} from "../../../src/worker/bank/repository";
import { createDb, type Db } from "../../../src/worker/db/client";
import { type Meter, newMeter } from "../../../src/worker/db/metered-d1";

// afterIngest continua real; o espião só registra com que argumentos a gravação o chamou.
vi.mock("../../../src/worker/bank/after-ingest", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/worker/bank/after-ingest")>();
  return { ...original, afterIngest: vi.fn(original.afterIngest) };
});

const AGORA = "2026-11-10T12:00:00.000Z";
const DEPOIS = "2026-11-10T13:00:00.000Z";

// Um Db com medidor próprio: cada teste mede só a chamada que quer medir.
const dbComMedidor = (medidor: Meter = newMeter()): Db => createDb(env.DB, medidor);

async function criarLar(): Promise<{ householdId: string; connectionId: string }> {
  const householdId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO households (id, brand, created_at) VALUES (?, 'matrimoney', ?)").bind(
      householdId,
      AGORA,
    ),
    env.DB.prepare(
      "INSERT INTO pluggy_connections (id, household_id, label, created_at) VALUES (?, ?, '[TEST] Conexão', ?)",
    ).bind(connectionId, householdId, AGORA),
  ]);
  return { householdId, connectionId };
}

async function criarItem(connectionId: string, nome = "[TEST] Banco"): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO bank_items (id, connection_id, institution_name, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, connectionId, nome, AGORA)
    .run();
  return id;
}

async function criarConta(db: Db, bankItemId: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.$client.batch(
    upsertAccountsStmts(
      db,
      bankItemId,
      [
        {
          id,
          kind: "corrente",
          name: "[TEST] Conta corrente",
          balance_cents: 100000,
          overdraft_used_cents: 0,
        },
      ],
      AGORA,
    ),
  );
  return id;
}

// Cartão com a aberta sintética fechando em 03/11.
async function criarCartao(db: Db, bankItemId: string): Promise<{ cardId: string; aberta: BillRow }> {
  const cardId = crypto.randomUUID();
  await db.$client.batch(
    upsertCardsStmts(db, bankItemId, [
      {
        id: cardId,
        last4: "1234",
        name: "[TEST] Cartão",
        limit_cents: 500000,
        available_cents: 400000,
      },
    ]),
  );
  const aberta: BillRow = {
    id: `sint:${cardId}:2026-11-03`,
    closes_on: "2026-11-03",
    due_on: "2026-11-10",
    amount_cents: 12000,
    status: "aberta",
    paid_on: null,
  };
  await db.$client.batch(upsertBillsStmts(db, { id: cardId }, [], aberta));
  return { cardId, aberta };
}

// Uma linha completa. A conta ou o cartão vêm do teste (a regra do banco exige um dos dois).
const linha = (extra: Partial<MappedTransaction> = {}): MappedTransaction => ({
  external_id: `[TEST] ext-${crypto.randomUUID()}`,
  account_id: null,
  card_id: null,
  bill_id: null,
  futura: null,
  movement: "pix_enviado",
  occurred_at: "2026-11-09T14:00:00.000Z",
  local_date: "2026-11-09",
  amount_cents: -1500,
  original_description: "[TEST] Pix enviado",
  establishment_key: "[TEST] PIX ENVIADO",
  counterparty_name: "[TEST] Recebedor",
  counterparty_doc_masked: "***.456.789-**",
  counterparty_bank: "Itaú",
  installment_number: null,
  installment_total: null,
  provider_category: null,
  provider_operation_type: "PIX",
  ...extra,
});

const contar = async (sql: string, ...valores: unknown[]): Promise<number> => {
  const linhaContada = await env.DB.prepare(sql)
    .bind(...valores)
    .first<{ total: number }>();
  return linhaContada?.total ?? 0;
};

beforeEach(() => {
  vi.mocked(afterIngest).mockClear();
});

describe("ingestTransactions: idempotência", () => {
  it("7. a mesma página gravada duas vezes não muda o número de linhas", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId);
    const db = dbComMedidor();
    const contaId = await criarConta(db, itemId);
    const pagina = [
      linha({ account_id: contaId, external_id: "[TEST] ext-a" }),
      linha({ account_id: contaId, external_id: "[TEST] ext-b", amount_cents: -2000 }),
      linha({
        account_id: contaId,
        external_id: "[TEST] ext-c",
        amount_cents: 300,
        movement: "pix_recebido",
      }),
    ];

    const primeira = await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: pagina,
      now: AGORA,
    });
    const segunda = await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: pagina,
      now: DEPOIS,
    });

    expect(primeira.insertedIds).toHaveLength(3);
    expect(primeira.updatedIds).toEqual([]);
    expect(segunda.insertedIds).toEqual([]);
    expect(segunda.updatedIds.sort()).toEqual([...primeira.insertedIds].sort());
    expect(await contar("SELECT COUNT(*) AS total FROM transactions WHERE bank_item_id = ?", itemId)).toBe(3);
  });

  it("um external_id repetido na mesma página vale a última ocorrência", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId);
    const db = dbComMedidor();
    const contaId = await criarConta(db, itemId);

    const resultado = await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [
        linha({ account_id: contaId, external_id: "[TEST] ext-rep", amount_cents: -100 }),
        linha({ account_id: contaId, external_id: "[TEST] ext-rep", amount_cents: -999 }),
      ],
      now: AGORA,
    });

    expect(resultado.insertedIds).toHaveLength(1);
    const gravada = await env.DB.prepare("SELECT amount_cents FROM transactions WHERE bank_item_id = ?")
      .bind(itemId)
      .first<{ amount_cents: number }>();
    expect(gravada?.amount_cents).toBe(-999);
  });
});

describe("ingestTransactions: o que o casal fez fica", () => {
  it("8. descrição e chave mudam; apelido, categoria e ocultação ficam", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId);
    const db = dbComMedidor();
    const contaId = await criarConta(db, itemId);
    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [linha({ account_id: contaId, external_id: "[TEST] ext-casal" })],
      now: AGORA,
    });
    await env.DB.prepare(
      "UPDATE transactions SET custom_name = '[TEST] Apelido', category_id = '[TEST] cat-mercado', hidden = 1, hidden_reason = 'gasto_terceiros' WHERE external_id = ?",
    )
      .bind("[TEST] ext-casal")
      .run();

    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [
        linha({
          account_id: contaId,
          external_id: "[TEST] ext-casal",
          original_description: "[TEST] Pix novo texto",
          establishment_key: "[TEST] PIX NOVO TEXTO",
        }),
      ],
      now: DEPOIS,
    });

    const depois = await env.DB.prepare(
      "SELECT original_description, establishment_key, custom_name, category_id, hidden, hidden_reason FROM transactions WHERE external_id = ?",
    )
      .bind("[TEST] ext-casal")
      .first();
    expect(depois).toEqual({
      original_description: "[TEST] Pix novo texto",
      establishment_key: "[TEST] PIX NOVO TEXTO",
      custom_name: "[TEST] Apelido",
      category_id: "[TEST] cat-mercado",
      hidden: 1,
      hidden_reason: "gasto_terceiros",
    });
  });

  it("nenhum campo do casal da lista 'nunca toca' muda numa reimportação", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId);
    const db = dbComMedidor();
    const contaId = await criarConta(db, itemId);
    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [linha({ account_id: contaId, external_id: "[TEST] ext-todos", movement: "pix_enviado" })],
      now: AGORA,
    });
    // Valores do casal, todos diferentes do que o mapeamento grava.
    await env.DB.prepare(
      `UPDATE transactions SET
        movement = 'ted_recebida', movement_original = 'compra', movement_locked = 1,
        custom_name = '[TEST] Apelido', category_id = '[TEST] cat-1', spend_type = 'conforto',
        spend_type_source = 'escolhido', hidden = 1, hidden_reason = 'reembolso_terceiros',
        income_kind = 'variavel', income_subtype = 'venda', fixed_income_id = '[TEST] renda-1',
        card_would_accept = 1, ai_category_id = '[TEST] ia-cat', ai_income_kind = 'parte_salario',
        ai_income_subtype = 'cashback', ai_fixed_income_id = '[TEST] ia-renda', ai_confidence = 'alta',
        ai_reason = '[TEST] motivo', categorized_at = '2026-11-09T20:00:00.000Z', categorized_by = 'regra',
        rule_id = '[TEST] regra-1', cycle_key = '2026-11', fixed_bill_id = '[TEST] conta-fixa',
        is_backfill = 1, pix_key_masked = '***.***'
      WHERE external_id = ?`,
    )
      .bind("[TEST] ext-todos")
      .run();

    // A mesma linha, agora com outros valores vindos do banco em todos os campos que o banco manda.
    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [
        linha({
          account_id: contaId,
          external_id: "[TEST] ext-todos",
          movement: "pix_enviado",
          amount_cents: -9999,
          counterparty_name: "[TEST] Outro",
          installment_number: 2,
          installment_total: 5,
        }),
      ],
      now: DEPOIS,
    });

    const depois = await env.DB.prepare(
      `SELECT movement, movement_original, movement_locked, custom_name, category_id, spend_type,
        spend_type_source, hidden, hidden_reason, income_kind, income_subtype, fixed_income_id,
        card_would_accept, ai_category_id, ai_income_kind, ai_income_subtype, ai_fixed_income_id,
        ai_confidence, ai_reason, categorized_at, categorized_by, rule_id, cycle_key, fixed_bill_id,
        is_backfill, pix_key_masked, household_id, bank_item_id, amount_cents, counterparty_name,
        installment_number, installment_total
       FROM transactions WHERE external_id = ?`,
    )
      .bind("[TEST] ext-todos")
      .first();
    expect(depois).toEqual({
      movement: "ted_recebida",
      movement_original: "compra",
      movement_locked: 1,
      custom_name: "[TEST] Apelido",
      category_id: "[TEST] cat-1",
      spend_type: "conforto",
      spend_type_source: "escolhido",
      hidden: 1,
      hidden_reason: "reembolso_terceiros",
      income_kind: "variavel",
      income_subtype: "venda",
      fixed_income_id: "[TEST] renda-1",
      card_would_accept: 1,
      ai_category_id: "[TEST] ia-cat",
      ai_income_kind: "parte_salario",
      ai_income_subtype: "cashback",
      ai_fixed_income_id: "[TEST] ia-renda",
      ai_confidence: "alta",
      ai_reason: "[TEST] motivo",
      categorized_at: "2026-11-09T20:00:00.000Z",
      categorized_by: "regra",
      rule_id: "[TEST] regra-1",
      cycle_key: "2026-11",
      fixed_bill_id: "[TEST] conta-fixa",
      is_backfill: 1,
      pix_key_masked: "***.***",
      household_id: householdId,
      bank_item_id: itemId,
      // O que vem do banco muda de verdade, para o teste provar que a linha foi atualizada.
      amount_cents: -9999,
      counterparty_name: "[TEST] Outro",
      installment_number: 2,
      installment_total: 5,
    });
  });
});

describe("ingestTransactions: reaparecimento e fatura", () => {
  it("9. linha com removed_at que volta numa página perde o removed_at", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId);
    const db = dbComMedidor();
    const contaId = await criarConta(db, itemId);
    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [linha({ account_id: contaId, external_id: "[TEST] ext-volta" })],
      now: AGORA,
    });
    await env.DB.prepare("UPDATE transactions SET removed_at = ? WHERE external_id = ?")
      .bind(AGORA, "[TEST] ext-volta")
      .run();

    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [linha({ account_id: contaId, external_id: "[TEST] ext-volta" })],
      now: DEPOIS,
    });

    const linhaGravada = await env.DB.prepare(
      "SELECT removed_at, last_seen_at FROM transactions WHERE external_id = ?",
    )
      .bind("[TEST] ext-volta")
      .first<{ removed_at: string | null; last_seen_at: string }>();
    expect(linhaGravada).toEqual({ removed_at: null, last_seen_at: DEPOIS });
  });

  it("10. a fatura real que fecha depois leva as compras da sintética e a sintética some", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId);
    const db = dbComMedidor();
    const { cardId, aberta } = await criarCartao(db, itemId);
    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [
        linha({
          card_id: cardId,
          bill_id: aberta.id,
          external_id: "[TEST] ext-c1",
          local_date: "2026-10-28",
        }),
        linha({
          card_id: cardId,
          bill_id: aberta.id,
          external_id: "[TEST] ext-c2",
          local_date: "2026-10-30",
        }),
      ],
      now: AGORA,
    });

    const real: BillRow = {
      id: "[TEST] fatura-real-nov",
      closes_on: "2026-11-04",
      due_on: "2026-11-11",
      amount_cents: 12000,
      status: "fechada",
      paid_on: null,
    };
    const novaAberta: BillRow = {
      id: `sint:${cardId}:2026-12-03`,
      closes_on: "2026-12-03",
      due_on: "2026-12-10",
      amount_cents: 0,
      status: "aberta",
      paid_on: null,
    };
    await db.$client.batch(upsertBillsStmts(db, { id: cardId }, [real], novaAberta));

    const compras = await env.DB.prepare(
      "SELECT bill_id FROM transactions WHERE card_id = ? ORDER BY external_id",
    )
      .bind(cardId)
      .all<{ bill_id: string }>();
    expect(compras.results.map((compra) => compra.bill_id)).toEqual([real.id, real.id]);
    expect(await contar("SELECT COUNT(*) AS total FROM bills WHERE id = ?", aberta.id)).toBe(0);
    expect(
      await contar("SELECT COUNT(*) AS total FROM bills WHERE id = ? AND status = 'aberta'", novaAberta.id),
    ).toBe(1);
    expect(
      await contar("SELECT COUNT(*) AS total FROM bills WHERE id = ? AND status = 'fechada'", real.id),
    ).toBe(1);
  });

  it("a aberta antiga que não virou real fica fechada, não some", async () => {
    const { connectionId } = await criarLar();
    const itemId = await criarItem(connectionId);
    const db = dbComMedidor();
    const { cardId, aberta } = await criarCartao(db, itemId);
    const novaAberta: BillRow = {
      id: `sint:${cardId}:2026-12-03`,
      closes_on: "2026-12-03",
      due_on: "2026-12-10",
      amount_cents: 0,
      status: "aberta",
      paid_on: null,
    };

    await db.$client.batch(upsertBillsStmts(db, { id: cardId }, [], novaAberta));

    expect(
      await contar("SELECT COUNT(*) AS total FROM bills WHERE id = ? AND status = 'fechada'", aberta.id),
    ).toBe(1);
  });
});

describe("ingestTransactions: isolamento e futura", () => {
  it("11. o mesmo external_id em dois itens são duas linhas", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemA = await criarItem(connectionId, "[TEST] Banco A");
    const itemB = await criarItem(connectionId, "[TEST] Banco B");
    const db = dbComMedidor();
    const contaA = await criarConta(db, itemA);
    const contaB = await criarConta(db, itemB);

    const a = await ingestTransactions(db, {
      householdId,
      bankItemId: itemA,
      rows: [linha({ account_id: contaA, external_id: "[TEST] ext-igual" })],
      now: AGORA,
    });
    const b = await ingestTransactions(db, {
      householdId,
      bankItemId: itemB,
      rows: [linha({ account_id: contaB, external_id: "[TEST] ext-igual" })],
      now: AGORA,
    });

    expect(a.insertedIds).toHaveLength(1);
    expect(b.insertedIds).toHaveLength(1);
    expect(
      await contar("SELECT COUNT(*) AS total FROM transactions WHERE external_id = ?", "[TEST] ext-igual"),
    ).toBe(2);
  });

  it("a fatura futura que a linha pede é criada antes dos movimentos, e uma vez só", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId);
    const db = dbComMedidor();
    const { cardId, aberta } = await criarCartao(db, itemId);
    const futuraId = `sint:${cardId}:2026-12-03`;
    const comFutura = (externalId: string) =>
      linha({
        card_id: cardId,
        bill_id: futuraId,
        external_id: externalId,
        futura: { id: futuraId, card_id: cardId, closes_on: "2026-12-03" },
      });

    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [comFutura("[TEST] ext-f1"), comFutura("[TEST] ext-f2")],
      now: AGORA,
    });
    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [comFutura("[TEST] ext-f3")],
      now: DEPOIS,
    });

    expect(
      await env.DB.prepare("SELECT status, closes_on FROM bills WHERE id = ?").bind(futuraId).first(),
    ).toEqual({ status: "futura", closes_on: "2026-12-03" });
    expect(await contar("SELECT COUNT(*) AS total FROM bills WHERE id = ?", aberta.id)).toBe(1);
  });
});

describe("ingestTransactions: afterIngest e limites", () => {
  it("afterIngest recebe só os inseridos em insertedIds, e os atualizados em updatedIds", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId);
    const db = dbComMedidor();
    const contaId = await criarConta(db, itemId);
    const existente = await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [linha({ account_id: contaId, external_id: "[TEST] ext-antiga" })],
      now: AGORA,
    });
    vi.mocked(afterIngest).mockClear();

    const resultado = await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [
        linha({ account_id: contaId, external_id: "[TEST] ext-antiga" }),
        linha({ account_id: contaId, external_id: "[TEST] ext-nova" }),
      ],
      now: DEPOIS,
    });

    expect(vi.mocked(afterIngest)).toHaveBeenCalledTimes(1);
    const [, contexto] = vi.mocked(afterIngest).mock.calls[0] ?? [];
    expect(contexto).toEqual({
      householdId,
      bankItemId: itemId,
      insertedIds: resultado.insertedIds,
      updatedIds: existente.insertedIds,
      now: DEPOIS,
    });
    expect(contexto?.insertedIds).toHaveLength(1);
    expect(contexto?.updatedIds).toEqual(existente.insertedIds);
  });

  it("o CHECK recusa conta e cartão juntos, e recusa nenhum dos dois", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId);
    const db = dbComMedidor();
    const contaId = await criarConta(db, itemId);
    const { cardId } = await criarCartao(db, itemId);

    await expect(
      ingestTransactions(db, {
        householdId,
        bankItemId: itemId,
        rows: [linha({ account_id: contaId, card_id: cardId })],
        now: AGORA,
      }),
    ).rejects.toThrow();
    await expect(
      ingestTransactions(db, {
        householdId,
        bankItemId: itemId,
        rows: [linha()],
        now: AGORA,
      }),
    ).rejects.toThrow();
    expect(await contar("SELECT COUNT(*) AS total FROM transactions WHERE bank_item_id = ?", itemId)).toBe(0);
  });

  it("mais de 200 linhas por chamada: recusa, sem nenhuma ida ao D1", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId);
    const medidor = newMeter();
    const db = dbComMedidor(medidor);
    const contaId = await criarConta(db, itemId);
    const medidorDaChamada = newMeter();
    const dbDaChamada = dbComMedidor(medidorDaChamada);
    const muitas = Array.from({ length: 201 }, (_, i) =>
      linha({ account_id: contaId, external_id: `[TEST] ext-${i}` }),
    );

    await expect(
      ingestTransactions(dbDaChamada, { householdId, bankItemId: itemId, rows: muitas, now: AGORA }),
    ).rejects.toThrow(RangeError);
    expect(medidorDaChamada.calls).toBe(0);
  });

  it("200 linhas com todas as colunas preenchidas, em no máximo 2 chamadas ao D1", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId);
    const db = dbComMedidor();
    const contaId = await criarConta(db, itemId);
    const { cardId, aberta } = await criarCartao(db, itemId);
    // Metade em conta, metade em cartão; todas as colunas de contraparte e parcela preenchidas (estresse de parâmetros).
    const duzentas = Array.from({ length: 200 }, (_, i) =>
      linha({
        ...(i < 100 ? { account_id: contaId } : { card_id: cardId, bill_id: aberta.id }),
        external_id: `[TEST] lote-${i}`,
        movement: i % 2 === 0 ? "pix_enviado" : "compra",
        occurred_at: `2026-11-09T${String(i % 24).padStart(2, "0")}:00:00.000Z`,
        local_date: "2026-11-09",
        amount_cents: -(1000 + i),
        original_description: `[TEST] Lote ${i}`,
        establishment_key: `[TEST] LOTE ${i}`,
        counterparty_name: `[TEST] Contraparte ${i}`,
        counterparty_doc_masked: "***.456.789-**",
        counterparty_bank: "Nubank",
        installment_number: 2,
        installment_total: 10,
        provider_category: "Shopping",
        provider_operation_type: "CARTAO",
      }),
    );
    const medidor = newMeter();
    const dbMedido = dbComMedidor(medidor);

    const primeira = await ingestTransactions(dbMedido, {
      householdId,
      bankItemId: itemId,
      rows: duzentas,
      now: AGORA,
    });

    expect(primeira.insertedIds).toHaveLength(200);
    expect(medidor.calls).toBe(2);
    expect(await contar("SELECT COUNT(*) AS total FROM transactions WHERE bank_item_id = ?", itemId)).toBe(
      200,
    );

    const amostra = await env.DB.prepare(
      `SELECT account_id, card_id, bill_id, movement, amount_cents, counterparty_name, counterparty_doc_masked,
        counterparty_bank, installment_number, installment_total, provider_category, provider_operation_type,
        establishment_key, last_seen_at
       FROM transactions WHERE external_id = ?`,
    )
      .bind("[TEST] lote-150")
      .first();
    expect(amostra).toEqual({
      account_id: null,
      card_id: cardId,
      bill_id: aberta.id,
      movement: "pix_enviado",
      amount_cents: -1150,
      counterparty_name: "[TEST] Contraparte 150",
      counterparty_doc_masked: "***.456.789-**",
      counterparty_bank: "Nubank",
      installment_number: 2,
      installment_total: 10,
      provider_category: "Shopping",
      provider_operation_type: "CARTAO",
      establishment_key: "[TEST] LOTE 150",
      last_seen_at: AGORA,
    });

    // A reimportação do mesmo lote também cabe em 2 chamadas.
    const medidorDois = newMeter();
    const segunda = await ingestTransactions(dbComMedidor(medidorDois), {
      householdId,
      bankItemId: itemId,
      rows: duzentas,
      now: DEPOIS,
    });
    expect(segunda.updatedIds).toHaveLength(200);
    expect(medidorDois.calls).toBe(2);
  });

  it("o D1 local recusa comando com mais de 100 parâmetros, então o limite é de verdade", async () => {
    const cem = Array.from({ length: 100 }, (_, i) => i);
    const cemUm = Array.from({ length: 101 }, (_, i) => i);
    const sqlCem = `SELECT ${cem.map(() => "?").join(", ")}`;
    const sqlCemUm = `SELECT ${cemUm.map(() => "?").join(", ")}`;

    await expect(
      env.DB.prepare(sqlCem)
        .bind(...cem)
        .all(),
    ).resolves.toBeDefined();
    await expect(
      env.DB.prepare(sqlCemUm)
        .bind(...cemUm)
        .all(),
    ).rejects.toThrow();
  });
});
