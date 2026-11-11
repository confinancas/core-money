import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { BrandConfig } from "../../src/shared/brand/types";
import type { ClienteDaIA } from "../../src/worker/categorization/claude";
import { runCategorizationSlice } from "../../src/worker/categorization/cron";
import { criarWorker } from "../../src/worker/criar-worker";
import { createDb } from "../../src/worker/db/client";
import { newMeter } from "../../src/worker/db/metered-d1";
import type { Env } from "../../src/worker/env";
import { saveSecret } from "../../src/worker/security/secrets";
import { AGORA, contar, criarLar, type Lar } from "./helpers/regras";

// Rodada 2 da TASK-0303 (avaliação da Fable): a pausa decide antes de qualquer leitura da fila; chave nova apaga a
// pausa; o scheduled espera o despachante. A IA é falsa; nenhum teste chama a Anthropic.

const ambiente = env as unknown as Env;
const PAUSA_ATE = "2026-11-10T13:00:00.000Z";

// Fila de N transações do lar, com o prefixo dado (ids e external_ids únicos).
async function filaDe(lar: Lar, prefixo: string, quantidade: number): Promise<void> {
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
     INSERT INTO transactions (id, household_id, external_id, bank_item_id, card_id, movement, occurred_at, local_date,
       amount_cents, original_description, establishment_key, cycle_key, last_seen_at)
     SELECT '${prefixo}-' || i, ?, '${prefixo}-ext-' || i, ?, ?, 'compra', '2026-11-05T12:00:00.000Z', '2026-11-05',
       -1000, '[TEST] Fila', 'TEST FILA', '2026-10', ? FROM n`,
  )
    .bind(quantidade, lar.householdId, lar.bankItemId, lar.cardId, AGORA)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO categorization_queue (transaction_id, enqueued_at, attempts, last_error)
     SELECT id, ?, 0, NULL FROM transactions WHERE id LIKE ?`,
  )
    .bind(AGORA, `${prefixo}-%`)
    .run();
}

const pausar = () =>
  env.DB.prepare("INSERT INTO categorization_pausa (name, pausar_ate) VALUES ('claude', ?)")
    .bind(PAUSA_ATE)
    .run();

// Cliente que não pode ser chamado quando a fatia está pausada.
const clienteQueNaoPodeSerChamado = (): ClienteDaIA => ({
  messages: {
    create: async () => {
      throw new Error("a IA não devia ser chamada nesta execução");
    },
  },
});

describe("pausa: a execução pausada não lê a fila", () => {
  it("com a fila de 1.000 e depois de 4.000, a execução pausada lê o mesmo número de linhas, e nada mais", async () => {
    const lar = await criarLar();
    await pausar();
    await filaDe(lar, "F1", 1000);
    const pequena = newMeter();
    const r1 = await runCategorizationSlice(ambiente, {
      now: () => new Date(AGORA),
      createClient: clienteQueNaoPodeSerChamado,
      meter: pequena,
    });
    expect(r1.situacao).toBe("pausada");

    await filaDe(lar, "F2", 3000);
    const grande = newMeter();
    const r2 = await runCategorizationSlice(ambiente, {
      now: () => new Date(AGORA),
      createClient: clienteQueNaoPodeSerChamado,
      meter: grande,
    });
    expect(r2.situacao).toBe("pausada");

    expect(grande.rowsRead).toBe(pequena.rowsRead);
    expect(grande.rowsRead).toBeLessThanOrEqual(10);
    expect(grande.calls).toBe(1);
    expect(grande.rowsWritten).toBe(0);
  });
});

describe("chave nova apaga a pausa", () => {
  it("salvar a chave da IA apaga a pausa, e a execução seguinte processa a fila", async () => {
    const lar = await criarLar();
    await pausar();
    await filaDe(lar, "CH", 1);
    expect(await contar("SELECT COUNT(*) AS total FROM categorization_pausa")).toBe(1);

    await saveSecret(
      createDb(env.DB, newMeter()),
      ambiente,
      "claude_api_key",
      "sk-ant-api03-TEST-chave-nova",
    );
    expect(await contar("SELECT COUNT(*) AS total FROM categorization_pausa")).toBe(0);

    let chamadas = 0;
    const cliente: ClienteDaIA = {
      messages: {
        create: async () => {
          chamadas++;
          return {
            stop_reason: "end_turn",
            content: [{ type: "text", text: JSON.stringify({ sugestoes: [] }) }],
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      },
    };
    const r = await runCategorizationSlice(ambiente, {
      now: () => new Date(AGORA),
      createClient: () => cliente,
    });
    expect(r.situacao).toBe("processada");
    expect(chamadas).toBe(1);
  });
});

describe("scheduled: o handler espera o despachante", () => {
  it("o uso do cron soma as leituras da fatia (a pausa), e não só a gravação do contador", async () => {
    await pausar();
    const worker = criarWorker({ marca: {} as unknown as BrandConfig, versao: "teste" });
    const ctx = createExecutionContext();
    await worker.scheduled({ scheduledTime: Date.parse(AGORA), cron: "*/5 * * * *" } as never, ambiente, ctx);
    await waitOnExecutionContext(ctx);
    const usos = await env.DB.prepare("SELECT COALESCE(SUM(rows_read), 0) AS total FROM usage_daily").first<{
      total: number;
    }>();
    // A leitura da pausa (1 linha) mais 1 do contador. Sem a espera, o contador sai antes da leitura: só 1.
    expect(usos?.total).toBeGreaterThanOrEqual(2);
  });
});
