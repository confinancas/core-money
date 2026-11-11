import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/worker/app";
import { despachar } from "../../../src/worker/cron/despachante";
import { createDb, type Db } from "../../../src/worker/db/client";
import { type Meter, newMeter } from "../../../src/worker/db/metered-d1";
import { pluggyFalsoEmMemoria } from "../../../src/worker/dev/pluggy-fake-fetch";
import type { Env } from "../../../src/worker/env";
import { nomeDaChave } from "../../../src/worker/pluggy/connections";
import { encryptSecret } from "../../../src/worker/security/crypto";
import { type SyncMessage, somaDias } from "../../../src/worker/sync/plan";
import { handleSyncBatch, type LoteDaFila, type MensagemDaFila } from "../../../src/worker/sync/queue";
import { startRun } from "../../../src/worker/sync/runs";
import { type ResultadoDaFatia, runSyncSlice } from "../../../src/worker/sync/slice";
import { callApi, semearPronto } from "../helpers/app";
import { semearLar } from "../helpers/sessao";

// Importação do histórico (TASK-0204): cenários 1 a 10, 12 e 13 da spec, com o Meu Pluggy falso e deps.fetch injetado.
// Nenhuma chamada sai do Worker de teste. Dados [TEST]; chaves fictícias.

const AGORA = "2026-11-10T12:00:00.000Z";
const HOJE = "2026-11-10";
const AMBIENTE = env as unknown as Env;
type Busca = typeof fetch;

type Banco = { householdId: string; connectionId: string; itemId: string };

// Lar, conexão com chaves cifradas (TEST) e um banco. Sem execução ainda.
async function semearBanco(): Promise<Banco> {
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
  return { householdId: lar.householdId, connectionId, itemId };
}

// Cada fatia tem o seu medidor: o teste confere quantas idas ao D1 ela fez.
type Passo = { resultado: ResultadoDaFatia; chamadasDaFatia: number };

// Roda fatias seguidas até encerrar, repetir ou pular; devolve cada passo com as idas ao D1 da fatia.
async function rodar(runId: string, fetch: Busca, seqInicial = 0, tentativa = 1): Promise<Passo[]> {
  const passos: Passo[] = [];
  let seq = seqInicial;
  for (let i = 0; i < 400; i++) {
    const medidor: Meter = newMeter();
    const db = createDb(env.DB, medidor);
    const resultado = await runSyncSlice(AMBIENTE, { db, fetch }, { runId, seq, tentativa }, AGORA);
    passos.push({ resultado, chamadasDaFatia: medidor.calls });
    if (resultado.tipo !== "continua") break;
    seq += 1;
  }
  return passos;
}

const db = (): Db => createDb(env.DB, newMeter());

