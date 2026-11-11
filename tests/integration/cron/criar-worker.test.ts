import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { MessageBatch, ScheduledController } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import type { BrandConfig } from "../../../src/shared/brand/types";
import { usageDay } from "../../../src/shared/usage";
import { criarWorker } from "../../../src/worker/criar-worker";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import type { Env } from "../../../src/worker/env";
import type { SyncMessage } from "../../../src/worker/sync/plan";
import { startRun } from "../../../src/worker/sync/runs";
import { semearLar } from "../helpers/sessao";

// criarWorker (TASK-0109 e TASK-0204): o cron e a fila medem o D1 que recebem (o contador do dia em usage_daily), e o
// scheduled chega ao despachante com o db medido. Fila falsa no ambiente; nenhuma chamada de rede.
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
const AGORA_MS = Date.parse(AGORA);

type Banco = { householdId: string; bankItemId: string; accountId: string };

// Lar, conexão, banco e conta [TEST].
async function semeiaBanco(): Promise<Banco> {
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

// Ambiente do teste: o D1 de teste e uma fila falsa que guarda as mensagens enviadas.
function ambienteComFila(fila: SyncMessage[]): Env {
  return {
    ...env,
    SYNC_QUEUE: { send: async (mensagem: SyncMessage) => void fila.push(mensagem) },
  } as unknown as Env;
}

const eventoDoCron = (ms: number) =>
  ({ scheduledTime: ms, cron: "*/5 * * * *" }) as unknown as ScheduledController;

async function linhaDeUsoDeHoje(): Promise<{
  requests: number;
  rows_read: number;
  rows_written: number;
} | null> {
  return env.DB.prepare("SELECT requests, rows_read, rows_written FROM usage_daily WHERE day = ?")
    .bind(usageDay(new Date()))
    .first<{ requests: number; rows_read: number; rows_written: number }>();
}

describe("criarWorker: as peças que o Worker expõe", () => {
  it("expõe fetch, queue e scheduled", () => {
    const worker = criarWorker({ marca: MARCA, versao: "0.0.0-teste" });
    expect(typeof worker.fetch).toBe("function");
    expect(typeof worker.queue).toBe("function");
    expect(typeof worker.scheduled).toBe("function");
  });

  it("scheduled: o evento chega ao despachante, que reenfileira a execução parada pela fila falsa", async () => {
    const banco = await semeiaBanco();
    const execucao = await startRun(createDb(env.DB, newMeter()), banco.bankItemId, "historico", AGORA);
    // Heartbeat de 20 min antes do evento: passa do limite de 15 min, e o cron reenfileira a fatia atual (seq 0).
    await env.DB.prepare("UPDATE sync_runs SET heartbeat_at = ? WHERE id = ?")
      .bind("2026-11-10T11:40:00.000Z", execucao)
      .run();
    const fila: SyncMessage[] = [];
    const worker = criarWorker({ marca: MARCA, versao: "0.0.0-teste" });
    const ctx = createExecutionContext();

    await worker.scheduled(eventoDoCron(AGORA_MS), ambienteComFila(fila), ctx);
    await waitOnExecutionContext(ctx);

    expect(fila).toEqual([{ runId: execucao, seq: 0 }]);
  });

  it("queue: o lote falso é confirmado (ack) e o uso da fila entra no contador do dia", async () => {
    const banco = await semeiaBanco();
    const execucao = (await startRun(
      createDb(env.DB, newMeter()),
      banco.bankItemId,
      "historico",
      AGORA,
    )) as string;
    // Execução encerrada: a fatia é pulada (lê a execução e confirma), sem chamada ao Meu Pluggy.
    await env.DB.prepare("UPDATE sync_runs SET finished_at = ?, status = 'ok' WHERE id = ?")
      .bind(AGORA, execucao)
      .run();
    const ack = vi.fn();
    const retry = vi.fn();
    const lote = {
      messages: [{ body: { runId: execucao, seq: 0 }, attempts: 1, ack, retry }],
    } as unknown as MessageBatch<SyncMessage>;
    const worker = criarWorker({ marca: MARCA, versao: "0.0.0-teste" });

    await worker.queue(lote, ambienteComFila([]));

    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    const uso = await linhaDeUsoDeHoje();
    expect(uso?.requests).toBe(1);
    // A leitura da execução (pelo D1 medido) mais 1 do próprio contador.
    expect(uso?.rows_read).toBeGreaterThanOrEqual(2);
  });
});

describe("criarWorker: o cron mede o uso (TASK-0109)", () => {
  it("depois de um despachar que escreve (atribuir-ciclos), usage_daily do dia tem rows_written > 0", async () => {
    const banco = await semeiaBanco();
    await env.DB.prepare(
      `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, movement, occurred_at,
         local_date, amount_cents, original_description, last_seen_at, cycle_key, removed_at)
       VALUES ('[TEST] sem-ciclo', ?, '[TEST] ext-sem-ciclo', ?, ?, NULL, 'compra', '2026-10-20T12:00:00.000Z',
         '2026-10-20', -1000, '[TEST] compra', ?, NULL, NULL)`,
    )
      .bind(banco.householdId, banco.bankItemId, banco.accountId, AGORA)
      .run();
    const worker = criarWorker({ marca: MARCA, versao: "0.0.0-teste" });
    const ctx = createExecutionContext();

    await worker.scheduled(eventoDoCron(Date.now()), ambienteComFila([]), ctx);
    await waitOnExecutionContext(ctx);

    const atribuido = await env.DB.prepare(
      "SELECT cycle_key FROM transactions WHERE id = '[TEST] sem-ciclo'",
    ).first<{
      cycle_key: string | null;
    }>();
    expect(atribuido?.cycle_key).not.toBeNull();
    const uso = await linhaDeUsoDeHoje();
    expect(uso?.requests).toBe(1);
    expect(uso?.rows_written).toBeGreaterThan(0);
  });
});
