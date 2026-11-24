import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { BillRow, MappedTransaction } from "../../../src/worker/bank/map";
import {
  ingestTransactions,
  upsertAccountsStmts,
  upsertBillsStmts,
  upsertCardsStmts,
} from "../../../src/worker/bank/repository";
import { createDb, type Db } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";

// TASK-0208, refatoração pura: a gravação e as etapas depois dela não podem mudar o resultado no banco. O hash abaixo
// foi tirado do código anterior à refatoração (origin/main, 90b7130) com o mesmo lote. Os ids (UUID) saem da conta: cada
// UUID vira <id>, e as linhas são ordenadas pelo texto, então a comparação é do conteúdo.
const AGORA = "2026-11-10T12:00:00.000Z";
const HASH_DO_CAMINHO_ANTIGO = "1e9cbdaa3e43a3c0f2b245823c9f9608d0997cc745a74adeff635b4e69bfa6d8";

const TABELAS = [
  "transactions",
  "bills",
  "cycles",
  "categorization_queue",
  "accounts",
  "cards",
  "categories",
] as const;

async function criarLote(): Promise<{
  db: Db;
  householdId: string;
  bankItemId: string;
  contaId: string;
  cardId: string;
}> {
  const db = createDb(env.DB, newMeter());
  const householdId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const bankItemId = crypto.randomUUID();
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
    ).bind(bankItemId, connectionId, AGORA),
  ]);
  const contaId = crypto.randomUUID();
  await db.$client.batch(
    upsertAccountsStmts(
      db,
      bankItemId,
      [
        {
          id: contaId,
          kind: "corrente",
          name: "[TEST] Conta",
          balance_cents: 100000,
          overdraft_used_cents: 0,
        },
      ],
      AGORA,
    ),
  );
  const cardId = crypto.randomUUID();
  await db.$client.batch(
    upsertCardsStmts(db, bankItemId, [
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
  await db.$client.batch(upsertBillsStmts(db, { id: cardId }, [], aberta));
  return { db, householdId, bankItemId, contaId, cardId };
}

// Lote fixo: 25 linhas de conta e 15 de cartão, com pix, transferência, pagamento de fatura e estorno.
function lote(contaId: string, cardId: string): MappedTransaction[] {
  const movimentos = [
    "pix_enviado",
    "pix_recebido",
    "transferencia_interna",
    "pagamento_fatura",
    "estorno",
  ] as const;
  const linhas: MappedTransaction[] = [];
  for (let i = 0; i < 40; i += 1) {
    const dia = String(1 + (i % 9)).padStart(2, "0");
    const base: MappedTransaction = {
      external_id: `[TEST] ext-${String(i).padStart(3, "0")}`,
      account_id: i < 25 ? contaId : null,
      card_id: i < 25 ? null : cardId,
      bill_id: null,
      futura: null,
      movement: movimentos[i % movimentos.length] ?? "outro",
      occurred_at: `2026-11-${dia}T14:00:00.000Z`,
      local_date: `2026-11-${dia}`,
      amount_cents: i % 3 === 0 ? 2500 * (i + 1) : -1500 * (i + 1),
      original_description: `[TEST] Lançamento ${i}`,
      establishment_key: `[TEST] ESTAB ${i % 4}`,
      counterparty_name: i % 2 === 0 ? "[TEST] Recebedor" : null,
      counterparty_doc_masked: null,
      counterparty_bank: null,
      installment_number: null,
      installment_total: null,
      provider_category: null,
      provider_operation_type: i % 2 === 0 ? "PIX" : "CARTAO",
    };
    linhas.push(base);
  }
  return linhas;
}

const normaliza = (valor: unknown): unknown => {
  if (typeof valor === "string")
    return valor.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>");
  if (Array.isArray(valor)) return valor.map(normaliza);
  if (valor !== null && typeof valor === "object")
    return Object.fromEntries(Object.entries(valor).map(([chave, v]) => [chave, normaliza(v)]));
  return valor;
};

async function fotografia(): Promise<string> {
  const partes: string[] = [];
  for (const tabela of TABELAS) {
    const linhas = await env.DB.prepare(`SELECT * FROM ${tabela}`).all<Record<string, unknown>>();
    const normalizadas = (linhas.results ?? []).map((linha) => JSON.stringify(normaliza(linha))).sort();
    partes.push(`${tabela}:${normalizadas.length}\n${normalizadas.join("\n")}`);
  }
  return partes.join("\n--\n");
}

async function sha256(texto: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("TASK-0208: a gravação da fatia dá o mesmo resultado no banco", () => {
  it("lote de 40 linhas (conta e cartão): o estado do banco bate com o do caminho anterior", async () => {
    const { db, householdId, bankItemId, contaId, cardId } = await criarLote();
    await ingestTransactions(db, {
      householdId,
      bankItemId,
      rows: lote(contaId, cardId),
      now: AGORA,
    });
    const hash = await sha256(await fotografia());
    const linhas = await env.DB.prepare("SELECT COUNT(*) AS n FROM transactions").first<{ n: number }>();
    expect(linhas?.n).toBe(40);
    expect(hash).toBe(HASH_DO_CAMINHO_ANTIGO);
  });
});
