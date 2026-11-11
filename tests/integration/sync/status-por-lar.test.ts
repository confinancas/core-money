import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/worker/app";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import type { Env } from "../../../src/worker/env";
import { SQL_DO_STATUS } from "../../../src/worker/sync/routes";
import { startRun } from "../../../src/worker/sync/runs";
import { callApi, semearPronto } from "../helpers/app";
import { semearLar } from "../helpers/sessao";

// GET /api/sync/status (TASK-0204, R5 e R13): cada lar vê só as execuções dos próprios bancos. A sessão de um lar não
// mostra a importação de outro, nem a que terminou nas últimas 24 horas.
const AGORA = "2026-11-10T12:00:00.000Z";
const AMBIENTE = env as unknown as Env;

type Lar = { householdId: string; bankItemId: string };

// Lar com um banco [TEST] e uma conexão. O banco ainda não tem execução.
async function semeiaLar(rotulo: string): Promise<Lar> {
  const lar = await semearLar(env.DB, {
    memberId: crypto.randomUUID(),
    passkeyId: `cred-TEST-0205-${crypto.randomUUID()}`,
    email: `${crypto.randomUUID()}@example.com`,
  });
  const connectionId = crypto.randomUUID();
  const bankItemId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO pluggy_connections (id, household_id, label, cpf_masked, client_id_enc, iv, client_secret_enc,
         client_secret_iv, created_at) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)`,
    ).bind(connectionId, lar.householdId, `[TEST] ${rotulo} ${connectionId.slice(0, 6)}`, AGORA),
    env.DB.prepare(
      `INSERT INTO bank_items (id, connection_id, institution_name, institution_color, consent_expires_at, last_sync_at,
         status, disconnected_at, created_at) VALUES (?, ?, ?, NULL, NULL, NULL, 'ativo', NULL, ?)`,
    ).bind(bankItemId, connectionId, `[TEST] ${rotulo}`, AGORA),
  ]);
  return { householdId: lar.householdId, bankItemId };
}

// Execução aberta do banco (a importação em andamento).
async function abreExecucao(banco: string): Promise<string> {
  return (await startRun(createDb(env.DB, newMeter()), banco, "historico", AGORA)) as string;
}

// Acrescenta um banco [TEST] a um lar (com a própria conexão), para o lar ter um banco com execução aberta e outro encerrado.
async function acrescentaBanco(householdId: string): Promise<string> {
  const connectionId = crypto.randomUUID();
  const bankItemId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO pluggy_connections (id, household_id, label, cpf_masked, client_id_enc, iv, client_secret_enc,
         client_secret_iv, created_at) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)`,
    ).bind(connectionId, householdId, `[TEST] Conexão extra ${connectionId.slice(0, 6)}`, AGORA),
    env.DB.prepare(
      `INSERT INTO bank_items (id, connection_id, institution_name, institution_color, consent_expires_at, last_sync_at,
         status, disconnected_at, created_at) VALUES (?, ?, '[TEST] Banco extra', NULL, NULL, NULL, 'ativo', NULL, ?)`,
    ).bind(bankItemId, connectionId, AGORA),
  ]);
  return bankItemId;
}

// Execução que terminou ok no instante dado (dentro das 24 horas do status).
async function encerraExecucao(banco: string, quando: string): Promise<string> {
  const id = await abreExecucao(banco);
  await env.DB.prepare("UPDATE sync_runs SET finished_at = ?, status = 'ok', progress_pct = 100 WHERE id = ?")
    .bind(quando, id)
    .run();
  return id;
}

// App com a sessão do lar dado (o resolvedor fixo que os testes da importação usam).
function appDoLar(householdId: string) {
  return createApp({
    resolveSession: async () => ({ memberId: "[TEST] membro", householdId }),
    agora: () => new Date(AGORA),
  });
}

type CorpoDoStatus = {
  importing: { bankItemId: string }[];
  recentlyFinished: { runId: string; bankItemId: string }[];
};

async function statusDoLar(householdId: string): Promise<CorpoDoStatus> {
  const resposta = await callApi(appDoLar(householdId), "GET", "/api/sync/status", undefined, {}, AMBIENTE);
  expect(resposta.status).toBe(200);
  return (await resposta.json()) as CorpoDoStatus;
}

describe("GET /api/sync/status: só o lar da sessão", () => {
  it("o lar A não vê a importação nem o término do lar B, e o B não vê os do A", async () => {
    await semearPronto(env.DB);
    const a = await semeiaLar("Lar A");
    const b = await semeiaLar("Lar B");
    const execucaoA = await abreExecucao(a.bankItemId);
    const bancoEncerradoDeA = await acrescentaBanco(a.householdId);
    const execucaoAEncerrada = await encerraExecucao(bancoEncerradoDeA, AGORA);
    await abreExecucao(b.bankItemId);

    const doA = await statusDoLar(a.householdId);
    expect(doA.importing.map((linha) => linha.bankItemId)).toEqual([a.bankItemId]);
    expect(doA.recentlyFinished.map((linha) => linha.runId)).toEqual([execucaoAEncerrada]);

    const doB = await statusDoLar(b.householdId);
    expect(doB.importing.map((linha) => linha.bankItemId)).toEqual([b.bankItemId]);
    expect(doB.recentlyFinished).toEqual([]);
    expect(JSON.stringify(doB)).not.toContain(a.bankItemId);
    expect(JSON.stringify(doB)).not.toContain(bancoEncerradoDeA);
    expect(JSON.stringify(doB)).not.toContain(execucaoA);
    expect(JSON.stringify(doB)).not.toContain(execucaoAEncerrada);
  });

  it("um lar sem bancos recebe o status vazio, mesmo com a importação de outro lar em andamento", async () => {
    await semearPronto(env.DB);
    const a = await semeiaLar("Lar A");
    await abreExecucao(a.bankItemId);
    const vazio = await semearLar(env.DB, {
      memberId: crypto.randomUUID(),
      passkeyId: `cred-TEST-0205-${crypto.randomUUID()}`,
      email: `${crypto.randomUUID()}@example.com`,
    });

    const corpo = await statusDoLar(vazio.householdId);

    expect(corpo).toEqual({ importing: [], recentlyFinished: [] });
  });

  it("a leitura do status fica nas execuções do próprio lar: 1.500 de outro lar não entram", async () => {
    await semeiaLar("Lar B");
    const b = await semeiaLar("Lar B2");
    const outro = await semeiaLar("Lar de 1.500");
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1500)
       INSERT INTO sync_runs (id, bank_item_id, kind, started_at, finished_at, status, new_transactions, progress_pct,
         slices_total, slices_done, retried, cursor_json, heartbeat_at)
       SELECT 'outro-' || i, ?1, 'historico', '2026-11-01T00:00:00.000Z', '2026-11-01T01:00:00.000Z', 'ok', 0, 100,
         1, 1, 0, NULL, '2026-11-01T01:00:00.000Z'
       FROM n`,
    )
      .bind(outro.bankItemId)
      .run();

    const resultado = await env.DB.prepare(SQL_DO_STATUS)
      .bind(b.householdId, b.householdId, "2026-11-09T12:00:00.000Z")
      .all();

    expect(resultado.results).toHaveLength(0);
    // Medido: poucas linhas (os bancos e a conexão do lar). Antes desta task: 1.500 mais as do lar, pela varredura.
    expect(resultado.meta.rows_read).toBeLessThanOrEqual(10);
  });
});
