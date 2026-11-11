import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { BillRow, MappedTransaction } from "../../../src/worker/bank/map";
import { ingestTransactions, upsertBillsStmts } from "../../../src/worker/bank/repository";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import { semearLar } from "../helpers/sessao";

// Lacunas da avaliação da TASK-0202 (fronteira dos 5 dias de upsertBillsStmts; aberta atual) entram na TASK-0204.
// Dados [TEST]; um lar, um banco e um cartão por teste.

const AGORA = "2026-11-10T12:00:00.000Z";

async function cartao(): Promise<{ householdId: string; bankItemId: string; cardId: string }> {
  const lar = await semearLar(env.DB, {
    memberId: crypto.randomUUID(),
    passkeyId: `cred-TEST-0204-${crypto.randomUUID()}`,
    email: `${crypto.randomUUID()}@example.com`,
  });
  const connectionId = crypto.randomUUID();
  const bankItemId = crypto.randomUUID();
  const cardId = `[TEST] cartao-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO pluggy_connections (id, household_id, label, created_at) VALUES (?, ?, ?, ?)",
    ).bind(connectionId, lar.householdId, `[TEST] Conexão ${connectionId.slice(0, 6)}`, AGORA),
    env.DB.prepare(
      "INSERT INTO bank_items (id, connection_id, institution_name, status, created_at) VALUES (?, ?, '[TEST] Banco', 'ativo', ?)",
    ).bind(bankItemId, connectionId, AGORA),
    env.DB.prepare(
      "INSERT INTO cards (id, bank_item_id, last4, name) VALUES (?, ?, '0000', '[TEST] Cartão')",
    ).bind(cardId, bankItemId),
  ]);
  return { householdId: lar.householdId, bankItemId, cardId };
}

const sintetica = (cardId: string, fechamento: string): BillRow => ({
  id: `sint:${cardId}:${fechamento}`,
  closes_on: fechamento,
  due_on: null,
  amount_cents: 1000,
  status: "aberta",
  paid_on: null,
});

const real = (id: string, fechamento: string): BillRow => ({
  id,
  closes_on: fechamento,
  due_on: null,
  amount_cents: 1000,
  status: "fechada",
  paid_on: null,
});

const compra = (externalId: string, billId: string, cardId: string, data: string): MappedTransaction => ({
  external_id: externalId,
  account_id: null,
  card_id: cardId,
  bill_id: billId,
  futura: null,
  movement: "compra",
  occurred_at: `${data}T12:00:00.000Z`,
  local_date: data,
  amount_cents: -1000,
  original_description: "[TEST] COMPRA",
  establishment_key: "[TEST] COMPRA",
  counterparty_name: null,
  counterparty_doc_masked: null,
  counterparty_bank: null,
  installment_number: null,
  installment_total: null,
  provider_category: null,
  provider_operation_type: null,
});

// Uma compra na sintética de 03/11 e a real que chega com o fechamento dado.
async function cenario(fechamentoDaReal: string) {
  const { householdId, bankItemId, cardId } = await cartao();
  const aberta = sintetica(cardId, "2026-11-03");
  const db = createDb(env.DB, newMeter());
  await db.$client.batch(upsertBillsStmts(db, { id: cardId }, [], aberta));
  await ingestTransactions(db, {
    householdId,
    bankItemId,
    rows: [compra("[TEST] t-fronteira", aberta.id, cardId, "2026-10-28")],
    now: AGORA,
  });
  await db.$client.batch(
    upsertBillsStmts(db, { id: cardId }, [real(`[TEST] real-${fechamentoDaReal}`, fechamentoDaReal)], null),
  );
  return { cardId, aberta, db };
}

describe("fronteira dos 5 dias em upsertBillsStmts (lacuna da TASK-0202)", () => {
  it("uma real a 5 dias da sintética herda as compras e apaga a sintética", async () => {
    const { cardId, aberta } = await cenario("2026-11-08");
    const sobrou = await env.DB.prepare("SELECT id FROM bills WHERE id = ?").bind(aberta.id).first();
    expect(sobrou).toBeNull();
    const dona = await env.DB.prepare(
      "SELECT bill_id FROM transactions WHERE external_id = '[TEST] t-fronteira'",
    ).first<{
      bill_id: string;
    }>();
    expect(dona?.bill_id).toBe(`[TEST] real-2026-11-08`);
    expect(cardId).toBeTruthy();
  });

  it("uma real a 6 dias da sintética não herda: a sintética e a compra ficam", async () => {
    const { aberta } = await cenario("2026-11-09");
    const sobrou = await env.DB.prepare("SELECT id FROM bills WHERE id = ?").bind(aberta.id).first();
    expect(sobrou).not.toBeNull();
    const dona = await env.DB.prepare(
      "SELECT bill_id FROM transactions WHERE external_id = '[TEST] t-fronteira'",
    ).first<{
      bill_id: string;
    }>();
    expect(dona?.bill_id).toBe(aberta.id);
  });

  it("uma real a até 5 dias da aberta atual não apaga a aberta atual", async () => {
    const { householdId, bankItemId, cardId } = await cartao();
    const aberta = sintetica(cardId, "2026-11-03");
    const db = createDb(env.DB, newMeter());
    await db.$client.batch(upsertBillsStmts(db, { id: cardId }, [], aberta));
    // A real fecha em 06/11, três dias depois da aberta atual: a aberta fica (é a fatura em curso).
    await db.$client.batch(
      upsertBillsStmts(db, { id: cardId }, [real("[TEST] real-06", "2026-11-06")], aberta),
    );
    expect(householdId).toBeTruthy();
    expect(bankItemId).toBeTruthy();
    const continua = await env.DB.prepare("SELECT status FROM bills WHERE id = ?")
      .bind(aberta.id)
      .first<{ status: string }>();
    expect(continua?.status).toBe("aberta");
  });
});
