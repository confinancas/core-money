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
// próxima fatia na fila, e o status diz paidPlan. A pausa do teto é o heartbeat na virada; a espera de uma nova tentativa
// (5 min, 30 min, 2 h) tem outro heartbeat e não conta. A fila é falsa (guarda o que seria enviado).
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

// Uma execução em nova tentativa: o heartbeat fica N segundos depois de agora, como a repetição de uma falha do banco.
async function execucaoEmNovaTentativa(banco: Banco, segundos: number): Promise<string> {
  const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
  const heartbeat = new Date(Date.parse(AGORA) + segundos * 1000).toISOString();
  await env.DB.prepare("UPDATE sync_runs SET heartbeat_at = ? WHERE id = ?").bind(heartbeat, runId).run();
  return runId;
}

async function heartbeatDe(runId: string): Promise<string | null> {
  const linha = await env.DB.prepare("SELECT heartbeat_at FROM sync_runs WHERE id = ?")
    .bind(runId)
    .first<{ heartbeat_at: string | null }>();
  return linha?.heartbeat_at ?? null;
}

// App do lar dado, com o relógio dado (o ambiente leva a fila).
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

async function statusDoLar(householdId: string): Promise<{
  paidPlan: boolean;
  importing: { bankItemId: string; pausada: boolean; pausadaAte: string | null }[];
}> {
  const resposta = await callApi(app(householdId, AGORA), "GET", "/api/sync/status", undefined, {}, AMBIENTE);
  return (await resposta.json()) as never;
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

  it("a fatia vai para a fila com o seq do cursor: uma pausa no seq 1 envia seq 1", async () => {
    await semearPronto(env.DB);
    const meu = await semearBanco();
    const run = (await startRun(db(), meu.itemId, "historico", AGORA)) as string;
    const fetch = pluggyFalsoEmMemoria(2);
    // inicio (seq 0) passa sem o teto; depois o contador chega ao teto e a fatia seguinte (seq 1) pausa.
    await contadorDoDia(0);
    expect(
      await runSyncSlice(AMBIENTE, { db: db(), fetch }, { runId: run, seq: 0, tentativa: 1 }, AGORA),
    ).toEqual({
      tipo: "continua",
    });
    await contadorDoDia(60_000);
    expect(
      await runSyncSlice(AMBIENTE, { db: db(), fetch }, { runId: run, seq: 1, tentativa: 1 }, AGORA),
    ).toEqual({
      tipo: "pulou",
    });

    const fila: Mensagem[] = [];
    await ligaOuDesliga(
      meu.householdId,
      true,
      ambienteComFila(async (m) => void fila.push(m)),
    );

    expect(fila).toEqual([{ runId: run, seq: 1 }]);
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

  it.each([300, 1800, 7200])(
    "uma execução em nova tentativa (espera de %i s) não é retomada e não aparece como pausada",
    async (segundos) => {
      await semearPronto(env.DB);
      const meu = await semearBanco();
      const run = await execucaoEmNovaTentativa(meu, segundos);
      const heartbeat = new Date(Date.parse(AGORA) + segundos * 1000).toISOString();

      const status = await statusDoLar(meu.householdId);
      expect(status.importing[0]).toMatchObject({ bankItemId: meu.itemId, pausada: false, pausadaAte: null });

      const fila: Mensagem[] = [];
      const resposta = await ligaOuDesliga(
        meu.householdId,
        true,
        ambienteComFila(async (m) => void fila.push(m)),
      );

      expect(resposta.status).toBe(200);
      expect(fila).toEqual([]);
      expect(await heartbeatDe(run)).toBe(heartbeat);
    },
  );

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
  it("com a execução pausada e o plano ligado por SQL, o PUT false não envia nada e deixa a virada", async () => {
    await semearPronto(env.DB);
    const meu = await semearBanco();
    await contadorDoDia(60_000);
    const run = await execucaoPausada(meu);
    // Ligado por SQL, sem o PUT: a retomada não passou por aqui.
    await env.DB.prepare("UPDATE households SET paid_plan = 1 WHERE id = ?").bind(meu.householdId).run();

    const fila: Mensagem[] = [];
    const resposta = await ligaOuDesliga(
      meu.householdId,
      false,
      ambienteComFila(async (m) => void fila.push(m)),
    );

    expect(resposta.status).toBe(200);
    expect(await planoDo(meu.householdId)).toBe(0);
    expect(fila).toEqual([]);
    expect(await heartbeatDe(run)).toBe(VIRADA);

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

    expect(await statusDoLar(meu.householdId)).toMatchObject({ paidPlan: false });

    await ligaOuDesliga(
      meu.householdId,
      true,
      ambienteComFila(async () => undefined),
    );
    expect(await statusDoLar(meu.householdId)).toMatchObject({ paidPlan: true });
  });

  it("o plano pago de um lar não aparece no status do outro", async () => {
    await semearPronto(env.DB);
    const meu = await semearBanco();
    const outro = await semearBanco();

    await ligaOuDesliga(
      meu.householdId,
      true,
      ambienteComFila(async () => undefined),
    );

    expect(await statusDoLar(meu.householdId)).toMatchObject({ paidPlan: true });
    expect(await statusDoLar(outro.householdId)).toMatchObject({ paidPlan: false });
  });
});
