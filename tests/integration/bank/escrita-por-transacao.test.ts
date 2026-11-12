import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { establishmentKey } from "../../../src/shared/establishment-key";
import { somaDias } from "../../../src/worker/bank/classify-rules";
import type { MappedTransaction } from "../../../src/worker/bank/map";
import { ingestTransactions, upsertAccountsStmts } from "../../../src/worker/bank/repository";
import { createDb, type Db } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";

// TASK-0204, B1-1: linhas escritas (rows_written do D1) por transação numa importação de uma conta corrente.
// Medido antes da mudança: 18,12 por transação (INSERT 13,02 mais os UPDATE de ciclo e de tipo de gasto).
// Depois: 13,55. O piso é 13: a tabela tem 11 índices secundários e a chave primária, e o INSERT escreve uma entrada em
// cada um, mais a linha. A meta de 8 não se alcança sem mudar os índices (migração, decisão de schema).

const AGORA = "2026-11-10T12:00:00.000Z";
const HOJE = "2026-11-10";
// Teto de 17,5 (decisão do Opus, merge da 0303). O custo medido inclui a fila de categorização: cada transação importada
// entra também na fila de categorização da TASK-0303. Medido depois do merge: 16,63.
const TETO_DE_ESCRITAS_POR_TRANSACAO = 17.5;

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

async function criarItemComConta(db: Db, connectionId: string): Promise<{ itemId: string; contaId: string }> {
  const itemId = crypto.randomUUID();
  const contaId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO bank_items (id, connection_id, institution_name, created_at) VALUES (?, ?, '[TEST] Banco', ?)",
  )
    .bind(itemId, connectionId, AGORA)
    .run();
  await db.$client.batch(
    upsertAccountsStmts(
      db,
      itemId,
      [
        {
          id: contaId,
          kind: "corrente",
          name: "[TEST] Conta corrente",
          balance_cents: 0,
          overdraft_used_cents: 0,
        },
      ],
      AGORA,
    ),
  );
  return { itemId, contaId };
}

// Mistura de uma conta corrente: Pix enviado, Pix recebido, débito, rendimento e boleto (um quinto cada), em 300 dias.
function linhaDeConta(i: number, contaId: string): MappedTransaction {
  const data = somaDias(HOJE, -(i % 300));
  const base = {
    external_id: `[TEST] ext-${i}`,
    account_id: contaId,
    card_id: null,
    bill_id: null,
    futura: null,
    occurred_at: `${data}T14:00:00.000Z`,
    local_date: data,
    counterparty_doc_masked: null,
    counterparty_bank: null,
    installment_number: null,
    installment_total: null,
    provider_category: null,
  };
  const descricao = (texto: string) => {
    const original = `[TEST] ${texto} ${i}`;
    return { original_description: original, establishment_key: establishmentKey(original) };
  };
  switch (i % 5) {
    case 0:
      return {
        ...base,
        ...descricao("Pix enviado"),
        movement: "pix_enviado",
        amount_cents: -(1500 + i),
        counterparty_name: `[TEST] Recebedor ${i}`,
        provider_operation_type: "PIX",
      };
    case 1:
      return {
        ...base,
        ...descricao("Pix recebido"),
        movement: "pix_recebido",
        amount_cents: 2500 + i,
        counterparty_name: `[TEST] Pagador ${i}`,
        provider_operation_type: "PIX",
      };
    case 2:
      return {
        ...base,
        ...descricao("Mercado"),
        movement: "debito",
        amount_cents: -(4200 + i),
        counterparty_name: null,
        provider_operation_type: "CARTAO",
      };
    case 3:
      return {
        ...base,
        ...descricao("Rendimento poupança"),
        movement: "rendimento",
        amount_cents: 300 + i,
        counterparty_name: null,
        provider_operation_type: null,
      };
    default:
      return {
        ...base,
        ...descricao("Boleto"),
        movement: "boleto",
        amount_cents: -(9900 + i),
        counterparty_name: null,
        provider_operation_type: "BOLETO",
      };
  }
}

describe("importação de 200 transações de uma conta: linhas escritas por transação (TASK-0204, B1-1)", () => {
  it("fica no piso de uma linha mais onze índices e a chave primária, sem os UPDATE de ciclo e de tipo", async () => {
    const { householdId, connectionId } = await criarLar();
    const medidor = newMeter();
    const db = createDb(env.DB, medidor);
    const { itemId, contaId } = await criarItemComConta(db, connectionId);
    medidor.rowsWritten = 0;

    const linhas = Array.from({ length: 200 }, (_, i) => linhaDeConta(i, contaId));
    const resultado = await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: linhas,
      now: AGORA,
    });
    expect(resultado.insertedIds).toHaveLength(200);

    const porTransacao = medidor.rowsWritten / 200;
    console.info(
      `[medicao-b1-1] importação de 200 transações: rowsWritten=${medidor.rowsWritten} por transação=${porTransacao.toFixed(2)}`,
    );
    expect(porTransacao).toBeLessThanOrEqual(TETO_DE_ESCRITAS_POR_TRANSACAO);
  });
});
