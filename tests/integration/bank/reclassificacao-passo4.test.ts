import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { classifyMovements, reconcileHousehold } from "../../../src/worker/bank/classify";
import { upsertAccountsStmts } from "../../../src/worker/bank/repository";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";

// Passo 4 na reclassificação (TASK-0404, avaliação da TASK-0802): uma linha gravada como outro movimento (aqui, um
// pix_enviado que estava marcado como pagamento_fatura, sem trava nem categoria) que a classificação devolve à saída
// recebe o tipo padrão e a origem 'padrao', no mesmo lote. Sem a chamada do passo 4, o spend_type ficaria nulo.

const AGORA = "2026-11-10T12:00:00.000Z";
const DIA = "2026-11-05";

async function criarLarComConta(): Promise<{ householdId: string; accountId: string }> {
  const householdId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
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
  await db.$client.batch(
    upsertAccountsStmts(
      db,
      itemId,
      [
        {
          id: accountId,
          kind: "corrente",
          name: "[TEST] Conta",
          balance_cents: 100000,
          overdraft_used_cents: 0,
        },
      ],
      AGORA,
    ),
  );
  return { householdId, accountId };
}

// Linha de Pix enviado que está gravada como pagamento_fatura (movement_locked 0, sem categoria, sem tipo).
async function gravarLinhaReclassificavel(
  householdId: string,
  accountId: string,
): Promise<{ id: string; externalId: string }> {
  const id = crypto.randomUUID();
  const externalId = `[TEST] ext-${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, bill_id, movement,
       movement_original, movement_locked, occurred_at, local_date, amount_cents, original_description,
       establishment_key, counterparty_name, cycle_key, last_seen_at, spend_type, spend_type_source)
     VALUES (?, ?, ?, (SELECT bank_item_id FROM accounts WHERE id = ?), ?, NULL, NULL, 'pagamento_fatura',
       'pix_enviado', 0, ?, ?, -15000, '[TEST] PIX ENVIADO RECLASSIFICAR', NULL, '[TEST] Pessoa', NULL, ?, NULL, NULL)`,
  )
    .bind(id, householdId, externalId, accountId, accountId, `${DIA}T14:00:00.000Z`, DIA, AGORA)
    .run();
  return { id, externalId };
}

const estadoDaLinha = (id: string) =>
  env.DB.prepare("SELECT movement, spend_type, spend_type_source FROM transactions WHERE id = ?")
    .bind(id)
    .first<{ movement: string; spend_type: string | null; spend_type_source: string | null }>();

describe("passo 4 na reclassificação (TASK-0404)", () => {
  it("classifyMovements: a linha que volta a saída recebe o tipo padrão e a origem 'padrao'", async () => {
    const { householdId, accountId } = await criarLarComConta();
    const linha = await gravarLinhaReclassificavel(householdId, accountId);
    const db = createDb(env.DB, newMeter());

    const mudou = await classifyMovements(db, householdId, [linha.id], AGORA);

    expect(mudou).toBe(1);
    const depois = await estadoDaLinha(linha.id);
    expect(depois?.movement).toBe("pix_enviado");
    expect(depois?.spend_type).toBe("prazeres");
    expect(depois?.spend_type_source).toBe("padrao");
  });

  it("reconcileHousehold: a mesma linha, pela conciliação da janela, também recebe o padrão", async () => {
    const { householdId, accountId } = await criarLarComConta();
    const linha = await gravarLinhaReclassificavel(householdId, accountId);
    const db = createDb(env.DB, newMeter());

    await reconcileHousehold(db, householdId, "2026-11-10", AGORA);

    const depois = await estadoDaLinha(linha.id);
    expect(depois?.movement).toBe("pix_enviado");
    expect(depois?.spend_type).toBe("prazeres");
    expect(depois?.spend_type_source).toBe("padrao");
  });
});
