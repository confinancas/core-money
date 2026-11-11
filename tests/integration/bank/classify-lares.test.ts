import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { classifyMovements } from "../../../src/worker/bank/classify";
import type { BillRow, MappedTransaction } from "../../../src/worker/bank/map";
import {
  ingestTransactions,
  upsertAccountsStmts,
  upsertBillsStmts,
  upsertCardsStmts,
} from "../../../src/worker/bank/repository";
import { createDb, type Db } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";

// TASK-0207, item 4 (lacunas da avaliação) e TASK-0204, R11: dois lares no mesmo D1, e a reclassificação de updatedIds.

const AGORA = "2026-11-10T12:00:00.000Z";
const DEPOIS = "2026-11-10T13:00:00.000Z";

type Lar = { householdId: string; connectionId: string; db: Db };

async function criarLar(): Promise<Lar> {
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
  return { householdId, connectionId, db: createDb(env.DB, newMeter()) };
}

async function criarItem(lar: Lar): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO bank_items (id, connection_id, institution_name, created_at) VALUES (?, ?, '[TEST] Nubank', ?)",
  )
    .bind(id, lar.connectionId, AGORA)
    .run();
  return id;
}

async function criarConta(lar: Lar, bankItemId: string): Promise<string> {
  const id = crypto.randomUUID();
  await lar.db.$client.batch(
    upsertAccountsStmts(
      lar.db,
      bankItemId,
      [{ id, kind: "corrente", name: "[TEST] Conta", balance_cents: 100000, overdraft_used_cents: 0 }],
      AGORA,
    ),
  );
  return id;
}

