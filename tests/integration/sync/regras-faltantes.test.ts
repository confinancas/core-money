import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import type { Env } from "../../../src/worker/env";
import { scheduleDailySync } from "../../../src/worker/sync/daily";
import { startRun } from "../../../src/worker/sync/runs";
import { runSyncSlice } from "../../../src/worker/sync/slice";
import { callApi, semearPronto } from "../helpers/app";
import { AMBIENTE, type Banco, rodar, semearBanco } from "./importacao-helpers";
import { pluggyFalsoComTransacoes } from "./pluggy-com-transacoes";

// Regras herdadas que a avaliação da Fable achou sem teste (TASK-0205, A4): a janela da execução manual, a última execução
// para o "Baixar agora", o agendamento só pela diária, a ordem dos nomes do status, o afterRun no fim da diária, e o
// is_backfill com uma linha antiga de verdade. Dados [TEST]; Pluggy falso.

const DIA_1 = "2026-11-10T12:00:00.000Z";
const DIA_2 = "2026-11-10T13:00:00.000Z";
const DIA_3 = "2026-11-10T14:00:00.000Z";
const MEIA_NOITE_SP = "2026-11-10T03:00:00.000Z";

const AMBIENTE_COM_FILA = Object.assign({}, AMBIENTE, {
  SYNC_QUEUE: { send: async () => undefined },
}) as unknown as Env;

const linhaSql = async (sql: string, ...valores: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...valores)
    .first<Record<string, unknown>>();