async function execucao(runId: string) {
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

const contaDeTransacoes = async (bankItemId: string): Promise<number> => {
  const linha = await env.DB.prepare("SELECT COUNT(*) AS n FROM transactions WHERE bank_item_id = ?")
    .bind(bankItemId)
    .first<{ n: number }>();
  return linha?.n ?? 0;
};

// Fase, janela e totais que o D1 guarda agora. Leitura direta (fora do medidor): é a verificação do teste.
async function cursorDaExecucao(runId: string) {
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

const movimentoDe = async (transacaoId: string): Promise<string | null> => {
  const linha = await env.DB.prepare("SELECT movement FROM transactions WHERE id = ?")
    .bind(transacaoId)
    .first<{ movement: string }>();
  return linha?.movement ?? null;
};

describe("importação: caminho feliz (cenário 1) e mais nova primeiro (cenário 2)", () => {
  it("roda até o fim: status ok, progresso 100, linhas, faturas e a aberta, e cada fatia dentro de 20 chamadas", async () => {
    const banco = await semearBanco();
    const runId = await startRun(db(), banco.itemId, "historico", AGORA);
    expect(runId).not.toBeNull();
    const passos = await rodar(runId as string, pluggyFalsoEmMemoria(2));

    expect(passos.at(-1)?.resultado).toEqual({ tipo: "encerrou", status: "ok", codigo: null });
    expect(Math.max(...passos.map((passo) => passo.chamadasDaFatia))).toBeLessThanOrEqual(20);

    const run = await execucao(runId as string);
    expect(run).toMatchObject({ status: "ok", progress_pct: 100, retried: 0 });
    expect(run?.finished_at).not.toBeNull();
    expect(run?.new_transactions).toBe(await contaDeTransacoes(banco.itemId));

    const cartao = `${banco.itemId}-cartao`;
    const faturas = await env.DB.prepare("SELECT id, status FROM bills WHERE card_id = ? ORDER BY id")
      .bind(cartao)
      .all<{ id: string; status: string }>();
    expect(faturas.results).toEqual(
      expect.arrayContaining([
        { id: `${cartao}-fatura-anterior`, status: "paga" },
        { id: `sint:${cartao}:2026-11-03`, status: "aberta" },
      ]),
    );
    const banco2 = await env.DB.prepare("SELECT last_sync_at FROM bank_items WHERE id = ?")
      .bind(banco.itemId)
      .first<{ last_sync_at: string | null }>();
    expect(banco2?.last_sync_at).toBe(AGORA);
  });

  it("cenário 2: a primeira janela gravada é a de hoje", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    // Três fatias: inicio, faturas e a primeira janela de transações (a da conta corrente, a mais nova).
    const fetch = pluggyFalsoEmMemoria(1);
    for (let seq = 0; seq < 3; seq++) {
      await runSyncSlice(AMBIENTE, { db: db(), fetch }, { runId, seq, tentativa: 1 }, AGORA);
    }
    const maisAntiga = await env.DB.prepare(
      "SELECT MIN(local_date) AS d FROM transactions WHERE bank_item_id = ?",
    )
      .bind(banco.itemId)
      .first<{ d: string }>();
    const maisNova = await env.DB.prepare(
      "SELECT MAX(local_date) AS d FROM transactions WHERE bank_item_id = ?",
    )
      .bind(banco.itemId)
      .first<{ d: string }>();
    expect(maisNova?.d).toBe(HOJE);
    expect((maisAntiga?.d ?? "") >= "2025-11-12").toBe(true);
  });
});

describe("importação: paginação, página grande e idempotência (cenários 3 a 5)", () => {
  // Primeira janela da conta corrente: 500 linhas, em duas páginas (3 e 2 linhas) na primeira; o resto vazio.
  const comPaginas = (base: Busca, linhasDaPrimeira: number): Busca => {
    return async (entrada, init) => {
      const url = new URL(
        typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url,
      );
      if (url.pathname !== "/v2/transactions") return base(entrada, init);
      const eDaPrimeira =
        url.searchParams.get("dateTo") === HOJE &&
        url.searchParams.has("accountId") &&
        url.searchParams.get("accountId")?.endsWith("-corrente");
      const paginaDois = url.searchParams.has("after");
      const linhas = (n: number, prefixo: string) =>
        Array.from({ length: n }, (_, i) => ({
          id: `${prefixo}-${i}`,
          accountId: "x",
          date: `${HOJE}T15:00:00.000Z`,
          description: `[TEST] LINHA ${i}`,
          amount: -5,
          type: "DEBIT",
          category: null,
          operationType: "CARTAO",
          paymentData: null,
          creditCardMetadata: null,
        }));
      if (paginaDois) {
        return new Response(JSON.stringify({ results: linhas(2, "[TEST] p2"), next: null }), { status: 200 });
      }
      if (!eDaPrimeira) return new Response(JSON.stringify({ results: [], next: null }), { status: 200 });
      return new Response(
        JSON.stringify({ results: linhas(linhasDaPrimeira, "[TEST] p1"), next: "?accountId=x&after=p2" }),
        { status: 200 },
      );
    };
  };

  it("cenário 3: duas páginas entram inteiras, e 'next' é usado como veio", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    await rodar(runId, comPaginas(pluggyFalsoEmMemoria(0), 3));
    const linhas = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM transactions WHERE bank_item_id = ? AND local_date = ?",
    )
      .bind(banco.itemId, HOJE)
      .first<{ n: number }>();
    expect(linhas?.n).toBe(5);
  });

  it("cenário 4: uma página de 500 linhas entra em 3 fatias (200 + 200 + 100), sem duplicar", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    const base = pluggyFalsoEmMemoria(0);
    const grande: Busca = async (entrada, init) => {
      const url = new URL(
        typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url,
      );
      if (
        url.pathname === "/v2/transactions" &&
        url.searchParams.get("dateTo") === HOJE &&
        !url.searchParams.has("after") &&
        url.searchParams.get("accountId")?.endsWith("-corrente")
      ) {
        const results = Array.from({ length: 500 }, (_, i) => ({
          id: `[TEST] g-${i}`,
          accountId: "x",
          date: `${HOJE}T15:00:00.000Z`,
          description: `[TEST] GRANDE ${i}`,
          amount: -1,
          type: "DEBIT",
          category: null,
          operationType: "CARTAO",
          paymentData: null,
          creditCardMetadata: null,
        }));
        return new Response(JSON.stringify({ results, next: null }), { status: 200 });
      }
      return base(entrada, init);
    };
    // inicio, faturas e as três fatias da página grande: 200, 400 e 500 linhas gravadas.
    const passos: Passo[] = [];
    const medidor = newMeter();
    let seq = 0;
    for (let i = 0; i < 5; i++) {
      const resultado = await runSyncSlice(
        AMBIENTE,
        { db: createDb(env.DB, medidor), fetch: grande },
        { runId, seq, tentativa: 1 },
        AGORA,
      );
      passos.push({ resultado, chamadasDaFatia: 0 });
      seq += 1;
      if (i >= 2) {
        const n = await contaDeTransacoes(banco.itemId);
        expect(n).toBe(Math.min(500, (i - 1) * 200));
      }
    }
    expect(passos.every((passo) => passo.resultado.tipo === "continua")).toBe(true);
    expect(await contaDeTransacoes(banco.itemId)).toBe(500);
  });

  it("cenário 5: mensagem repetida não faz nada; rodar a importação de novo não muda o número de transações", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    const fetch = pluggyFalsoEmMemoria(2);
    const primeiro = await runSyncSlice(
      AMBIENTE,
      { db: db(), fetch },
      { runId, seq: 0, tentativa: 1 },
      AGORA,
    );
    expect(primeiro.tipo).toBe("continua");
    const repetida = await runSyncSlice(
      AMBIENTE,
      { db: db(), fetch },
      { runId, seq: 0, tentativa: 1 },
      AGORA,
    );
    expect(repetida).toEqual({ tipo: "pulou" });

    await rodar(runId, fetch, 1);
    const depois = await contaDeTransacoes(banco.itemId);

    // Segunda importação do mesmo banco: não cria linha nova; as existentes são só atualizadas.
    const segunda = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    expect(segunda).not.toBeNull();
    await rodar(segunda, fetch);
    expect(await contaDeTransacoes(banco.itemId)).toBe(depois);
    expect((await execucao(segunda))?.new_transactions).toBe(0);
  });
});

