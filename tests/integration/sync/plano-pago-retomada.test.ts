import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/worker/app";
import { pluggyFalsoEmMemoria } from "../../../src/worker/dev/pluggy-fake-fetch";
import type { Env } from "../../../src/worker/env";
import { startRun } from "../../../src/worker/sync/runs";
import { runSyncSlice } from "../../../src/worker/sync/slice";
import { callApi, semearPronto } from "../helpers/app";
import { AGORA, AMBIENTE, type Banco, db, HOJE, semearBanco } from "./importacao-helpers";

// Ligar e desligar o plano pago (TASK-0209): o PUT retoma só as importações pausadas pelo teto do próprio lar, com a
// próxima fatia na fila, e o status diz paidPlan. A fila é falsa (guarda o que seria enviado).
const VIRADA = "2026-11-11T00:00:00.000Z";
const DEPOIS_DA_VIRADA = "2026-11-11T00:30:00.000Z";

type Mensagem = { runId: string; seq: number };

async function contadorDoDia(escritas: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO usage_daily (day, requests, rows_read, rows_written, size_bytes) VALUES (?, 0, 0, ?, 0)
     ON CONFLICT(day) DO UPDATE SET rows_written = excluded.rows_written`,
  )
    .bind(HOJE, escritas)
    .run();
}

// Uma execução pausada pelo teto: a primeira fatia com o contador no teto só encosta o heartbeat na virada.
async function execucaoPausada(banco: Banco): Promise<string> {
  const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
  const resultado = await runSyncSlice(
    AMBIENTE,
    { db: db(), fetch: pluggyFalsoEmMemoria(2) },
    { runId, seq: 0, tentativa: 1 },
    AGORA,
  );
  expect(resultado).toEqual({ tipo: "pulou" });
  return runId;
}

async function heartbeatDe(runId: string): Promise<string | null> {
  const linha = await env.DB.prepare("SELECT heartbeat_at FROM sync_runs WHERE id = ?")
    .bind(runId)
    .first<{ heartbeat_at: string | null }>();
  return linha?.heartbeat_at ?? null;
}

// App do lar dado, com o relógio dado e a fila dada (o ambiente leva SYNC_QUEUE).
function app(householdId: string, agora: string) {
  return createApp({
    resolveSession: async () => ({ memberId: "[TEST] membro", householdId }),
    agora: () => new Date(agora),
  });
}

function ambienteComFila(send: (mensagem: Mensagem) => Promise<void>): Env {
  return Object.assign({}, AMBIENTE, { SYNC_QUEUE: { send } }) as unknown as Env;
}

async function ligaOuDesliga(
  householdId: string,
  paidPlan: boolean,
  ambiente: Env,
  agora = AGORA,
): Promise<Response> {
  return callApi(app(householdId, agora), "PUT", "/api/settings/paid-plan", { paidPlan }, {}, ambiente);
}

async function planoDo(householdId: string): Promise<number> {
  const linha = await env.DB.prepare("SELECT paid_plan FROM households WHERE id = ?")
    .bind(householdId)
    .first<{ paid_plan: number }>();
  return linha?.paid_plan ?? -1;
}

describe("PUT /api/settings/paid-plan com paidPlan true: retoma as pausadas do lar", () => {
  it("envia a próxima fatia de cada execução pausada do lar, põe o heartbeat em agora, e não mexe no outro lar", async () => {
    await semearPronto(env.DB);
    const meu = await semearBanco();
    const outro = await semearBanco();
    await contadorDoDia(60_000);
    const minhaRun = await execucaoPausada(meu);
    const runDoOutro = await execucaoPausada(outro);
    expect(await heartbeatDe(minhaRun)).toBe(VIRADA);

    const fila: Mensagem[] = [];
    const resposta = await ligaOuDesliga(
      meu.householdId,
      true,
      ambienteComFila(async (m) => void fila.push(m)),
    );

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ paidPlan: true });
    expect(await planoDo(meu.householdId)).toBe(1);
    expect(fila).toEqual([{ runId: minhaRun, seq: 0 }]);
    expect(await heartbeatDe(minhaRun)).toBe(AGORA);
    expect(await heartbeatDe(runDoOutro)).toBe(VIRADA);
  });

  it("uma execução cujo heartbeat já passou não é retomada nem enviada", async () => {
    await semearPronto(env.DB);
    const meu = await semearBanco();
    await contadorDoDia(60_000);
    const run = await execucaoPausada(meu);

    const fila: Mensagem[] = [];
    await ligaOuDesliga(
      meu.householdId,
      true,
      ambienteComFila(async (m) => void fila.push(m)),
      DEPOIS_DA_VIRADA,
    );

    expect(fila).toEqual([]);
    expect(await heartbeatDe(run)).toBe(VIRADA);
  });

  it("se a fila falha depois do lote, a resposta é 200 (o plano ficou gravado) e o heartbeat já foi para agora", async () => {
    await semearPronto(env.DB);
    const meu = await semearBanco();
    await contadorDoDia(60_000);
    const run = await execucaoPausada(meu);

    const resposta = await ligaOuDesliga(
      meu.householdId,
      true,
      ambienteComFila(async () => {
        throw new Error("fila fora");
      }),
    );

    expect(resposta.status).toBe(200);
    expect(await planoDo(meu.householdId)).toBe(1);
    expect(await heartbeatDe(run)).toBe(AGORA);
  });
});

describe("PUT /api/settings/paid-plan com paidPlan false: desliga sem retomar", () => {
  it("não envia nada e não mexe no heartbeat; a próxima fatia volta a pausar no teto", async () => {
    await semearPronto(env.DB);
    const meu = await semearBanco();
    await contadorDoDia(60_000);
    const run = await execucaoPausada(meu);
    await ligaOuDesliga(
      meu.householdId,
      true,
      ambienteComFila(async () => undefined),
    );
    // Com o plano pago ligado, a retomada já mexeu no heartbeat: a execução volta a pausar com o teto de novo.
    const fila: Mensagem[] = [];

    const resposta = await ligaOuDesliga(
      meu.householdId,
      false,
      ambienteComFila(async (m) => void fila.push(m)),
    );

    expect(resposta.status).toBe(200);
    expect(await planoDo(meu.householdId)).toBe(0);
    expect(fila).toEqual([]);

    const pausou = await runSyncSlice(
      AMBIENTE,
      { db: db(), fetch: pluggyFalsoEmMemoria(2) },
      { runId: run, seq: 0, tentativa: 1 },
      AGORA,
    );
    expect(pausou).toEqual({ tipo: "pulou" });
    expect(await heartbeatDe(run)).toBe(VIRADA);
  });
});

describe("GET /api/sync/status com paidPlan", () => {
  it("diz paidPlan do lar: false no gratuito e true depois de ligar", async () => {
    await semearPronto(env.DB);
    const meu = await semearBanco();

    const antes = await callApi(
      app(meu.householdId, AGORA),
      "GET",
      "/api/sync/status",
      undefined,
      {},
      AMBIENTE,
    );
    expect(await antes.json()).toMatchObject({ paidPlan: false });

    await ligaOuDesliga(
      meu.householdId,
      true,
      ambienteComFila(async () => undefined),
    );
    const depois = await callApi(
      app(meu.householdId, AGORA),
      "GET",
      "/api/sync/status",
      undefined,
      {},
      AMBIENTE,
    );
    expect(await depois.json()).toMatchObject({ paidPlan: true });
  });
});
