import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { ScheduledController } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";
import type { BrandConfig } from "../../../src/shared/brand/types";
import { usageDay } from "../../../src/shared/usage";
import { criarWorker } from "../../../src/worker/criar-worker";
import type { Env } from "../../../src/worker/env";
import type { SyncMessage } from "../../../src/worker/sync/plan";
import { semearLar } from "../helpers/sessao";

// O cron mede o D1 que as tarefas usam (TASK-0204, R4; reconferência A3). O scheduled de criarWorker passa o db medido ao
// despachante, e cada tarefa escreve por ele: a atribuição de ciclos das transações sem ciclo grava uma linha por
// transação, e essas escritas só entram em usage_daily pelo db medido. Um despachar sem o db deixa só a escrita do
// próprio contador (+1), então o número de escritas do dia prova que o db chegou às tarefas.
const MARCA: BrandConfig = {
  id: "matrimoney",
  workerName: "matrimoney",
  repositorio: "confinancas/matrimoney",
  name: "App de teste",
  shortName: "App de teste",
  wordmark: ["App", "Teste"],
  colors: { theme: "#0E9A63", background: "#FFFFFF", wordmarkA: "#3D4943", wordmarkB: "#0E9A63" },
  texts: {
    tagline: "Ambiente de teste.",
    assistantCta: "Pergunte ao assistente",
    householdLabel: "Conta compartilhada",
  },
};
const AGORA = "2026-11-10T12:00:00.000Z";
const SEM_CICLO = 10;

// Lar, conexão, banco e conta [TEST].
async function semeiaBanco(): Promise<{ householdId: string; bankItemId: string; accountId: string }> {
  const lar = await semearLar(env.DB, {
    memberId: crypto.randomUUID(),
    passkeyId: `cred-TEST-0205-${crypto.randomUUID()}`,
    email: `${crypto.randomUUID()}@example.com`,
  });
  const connectionId = crypto.randomUUID();
  const bankItemId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO pluggy_connections (id, household_id, label, cpf_masked, client_id_enc, iv, client_secret_enc,
         client_secret_iv, created_at) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)`,
    ).bind(connectionId, lar.householdId, `[TEST] Conexão ${connectionId.slice(0, 6)}`, AGORA),
    env.DB.prepare(
      `INSERT INTO bank_items (id, connection_id, institution_name, institution_color, consent_expires_at, last_sync_at,
         status, disconnected_at, created_at) VALUES (?, ?, '[TEST] Banco', NULL, NULL, NULL, 'ativo', NULL, ?)`,
    ).bind(bankItemId, connectionId, AGORA),
    env.DB.prepare(
      "INSERT INTO accounts (id, bank_item_id, kind, name, balance_cents, overdraft_used_cents, balance_at) VALUES (?, ?, 'corrente', '[TEST] Conta', 0, 0, ?)",
    ).bind(accountId, bankItemId, AGORA),
  ]);
  return { householdId: lar.householdId, bankItemId, accountId };
}

// Fila falsa: o cron não envia nada nesta prova (não há execução parada).
function ambienteComFila(fila: SyncMessage[]): Env {
  return {
    ...env,
    SYNC_QUEUE: { send: async (mensagem: SyncMessage) => void fila.push(mensagem) },
  } as unknown as Env;
}

const eventoDoCron = (ms: number) =>
  ({ scheduledTime: ms, cron: "*/5 * * * *" }) as unknown as ScheduledController;

describe("criarWorker: o db medido chega às tarefas do cron (reconferência A3)", () => {
  it("as escritas da atribuição de ciclos entram em usage_daily do dia: rows_written >= as transações sem ciclo", async () => {
    const banco = await semeiaBanco();
    const inserts = Array.from({ length: SEM_CICLO }, (_, i) =>
      env.DB.prepare(
        `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, movement, occurred_at,
           local_date, amount_cents, original_description, last_seen_at, cycle_key, removed_at)
         VALUES (?, ?, ?, ?, ?, NULL, 'compra', '2026-10-20T12:00:00.000Z', '2026-10-20', ?, '[TEST] compra', ?, NULL, NULL)`,
      ).bind(
        `[TEST] sem-ciclo-${i}`,
        banco.householdId,
        `[TEST] ext-sem-ciclo-${i}`,
        banco.bankItemId,
        banco.accountId,
        -1000 - i,
        AGORA,
      ),
    );
    await env.DB.batch(inserts);
    const worker = criarWorker({ marca: MARCA, versao: "0.0.0-teste" });
    const ctx = createExecutionContext();

    await worker.scheduled(eventoDoCron(Date.now()), ambienteComFila([]), ctx);
    await waitOnExecutionContext(ctx);

    const semCiclo = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM transactions WHERE household_id = ? AND id LIKE '[TEST] sem-ciclo-%' AND cycle_key IS NULL",
    )
      .bind(banco.householdId)
      .first<{ n: number }>();
    expect(semCiclo?.n).toBe(0);
    const uso = await env.DB.prepare("SELECT requests, rows_written FROM usage_daily WHERE day = ?")
      .bind(usageDay(new Date()))
      .first<{ requests: number; rows_written: number }>();
    expect(uso?.requests).toBe(1);
    expect(uso?.rows_written).toBeGreaterThanOrEqual(SEM_CICLO);
  });
});