describe("guarda da mensagem repetida (seq de runSyncSlice)", () => {
  it("mensagem de seq antigo (cursor já em seq 3) é pulada: nenhuma chamada ao Pluggy e no máximo 1 ida ao D1", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    const base = pluggyFalsoEmMemoria(2);
    let chamadasAoPluggy = 0;
    const fetch: Busca = async (entrada, init) => {
      chamadasAoPluggy += 1;
      return base(entrada, init);
    };
    // inicio (seq 0), faturas (seq 1) e a primeira fatia de transações (seq 2) passam normalmente.
    for (const seq of [0, 1, 2]) {
      expect(await runSyncSlice(AMBIENTE, { db: db(), fetch }, { runId, seq, tentativa: 1 }, AGORA)).toEqual({
        tipo: "continua",
      });
    }
    expect((await cursorDaExecucao(runId)).seq).toBe(3);

    // A mensagem de seq 2 chega de novo: o cursor já está em seq 3, então a fatia não pode trabalhar.
    const chamadasAntes = chamadasAoPluggy;
    const medidor = newMeter();
    const repetida = await runSyncSlice(
      AMBIENTE,
      { db: createDb(env.DB, medidor), fetch },
      { runId, seq: 2, tentativa: 1 },
      AGORA,
    );
    expect(repetida).toEqual({ tipo: "pulou" });
    expect(chamadasAoPluggy - chamadasAntes).toBe(0);
    expect(medidor.calls).toBeLessThanOrEqual(1);
    expect((await cursorDaExecucao(runId)).seq).toBe(3);
  });
});