// Segundo banco da mesma conexão do primeiro: o mesmo lar, para a conciliação ver as duas contas.
async function segundoBanco(banco: Banco): Promise<string> {
  const itemId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO bank_items (id, connection_id, institution_name, institution_color, consent_expires_at, last_sync_at,
       status, disconnected_at, created_at) VALUES (?, ?, '[TEST] Banco B', NULL, NULL, NULL, 'ativo', NULL, ?)`,
  )
    .bind(itemId, banco.connectionId, DIA_1)
    .run();
  return itemId;
}

async function fechaExecucao(runId: string, quando: string, status: string, erro: string | null = null) {
  await env.DB.prepare(
    "UPDATE sync_runs SET finished_at = ?, status = ?, error_code = ?, progress_pct = 100 WHERE id = ?",
  )
    .bind(quando, status, erro, runId)
    .run();
}

describe("A4: a janela da execução manual é a da sincronização, não a do histórico", () => {
  it("uma manual começa com a janela diária: uma só janela para a conta corrente", async () => {
    const banco = await semearBanco();
    // Histórico anterior concluído, para a manual não cair na regra de quem nunca importou.
    const anterior = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "historico",
      DIA_1,
    )) as string;
    await fechaExecucao(anterior, DIA_1, "ok");
    const manual = (await startRun(createDb(env.DB, newMeter()), banco.itemId, "manual", DIA_2)) as string;
    const fetch = pluggyFalsoComTransacoes(() => []);
    await runSyncSlice(
      AMBIENTE,
      { db: createDb(env.DB, newMeter()), fetch },
      { runId: manual, seq: 0, tentativa: 1 },
      DIA_2,
    );
    const cursor = JSON.parse(
      ((await linhaSql("SELECT cursor_json FROM sync_runs WHERE id = ?", manual)) as { cursor_json: string })
        .cursor_json,
    ) as { accounts: { kind: string; windows: unknown[] }[] };
    const corrente = cursor.accounts.find((conta) => conta.kind === "BANK");
    expect(corrente?.windows).toHaveLength(1);
  });
});

describe("A4: a última execução é a mais recente, não a mais antiga (pela rota)", () => {
  async function appDoLar(householdId: string) {
    const { createApp } = await import("../../../src/worker/app");
    await semearPronto(env.DB);
    return createApp({
      resolveSession: async () => ({ memberId: "[TEST] membro", householdId }),
      agora: () => new Date(DIA_3),
    });
  }

  it("falha antiga e sucesso depois: 'Baixar agora' responde 409 sem_falha", async () => {
    const banco = await semearBanco();
    const falha = (await startRun(createDb(env.DB, newMeter()), banco.itemId, "diaria", DIA_1)) as string;
    await fechaExecucao(falha, DIA_1, "instavel", "banco_instavel");
    const sucesso = (await startRun(createDb(env.DB, newMeter()), banco.itemId, "diaria", DIA_2)) as string;
    await fechaExecucao(sucesso, DIA_2, "ok");
    const resposta = await callApi(
      await appDoLar(banco.householdId),
      "POST",
      `/api/bank-items/${banco.itemId}/sync`,
      undefined,
      {},
      AMBIENTE,
    );
    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toMatchObject({ error: "sem_falha" });
  });

  it("sucesso antigo e falha depois: a falha mais nova é a última, e o 'Baixar agora' responde 202", async () => {
    const banco = await semearBanco();
    const sucesso = (await startRun(createDb(env.DB, newMeter()), banco.itemId, "diaria", DIA_1)) as string;
    await fechaExecucao(sucesso, DIA_1, "ok");
    const falha = (await startRun(createDb(env.DB, newMeter()), banco.itemId, "diaria", DIA_2)) as string;
    await fechaExecucao(falha, DIA_2, "instavel", "banco_instavel");
    const resposta = await callApi(
      await appDoLar(banco.householdId),
      "POST",
      `/api/bank-items/${banco.itemId}/sync`,
      undefined,
      {},
      AMBIENTE_COM_FILA,
    );
    expect(resposta.status).toBe(202);
  });
});

describe("A4: o agendamento conta só a diária de hoje", () => {
  it("uma manual de hoje, já terminada, não segura a diária: a diária é agendada", async () => {
    const banco = await semearBanco();
    const historico = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "historico",
      DIA_1,
    )) as string;
    await fechaExecucao(historico, DIA_1, "ok");
    const manual = (await startRun(createDb(env.DB, newMeter()), banco.itemId, "manual", DIA_2)) as string;
    await fechaExecucao(manual, DIA_2, "ok");
    const agendados = await scheduleDailySync(
      Object.assign({}, AMBIENTE, { SYNC_QUEUE: { send: async () => undefined } }) as never,
      { agora: new Date("2026-11-10T16:00:00.000Z") },
    );
    expect(agendados).toBe(1);
  });
});

describe("A4: a ordem dos nomes em lastSync.banks", () => {
  it("os bancos com atualização aparecem do mais recente para o mais antigo", async () => {
    const { createApp } = await import("../../../src/worker/app");
    const { callApi, semearPronto } = await import("../helpers/app");
    await semearPronto(env.DB);
    const banco = await semearBanco();
    const outro = await segundoBanco(banco);
    await env.DB.prepare("UPDATE bank_items SET last_sync_at = ? WHERE id = ?")
      .bind(DIA_1, banco.itemId)
      .run();
    await env.DB.prepare("UPDATE bank_items SET last_sync_at = ? WHERE id = ?").bind(DIA_2, outro).run();
    const app = createApp({
      resolveSession: async () => ({ memberId: "[TEST] membro", householdId: banco.householdId }),
      agora: () => new Date(DIA_3),
    });
    const resposta = await callApi(app, "GET", "/api/sync/status", undefined, {}, AMBIENTE);
    const corpo = (await resposta.json()) as { lastSync: { at: string; banks: string[] } | null };
    expect(corpo.lastSync?.banks).toEqual(["[TEST] Banco B", "[TEST] Banco"]);
    expect(corpo.lastSync?.at).toBe(DIA_2);
  });
});

describe("N9 com uma linha antiga de verdade: a releitura de linha de ciclo antigo não marca o is_backfill", () => {
  it("historico relido com tentativa 2: a linha de julho, de um ciclo mais antigo, não volta a ser marcada", async () => {
    const banco = await semearBanco();
    const conta = `${banco.itemId}-corrente`;
    const fetch = pluggyFalsoComTransacoes((c) =>
      c === conta ? [{ id: "[TEST]-julho", conta, data: "2026-07-15", valor: -77 }] : [],
    );
    const primeira = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "historico",
      DIA_1,
    )) as string;
    await rodar(primeira, fetch, 0, 1, DIA_1);
    const antes = await linhaSql(
      "SELECT is_backfill FROM transactions WHERE external_id = ?",
      "[TEST]-julho",
    );
    expect(antes?.is_backfill).toBe(1);

    await env.DB.prepare("UPDATE transactions SET is_backfill = 0 WHERE external_id = ?")
      .bind("[TEST]-julho")
      .run();
    await env.DB.prepare("DELETE FROM categorization_queue").run();
    const segunda = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "historico",
      DIA_2,
    )) as string;
    await rodar(segunda, fetch, 0, 2, DIA_2);
    const depois = await linhaSql(
      "SELECT is_backfill FROM transactions WHERE external_id = ?",
      "[TEST]-julho",
    );
    expect(depois?.is_backfill).toBe(0);
  });
});
