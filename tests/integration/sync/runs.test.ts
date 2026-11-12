import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb, type Db } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import { nomeDaChave } from "../../../src/worker/pluggy/connections";
import { encryptSecret } from "../../../src/worker/security/crypto";
import { finishRunStmts, startRun } from "../../../src/worker/sync/runs";
import { semearLar } from "../helpers/sessao";

// Abertura de execução (startRun, TASK-0204): uma execução aberta por banco, garantida pelo NOT EXISTS do INSERT.
// Dados [TEST]; chaves fictícias.

const AGORA = "2026-11-10T12:00:00.000Z";
const DEPOIS = "2026-11-10T12:05:00.000Z";

const db = (): Db => createDb(env.DB, newMeter());

// Lar, conexão com chaves cifradas (TEST) e um banco. Sem execução ainda.
async function semearBanco(): Promise<{ householdId: string; itemId: string }> {
  const lar = await semearLar(env.DB, {
    memberId: crypto.randomUUID(),
    passkeyId: `cred-TEST-0204-${crypto.randomUUID()}`,
    email: `${crypto.randomUUID()}@example.com`,
  });
  const connectionId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const cifraId = await encryptSecret(
    env.MASTER_KEY,
    nomeDaChave(connectionId, "client_id"),
    "TEST-client-id-0204",
  );
  const cifraSegredo = await encryptSecret(
    env.MASTER_KEY,
    nomeDaChave(connectionId, "client_secret"),
    "TEST-segredo-0204",
  );
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO pluggy_connections (id, household_id, label, cpf_masked, client_id_enc, iv, client_secret_enc,
         client_secret_iv, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    ).bind(
      connectionId,
      lar.householdId,
      `[TEST] Conexão ${connectionId.slice(0, 6)}`,
      cifraId.ciphertext,
      cifraId.iv,
      cifraSegredo.ciphertext,
      cifraSegredo.iv,
      AGORA,
    ),
    env.DB.prepare(
      `INSERT INTO bank_items (id, connection_id, institution_name, institution_color, consent_expires_at, last_sync_at,
         status, disconnected_at, created_at) VALUES (?, ?, '[TEST] Banco', '#0E9A63', NULL, NULL, 'ativo', NULL, ?)`,
    ).bind(itemId, connectionId, AGORA),
  ]);
  return { householdId: lar.householdId, itemId };
}

async function execucao(runId: string) {
  return env.DB.prepare(
    "SELECT bank_item_id, kind, started_at, finished_at, status, cursor_json, slices_total, slices_done FROM sync_runs WHERE id = ?",
  )
    .bind(runId)
    .first<{
      bank_item_id: string;
      kind: string;
      started_at: string;
      finished_at: string | null;
      status: string | null;
      cursor_json: string;
      slices_total: number;
      slices_done: number;
    }>();
}

const contaDeExecucoesAbertas = async (bankItemId: string): Promise<number> => {
  const linha = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM sync_runs WHERE bank_item_id = ? AND finished_at IS NULL",
  )
    .bind(bankItemId)
    .first<{ n: number }>();
  return linha?.n ?? 0;
};

describe("startRun: uma execução aberta por banco", () => {
  it("cria a execução com o cursor inicial e devolve o id", async () => {
    const banco = await semearBanco();
    const runId = await startRun(db(), banco.itemId, "historico", AGORA);
    expect(runId).toEqual(expect.any(String));

    const linha = await execucao(runId as string);
    expect(linha).toMatchObject({
      bank_item_id: banco.itemId,
      kind: "historico",
      started_at: AGORA,
      finished_at: null,
      status: null,
      slices_total: 0,
      slices_done: 0,
    });
    expect(JSON.parse(linha?.cursor_json ?? "null")).toEqual({ seq: 0, phase: "inicio" });
  });

  it("com a execução ainda aberta, um segundo startRun do mesmo banco devolve null e não cria outra", async () => {
    const banco = await semearBanco();
    const primeira = await startRun(db(), banco.itemId, "historico", AGORA);
    expect(primeira).not.toBeNull();

    const segunda = await startRun(db(), banco.itemId, "diaria", DEPOIS);
    expect(segunda).toBeNull();
    expect(await contaDeExecucoesAbertas(banco.itemId)).toBe(1);
  });

  it("depois de encerrada (finished_at preenchido), startRun volta a criar", async () => {
    const banco = await semearBanco();
    const primeira = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;

    const d = db();
    await d.$client.batch(
      finishRunStmts(d, {
        runId: primeira,
        bankItemId: banco.itemId,
        status: "ok",
        errorCode: null,
        newTransactions: 0,
        now: DEPOIS,
        statusDoBanco: null,
        atualizaUltimaSincronizacao: true,
      }),
    );
    expect((await execucao(primeira))?.finished_at).toBe(DEPOIS);
    expect(await contaDeExecucoesAbertas(banco.itemId)).toBe(0);

    const nova = await startRun(db(), banco.itemId, "diaria", DEPOIS);
    expect(nova).not.toBeNull();
    expect(nova).not.toBe(primeira);
    expect((await execucao(nova as string))?.kind).toBe("diaria");
  });

  it("execuções de bancos diferentes não se bloqueiam", async () => {
    const primeiro = await semearBanco();
    const segundo = await semearBanco();

    const aberturaA = await startRun(db(), primeiro.itemId, "historico", AGORA);
    const aberturaB = await startRun(db(), segundo.itemId, "historico", AGORA);
    expect(aberturaA).not.toBeNull();
    expect(aberturaB).not.toBeNull();
    expect(aberturaB).not.toBe(aberturaA);
    expect(await contaDeExecucoesAbertas(primeiro.itemId)).toBe(1);
    expect(await contaDeExecucoesAbertas(segundo.itemId)).toBe(1);
  });
});