describe("importação: repetição e paradas (cenários 6 a 9)", () => {
  it("cenário 6: 503 no meio volta para a fila com 300 s; quando passa, o fim é repetiu", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    const base = pluggyFalsoEmMemoria(2);
    let falhou = false;
    const instavel: Busca = async (entrada, init) => {
      const url = new URL(
        typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url,
      );
      if (url.pathname === "/v2/transactions" && !falhou) {
        falhou = true;
        return new Response(JSON.stringify({ code: "INDISPONIVEL" }), { status: 503 });
      }
      return base(entrada, init);
    };
    const passos = await rodar(runId, instavel);
    expect(passos[0]?.resultado).toEqual({ tipo: "continua" });
    const repete = passos.find((passo) => passo.resultado.tipo === "repete");
    expect(repete?.resultado).toEqual({ tipo: "repete", atrasoSegundos: 300 });
    expect((await execucao(runId))?.retried).toBe(1);

    // A mensagem volta com tentativa 2 e a mesma seq: a fatia passa, e a execução acaba como repetiu.
    const seqDaRepeticao = passos.findIndex((passo) => passo.resultado.tipo === "repete");
    const retomadas = await rodar(runId, base, seqDaRepeticao, 2);
    expect(retomadas.at(-1)?.resultado).toEqual({ tipo: "encerrou", status: "repetiu", codigo: null });
    expect((await execucao(runId))?.status).toBe("repetiu");
  });

  it("cenário 7: quatro falhas seguidas terminam como instavel, com banco_instavel; o que já entrou fica", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    const base = pluggyFalsoEmMemoria(2);
    const tudoFalha: Busca = async (entrada, init) => {
      const url = new URL(
        typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url,
      );
      if (url.pathname === "/v2/transactions") return new Response("{}", { status: 503 });
      return base(entrada, init);
    };
    // inicio (seq 0) e faturas (seq 1) passam; a leitura de transações (seq 2) falha em todas as tentativas.
    await runSyncSlice(AMBIENTE, { db: db(), fetch: base }, { runId, seq: 0, tentativa: 1 }, AGORA);
    await runSyncSlice(AMBIENTE, { db: db(), fetch: base }, { runId, seq: 1, tentativa: 1 }, AGORA);
    const atrasos: ResultadoDaFatia[] = [];
    for (const tentativa of [1, 2, 3, 4]) {
      atrasos.push(
        await runSyncSlice(AMBIENTE, { db: db(), fetch: tudoFalha }, { runId, seq: 2, tentativa }, AGORA),
      );
    }
    expect(atrasos.slice(0, 3)).toEqual([
      { tipo: "repete", atrasoSegundos: 300 },
      { tipo: "repete", atrasoSegundos: 1800 },
      { tipo: "repete", atrasoSegundos: 7200 },
    ]);
    expect(atrasos[3]).toEqual({ tipo: "encerrou", status: "instavel", codigo: "banco_instavel" });
    const run = await execucao(runId);
    expect(run).toMatchObject({ status: "instavel", error_code: "banco_instavel" });
    const banco2 = await env.DB.prepare("SELECT status FROM bank_items WHERE id = ?")
      .bind(banco.itemId)
      .first<{ status: string }>();
    expect(banco2?.status).toBe("instavel");
  });

  it("cenário 8: chave recusada no /auth termina como chaves_invalidas, sem repetir; o banco vai para ação necessária", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    const recusada: Busca = async (entrada, init) => {
      const url = new URL(
        typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url,
      );
      if (url.pathname === "/auth")
        return new Response(JSON.stringify({ code: "CLIENT_KEYS_UNAUTHORIZED" }), { status: 401 });
      return pluggyFalsoEmMemoria(1)(entrada, init);
    };
    const passos = await rodar(runId, recusada);
    expect(passos.at(-1)?.resultado).toEqual({
      tipo: "encerrou",
      status: "erro",
      codigo: "chaves_invalidas",
    });
    expect((await execucao(runId))?.error_code).toBe("chaves_invalidas");
    const banco2 = await env.DB.prepare("SELECT status FROM bank_items WHERE id = ?")
      .bind(banco.itemId)
      .first<{ status: string }>();
    expect(banco2?.status).toBe("acao_necessaria");
  });

  it("cenário 9: consentimento vencido termina sem ler nenhuma transação", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    let leituras = 0;
    const vencido: Busca = async (entrada, init) => {
      const url = new URL(
        typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url,
      );
      if (url.pathname === "/v2/transactions") leituras += 1;
      if (url.pathname.startsWith("/items/")) {
        return new Response(
          JSON.stringify({
            id: banco.itemId,
            connector: { id: 200, name: "MeuPluggy", type: "PERSONAL_BANK" },
            status: "UPDATED",
            executionStatus: "SUCCESS",
            error: null,
            consentExpiresAt: "2026-01-01T00:00:00.000Z",
          }),
          { status: 200 },
        );
      }
      return pluggyFalsoEmMemoria(1)(entrada, init);
    };
    const passos = await rodar(runId, vencido);
    expect(passos.at(-1)?.resultado).toEqual({
      tipo: "encerrou",
      status: "erro",
      codigo: "consentimento_vencido",
    });
    expect(leituras).toBe(0);
  });

  it("item inexistente no Pluggy termina como item_inexistente", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    const inexistente: Busca = async (entrada, init) => {
      const url = new URL(
        typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url,
      );
      if (url.pathname.startsWith("/items/")) return new Response("{}", { status: 404 });
      return pluggyFalsoEmMemoria(1)(entrada, init);
    };
    const passos = await rodar(runId, inexistente);
    expect(passos.at(-1)?.resultado).toEqual({
      tipo: "encerrou",
      status: "erro",
      codigo: "item_inexistente",
    });
  });
});