async function criarCartao(lar: Lar, bankItemId: string): Promise<string> {
  const cardId = crypto.randomUUID();
  await lar.db.$client.batch(
    upsertCardsStmts(lar.db, bankItemId, [
      { id: cardId, last4: "1234", name: "[TEST] Cartão", limit_cents: 500000, available_cents: 400000 },
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
  await lar.db.$client.batch(upsertBillsStmts(lar.db, { id: cardId }, [], aberta));
  return cardId;
}

const movimento = (extra: Partial<MappedTransaction> = {}): MappedTransaction => ({
  external_id: `[TEST] ext-${crypto.randomUUID()}`,
  account_id: null,
  card_id: null,
  bill_id: null,
  futura: null,
  movement: "outro",
  occurred_at: "2026-11-05T14:00:00.000Z",
  local_date: "2026-11-05",
  amount_cents: -1000,
  original_description: "[TEST] Movimento",
  establishment_key: "[TEST] MOVIMENTO",
  counterparty_name: null,
  counterparty_doc_masked: null,
  counterparty_bank: null,
  installment_number: null,
  installment_total: null,
  provider_category: null,
  provider_operation_type: null,
  ...extra,
});

// Pagamento de fatura que chega no cartão (entrada positiva, operação PAGAMENTO_FATURA).
const pagamentoDoCartao = (cardId: string, externalId: string, localDate: string, centavos: number) =>
  movimento({
    card_id: cardId,
    external_id: externalId,
    movement: "pagamento_fatura",
    local_date: localDate,
    occurred_at: `${localDate}T14:00:00.000Z`,
    amount_cents: centavos,
    original_description: "[TEST] PAGAMENTO RECEBIDO",
    provider_operation_type: "PAGAMENTO_FATURA",
  });

const estadoDe = (externalId: string) =>
  env.DB.prepare(
    "SELECT movement, movement_original, income_kind, spend_type, spend_type_source FROM transactions WHERE external_id = ?",
  )
    .bind(externalId)
    .first<{
      movement: string;
      movement_original: string | null;
      income_kind: string | null;
      spend_type: string | null;
      spend_type_source: string | null;
    }>();

const idDe = async (externalId: string): Promise<string> => {
  const linha = await env.DB.prepare("SELECT id FROM transactions WHERE external_id = ?")
    .bind(externalId)
    .first<{ id: string }>();
  if (!linha) throw new Error(`linha ${externalId} não encontrada`);
  return linha.id;
};

describe("classificação em dois lares do mesmo D1", () => {
  it("a classificação de um lar não altera a linha do outro, mesmo com valor e data iguais", async () => {
    const a = await criarLar();
    const b = await criarLar();
    const itemA = await criarItem(a);
    const itemB = await criarItem(b);
    const cartaoA = await criarCartao(a, itemA);
    const contaB = await criarConta(b, itemB);

    // Lar B: uma saída de 2.870,40 que não é pagamento de fatura, com a mesma data e o mesmo valor do pagamento de A.
    await ingestTransactions(b.db, {
      householdId: b.householdId,
      bankItemId: itemB,
      rows: [
        movimento({
          account_id: contaB,
          external_id: "[TEST] ext-b-saida",
          movement: "pix_enviado",
          local_date: "2026-11-06",
          amount_cents: -287040,
          original_description: "[TEST] Pix enviado B",
          establishment_key: "[TEST] PIX ENVIADO B",
          provider_operation_type: "PIX",
        }),
      ],
      now: AGORA,
    });
    const antesDeA = await estadoDe("[TEST] ext-b-saida");
    expect(antesDeA).toMatchObject({ movement: "pix_enviado", movement_original: null });

    // Lar A: o pagamento do cartão, sem nenhuma saída no lar A para parear. Se a consulta do lar A visse o lar B, a saída
    // de B casaria com este pagamento.
    await ingestTransactions(a.db, {
      householdId: a.householdId,
      bankItemId: itemA,
      rows: [pagamentoDoCartao(cartaoA, "[TEST] ext-a-pagamento", "2026-11-06", 287040)],
      now: AGORA,
    });
    await classifyMovements(a.db, a.householdId, [await idDe("[TEST] ext-a-pagamento")], DEPOIS);

    expect(await estadoDe("[TEST] ext-b-saida")).toEqual(antesDeA);
    expect(await estadoDe("[TEST] ext-a-pagamento")).toMatchObject({
      movement: "pagamento_fatura",
      income_kind: null,
    });
  });
});

describe("afterIngest reclassifica as linhas atualizadas (updatedIds)", () => {
  it("a linha reimportada com a descrição de pagamento de fatura passa pelo passo 1 e perde o tipo padrão", async () => {
    const lar = await criarLar();
    const item = await criarItem(lar);
    const conta = await criarConta(lar, item);

    const primeira = await ingestTransactions(lar.db, {
      householdId: lar.householdId,
      bankItemId: item,
      rows: [
        movimento({
          account_id: conta,
          external_id: "[TEST] ext-reimp",
          movement: "pix_enviado",
          local_date: "2026-11-05",
          amount_cents: -287040,
          original_description: "[TEST] Transferência Pix",
          establishment_key: "[TEST] TRANSFERENCIA PIX",
          provider_operation_type: "PIX",
        }),
      ],
      now: AGORA,
    });
    expect(primeira.insertedIds).toHaveLength(1);
    // Saída com tipo: a gravação já pôs o tipo padrão.
    expect(await estadoDe("[TEST] ext-reimp")).toMatchObject({
      movement: "pix_enviado",
      spend_type: "prazeres",
      spend_type_source: "padrao",
    });

    // A mesma linha, com a descrição que o banco mandou depois: é uma atualização, e não uma inserção.
    const segunda = await ingestTransactions(lar.db, {
      householdId: lar.householdId,
      bankItemId: item,
      rows: [
        movimento({
          account_id: conta,
          external_id: "[TEST] ext-reimp",
          movement: "pix_enviado",
          local_date: "2026-11-05",
          amount_cents: -287040,
          original_description: "[TEST] PAG FATURA CARTAO",
          establishment_key: "[TEST] PAG FATURA CARTAO",
          provider_operation_type: "PIX",
        }),
      ],
      now: DEPOIS,
    });
    expect(segunda.insertedIds).toEqual([]);
    expect(segunda.updatedIds).toEqual(primeira.insertedIds);

    // O passo 1 (R1: "PAG FATURA" com o cartão) reclassifica a linha atualizada: vira pagamento de fatura, guarda o
    // movimento de origem, e sem tipo de gasto, porque pagamento de fatura não tem tipo.
    expect(await estadoDe("[TEST] ext-reimp")).toMatchObject({
      movement: "pagamento_fatura",
      movement_original: "pix_enviado",
      spend_type: null,
      spend_type_source: null,
    });
  });
});
