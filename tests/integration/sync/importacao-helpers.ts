import { env } from "cloudflare:test";
import { createDb, type Db } from "../../../src/worker/db/client";
import { type Meter, newMeter } from "../../../src/worker/db/metered-d1";
import type { Env } from "../../../src/worker/env";
import { nomeDaChave } from "../../../src/worker/pluggy/connections";
import { encryptSecret } from "../../../src/worker/security/crypto";
import { type ResultadoDaFatia, runSyncSlice } from "../../../src/worker/sync/slice";
import { semearLar } from "../helpers/sessao";

// Auxiliares dos testes da importação do histórico (TASK-0204). Não é um arquivo de testes: os casos ficam nos
// arquivos *.test.ts desta pasta. Dados [TEST]; chaves fictícias.

export const AGORA = "2026-11-10T12:00:00.000Z";
export const HOJE = "2026-11-10";
export const AMBIENTE = env as unknown as Env;
export type Busca = typeof fetch;

// URL de uma chamada do fetch falso (texto, URL ou Request).
export const urlDe = (entrada: RequestInfo | URL): URL =>
  new URL(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url);

export type Banco = { householdId: string; memberId: string; connectionId: string; itemId: string };

// Lar, conexão com chaves cifradas (TEST) e um banco. Sem execução ainda.
export async function semearBanco(): Promise<Banco> {
  // Passkey e membro próprios: a suíte pode criar vários lares no mesmo teste.
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
  return { householdId: lar.householdId, memberId: lar.memberId, connectionId, itemId };
}

// Cada fatia tem o seu medidor: o teste confere quantas idas ao D1 ela fez.
export type Passo = { resultado: ResultadoDaFatia; chamadasDaFatia: number };

// Roda fatias seguidas até encerrar, repetir ou pular; devolve cada passo com as idas ao D1 da fatia.
export async function rodar(
  runId: string,
  fetch: Busca,
  seqInicial = 0,
  tentativa = 1,
  agora = AGORA,
): Promise<Passo[]> {
  const passos: Passo[] = [];
  let seq = seqInicial;
  for (let i = 0; i < 400; i++) {
    const medidor: Meter = newMeter();
    const db = createDb(env.DB, medidor);
    const resultado = await runSyncSlice(AMBIENTE, { db, fetch }, { runId, seq, tentativa }, agora);
    passos.push({ resultado, chamadasDaFatia: medidor.calls });
    if (resultado.tipo !== "continua") break;
    seq += 1;
  }
  return passos;
}

export const db = (): Db => createDb(env.DB, newMeter());

export async function execucao(runId: string) {
  return env.DB.prepare(
    "SELECT status, progress_pct, new_transactions, finished_at, retried, error_code, slices_done, slices_total FROM sync_runs WHERE id = ?",
  )
    .bind(runId)
    .first<{
      status: string | null;
      progress_pct: number;
      new_transactions: number;
      finished_at: string | null;
      retried: number;
      error_code: string | null;
      slices_done: number;
      slices_total: number;
    }>();
}

export const contaDeTransacoes = async (bankItemId: string): Promise<number> => {
  const linha = await env.DB.prepare("SELECT COUNT(*) AS n FROM transactions WHERE bank_item_id = ?")
    .bind(bankItemId)
    .first<{ n: number }>();
  return linha?.n ?? 0;
};

// Fase, janela e totais que o D1 guarda agora. Leitura direta (fora do medidor): é a verificação do teste.
export async function cursorDaExecucao(runId: string) {
  const linha = await env.DB.prepare(
    "SELECT cursor_json, slices_total, slices_done FROM sync_runs WHERE id = ?",
  )
    .bind(runId)
    .first<{ cursor_json: string; slices_total: number; slices_done: number }>();
  const cursor = JSON.parse(linha?.cursor_json ?? "{}") as { seq?: number; phase?: string; w?: number };
  return {
    seq: cursor.seq ?? 0,
    phase: cursor.phase ?? "inicio",
    w: cursor.w ?? 0,
    slices_total: linha?.slices_total ?? 0,
    slices_done: linha?.slices_done ?? 0,
  };
}

export const movimentoDe = async (transacaoId: string): Promise<string | null> => {
  const linha = await env.DB.prepare("SELECT movement FROM transactions WHERE id = ?")
    .bind(transacaoId)
    .first<{ movement: string }>();
  return linha?.movement ?? null;
};

// Um Db cuja primeira escrita (run ou lote) falha com o erro dado; as seguintes passam. Só para simular a queda do D1
// no meio de uma fatia: o resto (inclusive o drizzle do select) é o banco real. Os comandos preparados por ele entram
// no lote dele, como manda o medidor (metered-d1).
export function dbComFalha(erro: () => Error, falhas = 1): Db {
  const real = createDb(env.DB, newMeter());
  const d1 = real.$client;
  const originais = new WeakMap<object, D1PreparedStatement>();
  let restantes = falhas;
  const falha = (): void => {
    if (restantes > 0) {
      restantes -= 1;
      throw erro();
    }
  };
  const embrulha = (stmt: D1PreparedStatement): D1PreparedStatement => {
    const embrulhado = {
      bind: (...valores: unknown[]) => embrulha(stmt.bind(...valores)),
      run: async () => {
        falha();
        return stmt.run();
      },
      all: () => stmt.all(),
      first: (coluna?: string) => (coluna === undefined ? stmt.first() : stmt.first(coluna)),
    };
    originais.set(embrulhado, stmt);
    return embrulhado as unknown as D1PreparedStatement;
  };
  const cliente = {
    prepare: (sql: string) => embrulha(d1.prepare(sql)),
    batch: async (comandos: D1PreparedStatement[]) => {
      falha();
      return d1.batch(comandos.map((comando) => originais.get(comando) ?? comando));
    },
    exec: (sql: string) => d1.exec(sql),
    dump: () => d1.dump(),
  } as unknown as D1Database;
  return new Proxy(real, {
    get(alvo, propriedade) {
      if (propriedade === "$client") return cliente;
      const valor = Reflect.get(alvo, propriedade, alvo);
      return typeof valor === "function" ? valor.bind(alvo) : valor;
    },
  }) as Db;
}