describe("importação: fila, cron e dois bancos (cenários 10 a 12)", () => {
  it("cenário 10: execução aberta sem mensagem e com heartbeat de 20 min: o cron reenfileira e ela termina", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    await env.DB.prepare("UPDATE sync_runs SET heartbeat_at = ? WHERE id = ?")
      .bind("2026-11-10T11:40:00.000Z", runId)
      .run();

    const fila: SyncMessage[] = [];
    const ambiente = {
      ...AMBIENTE,
      SYNC_QUEUE: { send: async (mensagem: SyncMessage) => void fila.push(mensagem) },
    } as unknown as Env;
    await despachar(ambiente, new Date(AGORA));
    expect(fila).toEqual([{ runId, seq: 0 }]);

    const fetch = pluggyFalsoEmMemoria(2);
    for (let i = 0; i < 400 && fila.length > 0; i++) {
      const mensagem = fila.shift() as SyncMessage;
      const lote: LoteDaFila = {
        messages: [
          {
            body: mensagem,
            attempts: 1,
            ack() {},
            retry() {
              throw new Error("não devia repetir");
            },
          } satisfies MensagemDaFila,
        ],
      };
      await handleSyncBatch(lote, ambiente, { agora: () => new Date(AGORA), fetch });
    }
    expect((await execucao(runId))?.status).toBe("ok");
  });

  it("cenário 12: dois bancos alternam fatias e os dois terminam", async () => {
    const primeiro = await semearBanco();
    const segundo = await semearBanco();
    const runA = (await startRun(db(), primeiro.itemId, "historico", AGORA)) as string;
    const runB = (await startRun(db(), segundo.itemId, "historico", AGORA)) as string;
    const fetch = pluggyFalsoEmMemoria(1);
    const seqs = { a: 0, b: 0 };
    const feitos = { a: false, b: false };
    for (let i = 0; i < 400 && !(feitos.a && feitos.b); i++) {
      for (const alvo of ["a", "b"] as const) {
        if (feitos[alvo]) continue;
        const runId = alvo === "a" ? runA : runB;
        const resultado = await runSyncSlice(
          AMBIENTE,
          { db: db(), fetch },
          { runId, seq: seqs[alvo], tentativa: 1 },
          AGORA,
        );
        if (resultado.tipo === "continua") seqs[alvo] += 1;
        else feitos[alvo] = true;
      }
    }
    expect((await execucao(runA))?.status).toBe("ok");
    expect((await execucao(runB))?.status).toBe("ok");
  });
});

