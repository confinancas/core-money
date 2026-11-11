import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/worker/app";
import { pluggyFalsoEmMemoria } from "../../../src/worker/dev/pluggy-fake-fetch";
import { startRun } from "../../../src/worker/sync/runs";
import { runSyncSlice } from "../../../src/worker/sync/slice";
import { callApi, semearPronto } from "../helpers/app";
import { AGORA, AMBIENTE, db, HOJE, semearBanco } from "./importacao-helpers";

// GET /api/sync/status com o teto diário (TASK-0204, A1): a execução pausada devolve pausada e a hora da retomada (a
// virada, 00:00 UTC), para a faixa e o passo 4 dizerem que a importação continua amanhã. O caminho é o de produção: o
// contador no teto faz a fatia pausar (runSyncSlice grava o heartbeat na virada) e a rota lê esse heartbeat.
const VIRADA = "2026-11-11T00:00:00.000Z";
const DEPOIS_DA_VIRADA = "2026-11-11T00:30:00.000Z";

// Contador de hoje (usage_daily, dia UTC) com as escritas dadas. Com o limite do plano, o teto são 60 mil.
async function contadorDoDia(escritas: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO usage_daily (day, requests, rows_read, rows_written, size_bytes) VALUES (?, 0, 0, ?, 0)
     ON CONFLICT(day) DO UPDATE SET rows_written = excluded.rows_written`,
  )
    .bind(HOJE, escritas)
    .run();
}

// App do lar dado, com o relógio dado (o padrão é o da importação, AGORA).
function appDoLar(householdId: string, agora: string) {
  return createApp({
    resolveSession: async () => ({ memberId: "[TEST] membro", householdId }),
    agora: () => new Date(agora),
  });
}

type LinhaDaImportacao = { bankItemId: string; pausada: boolean; pausadaAte: string | null };

async function importandoDoLar(householdId: string, agora = AGORA): Promise<LinhaDaImportacao[]> {
  const resposta = await callApi(
    appDoLar(householdId, agora),
    "GET",
    "/api/sync/status",
    undefined,
    {},
    AMBIENTE,
  );
  expect(resposta.status).toBe(200);
  const corpo = (await resposta.json()) as { importing: LinhaDaImportacao[] };
  return corpo.importing;
}

describe("GET /api/sync/status: a pausa do teto diário", () => {
  it("com o contador de hoje no teto, a fatia pausa e a rota devolve pausada com a retomada na virada", async () => {
    await semearPronto(env.DB);
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    await contadorDoDia(60_000);
    const resultado = await runSyncSlice(
      AMBIENTE,
      { db: db(), fetch: pluggyFalsoEmMemoria(2) },
      { runId, seq: 0, tentativa: 1 },
      AGORA,
    );
    expect(resultado).toEqual({ tipo: "pulou" });

    const importando = await importandoDoLar(banco.householdId);

    expect(importando).toHaveLength(1);
    expect(importando[0]).toMatchObject({ bankItemId: banco.itemId, pausada: true, pausadaAte: VIRADA });
  });

  it("abaixo do teto, a fatia segue e a rota devolve pausada false e pausadaAte null", async () => {
    await semearPronto(env.DB);
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    await contadorDoDia(59_000);
    const resultado = await runSyncSlice(
      AMBIENTE,
      { db: db(), fetch: pluggyFalsoEmMemoria(2) },
      { runId, seq: 0, tentativa: 1 },
      AGORA,
    );
    expect(resultado).toEqual({ tipo: "continua" });

    const importando = await importandoDoLar(banco.householdId);

    expect(importando).toHaveLength(1);
    expect(importando[0]).toMatchObject({ bankItemId: banco.itemId, pausada: false, pausadaAte: null });
  });

  it("depois da virada, a execução deixa de aparecer como pausada: a retomada espera o cron", async () => {
    await semearPronto(env.DB);
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    await contadorDoDia(60_000);
    await runSyncSlice(
      AMBIENTE,
      { db: db(), fetch: pluggyFalsoEmMemoria(2) },
      { runId, seq: 0, tentativa: 1 },
      AGORA,
    );

    const importando = await importandoDoLar(banco.householdId, DEPOIS_DA_VIRADA);

    expect(importando[0]).toMatchObject({ bankItemId: banco.itemId, pausada: false, pausadaAte: null });
  });
});