type Leitura = {
  fase: string;
  w: number;
  totalAntes: number;
  feitasAntes: number;
  idasAoD1: number;
  chamadasAoPluggy: number;
  movimentoApos: string | null;
};

describe("importação: conciliação em 25 janelas depois das transações (fase conciliar)", () => {
  it("25 fatias de conciliação (w de 0 a 24) depois das transações; a fim é a última; o total cresce em 25", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    const base = pluggyFalsoEmMemoria(2);
    let chamadasAoPluggy = 0;
    const fetch: Busca = async (entrada, init) => {
      chamadasAoPluggy += 1;
      return base(entrada, init);
    };

    // inicio (seq 0) grava o cartão. Depois, uma entrada de fatura de 370 dias: só a janela de w = 24 (que cobre de 360 a
    // 375 dias) a concilia. Antes dela, a linha fica como pagamento de fatura.
    expect(await runSyncSlice(AMBIENTE, { db: db(), fetch }, { runId, seq: 0, tentativa: 1 }, AGORA)).toEqual(
      {
        tipo: "continua",
      },
    );
    const idAntiga = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO transactions (id, household_id, external_id, bank_item_id, card_id, movement, occurred_at, local_date,
         amount_cents, original_description, last_seen_at, provider_operation_type)
       VALUES (?, ?, ?, ?, ?, 'pagamento_fatura', ?, ?, 25000, '[TEST] PAGAMENTO FATURA ANTIGA', ?, 'PAGAMENTO_FATURA')`,
    )
      .bind(
        idAntiga,
        banco.householdId,
        `[TEST] antiga-${idAntiga}`,
        banco.itemId,
        `${banco.itemId}-cartao`,
        `${somaDias(HOJE, -370)}T12:00:00.000Z`,
        somaDias(HOJE, -370),
        AGORA,
      )
      .run();

    const leituras: Leitura[] = [];
    let resultado: ResultadoDaFatia = { tipo: "continua" };
    let seq = 1;
    for (let i = 0; i < 400 && resultado.tipo === "continua"; i++) {
      const antes = await cursorDaExecucao(runId);
      const medidor = newMeter();
      const pluggyAntes = chamadasAoPluggy;
      resultado = await runSyncSlice(
        AMBIENTE,
        { db: createDb(env.DB, medidor), fetch },
        { runId, seq, tentativa: 1 },
        AGORA,
      );
      leituras.push({
        fase: antes.phase,
        w: antes.w,
        totalAntes: antes.slices_total,
        feitasAntes: antes.slices_done,
        idasAoD1: medidor.calls,
        chamadasAoPluggy: chamadasAoPluggy - pluggyAntes,
        movimentoApos: await movimentoDe(idAntiga),
      });
      seq += 1;
    }
    expect(resultado).toEqual({ tipo: "encerrou", status: "ok", codigo: null });

    const fases = leituras.map((leitura) => leitura.fase);
    expect(fases.at(-1)).toBe("fim");
    expect(fases.filter((fase) => fase === "fim")).toHaveLength(1);

    const conciliacoes = leituras.filter((leitura) => leitura.fase === "conciliar");
    expect(conciliacoes.map((leitura) => leitura.w)).toEqual(Array.from({ length: 25 }, (_, k) => k));
    // As 25 fatias são contíguas, depois das transações e antes da fim.
    expect(fases.indexOf("fim") - fases.indexOf("conciliar")).toBe(25);
    expect(fases.lastIndexOf("transacoes")).toBeLessThan(fases.indexOf("conciliar"));
    // Nenhuma fatia de conciliação chama o Pluggy; cada uma faz poucas idas ao D1 (ler a execução, conciliar, gravar o cursor).
    expect(Math.max(...conciliacoes.map((leitura) => leitura.chamadasAoPluggy))).toBe(0);
    expect(Math.max(...conciliacoes.map((leitura) => leitura.idasAoD1))).toBeLessThanOrEqual(4);

    // O total cresce em 25 quando a fase transacoes acaba: a última fatia de transações é a que vê o total de importação.
    const ultimaDeTransacoes = leituras.filter((leitura) => leitura.fase === "transacoes").at(-1);
    const totalDaImportacao = ultimaDeTransacoes?.totalAntes ?? -1;
    expect(conciliacoes[0]?.totalAntes).toBe(totalDaImportacao + 25);
    expect(conciliacoes[0]?.feitasAntes).toBe(totalDaImportacao);

    // A janela mais antiga (w = 24) é a que muda a linha de 370 dias; as janelas antes dela não tocam nela.
    const indiceDaJanelaMaisAntiga = leituras.findIndex(
      (leitura) => leitura.fase === "conciliar" && leitura.w === 24,
    );
    expect(
      leituras
        .slice(0, indiceDaJanelaMaisAntiga)
        .every((leitura) => leitura.movimentoApos === "pagamento_fatura"),
    ).toBe(true);
    expect(leituras[indiceDaJanelaMaisAntiga]?.movimentoApos).toBe("pix_recebido");

    const run = await execucao(runId);
    expect(run).toMatchObject({ status: "ok", progress_pct: 100, retried: 0 });
    expect(run?.slices_total).toBe(totalDaImportacao + 25);
    expect(run?.slices_done).toBe(run?.slices_total);
  });
});

describe("rotas de medição e estado da importação (cenário 13 e status)", () => {
  it("cenário 13: sem DEV_ROUTES, POST /api/dev/sync-slice responde 404", async () => {
    const app = createApp();
    await semearPronto(env.DB);
    const resposta = await callApi(app, "POST", "/api/dev/sync-slice", { rows: 200 }, {}, AMBIENTE);
    expect(resposta.status).toBe(404);
  });

  it("GET /api/sync/status: mostra a importação em andamento e, depois, o terminado nas últimas 24 h", async () => {
    const banco = await semearBanco();
    await semearPronto(env.DB);
    const app = createApp({
      resolveSession: async () => ({ memberId: "[TEST] m", householdId: banco.householdId }),
      agora: () => new Date(AGORA),
    });
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    const emAndamento = await callApi(app, "GET", "/api/sync/status", undefined, {}, AMBIENTE);
    expect(emAndamento.status).toBe(200);
    const corpoA = (await emAndamento.json()) as {
      importing: { bankItemId: string }[];
      recentlyFinished: unknown[];
    };
    expect(corpoA.importing.map((linha) => linha.bankItemId)).toEqual([banco.itemId]);

    await rodar(runId, pluggyFalsoEmMemoria(1));
    const depois = await callApi(app, "GET", "/api/sync/status", undefined, {}, AMBIENTE);
    const corpoB = (await depois.json()) as {
      importing: unknown[];
      recentlyFinished: { runId: string; status: string }[];
    };
    expect(corpoB.importing).toEqual([]);
    expect(corpoB.recentlyFinished).toEqual([expect.objectContaining({ runId, status: "ok" })]);
  });
});
