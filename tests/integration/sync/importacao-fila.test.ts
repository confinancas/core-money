import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { retomarImportacoes } from "../../../src/worker/cron/tarefas";
import { pluggyFalsoEmMemoria } from "../../../src/worker/dev/pluggy-fake-fetch";
import type { Env } from "../../../src/worker/env";
import type { SyncMessage } from "../../../src/worker/sync/plan";
import { handleSyncBatch, type MensagemDaFila } from "../../../src/worker/sync/queue";
import { startRun } from "../../../src/worker/sync/runs";
import { runSyncSlice } from "../../../src/worker/sync/slice";
import { AGORA, AMBIENTE, type Busca, db, execucao, HOJE, semearBanco, urlDe } from "./importacao-helpers";

// Testes da fila de sincronização (TASK-0204, R13a e R13b): a mensagem passa pelo handleSyncBatch, não só pela fatia.

// O Meu Pluggy falso, com a leitura de transações fora do ar (503) em toda chamada.
const transacoesFalham: Busca = async (entrada, init) => {
  if (urlDe(entrada).pathname === "/v2/transactions") {
    return new Response(JSON.stringify({ code: "INDISPONIVEL" }), { status: 503 });
  }
  return pluggyFalsoEmMemoria(2)(entrada, init);
};

// Inicio (seq 0) e faturas (seq 1) passam; a próxima mensagem é a leitura de transações (seq 2).
async function execucaoAteAsTransacoes(): Promise<{ runId: string }> {
  const banco = await semearBanco();
  const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
  const fetch = pluggyFalsoEmMemoria(2);
  await runSyncSlice(AMBIENTE, { db: db(), fetch }, { runId, seq: 0, tentativa: 1 }, AGORA);
  await runSyncSlice(AMBIENTE, { db: db(), fetch }, { runId, seq: 1, tentativa: 1 }, AGORA);
  return { runId };
}

function mensagemDaFila(runId: string, seq: number, tentativas: number, registro: string[]): MensagemDaFila {
  return {
    body: { runId, seq } satisfies SyncMessage,
    attempts: tentativas,
    ack() {
      registro.push("ack");
    },
    retry(opcoes) {
      registro.push(`retry ${opcoes?.delaySeconds ?? "sem atraso"}`);
    },
  };
}

describe("fila: a repetição vira retry com o atraso da tabela (TASK-0204, R13a)", () => {
  it("a mensagem volta com 300 s na primeira tentativa, 1800 s na segunda, e a quarta vai a instável sem retry", async () => {
    const { runId } = await execucaoAteAsTransacoes();
    const registro: string[] = [];
    for (const tentativas of [1, 2, 4]) {
      await handleSyncBatch({ messages: [mensagemDaFila(runId, 2, tentativas, registro)] }, AMBIENTE, {
        agora: () => new Date(AGORA),
        fetch: transacoesFalham,
      });
    }
    expect(registro).toEqual(["retry 300", "retry 1800", "ack"]);
    expect(await execucao(runId)).toMatchObject({ status: "instavel", error_code: "banco_instavel" });
  });
});

describe("cron: a repetição grava o heartbeat no futuro e não reenfileira antes dele (TASK-0204, R13b)", () => {
  it("o heartbeat vai para agora mais o atraso; o cron espera o heartbeat e a margem de 15 min antes de reenfileirar", async () => {
    const { runId } = await execucaoAteAsTransacoes();
    const registro: string[] = [];
    await handleSyncBatch({ messages: [mensagemDaFila(runId, 2, 1, registro)] }, AMBIENTE, {
      agora: () => new Date(AGORA),
      fetch: transacoesFalham,
    });
    expect(registro).toEqual(["retry 300"]);

    const linha = await env.DB.prepare("SELECT heartbeat_at, retried FROM sync_runs WHERE id = ?")
      .bind(runId)
      .first<{ heartbeat_at: string; retried: number }>();
    expect(linha).toEqual({ heartbeat_at: "2026-11-10T12:05:00.000Z", retried: 1 });

    const enfileiradas: SyncMessage[] = [];
    const ambiente = {
      ...AMBIENTE,
      SYNC_QUEUE: {
        send: async (mensagem: SyncMessage) => {
          enfileiradas.push(mensagem);
        },
      },
    } as unknown as Env;
    // O cron roda a cada 5 minutos: antes do heartbeat (e logo depois dele) não reenfileira.
    expect(await retomarImportacoes.executar(ambiente, new Date(AGORA), db())).toBe(false);
    expect(await retomarImportacoes.executar(ambiente, new Date("2026-11-10T12:10:00.000Z"), db())).toBe(
      false,
    );
    expect(enfileiradas).toEqual([]);
    // Passados 15 min do heartbeat, reenfileira a fatia que parou (seq 2, o cursor não andou).
    expect(await retomarImportacoes.executar(ambiente, new Date("2026-11-10T12:21:00.000Z"), db())).toBe(
      true,
    );
    expect(enfileiradas).toEqual([{ runId, seq: 2 }]);
  });
});

describe("fila: a fatia entra no contador do dia (TASK-0109, R4)", () => {
  it("as escritas de uma fatia da fila aparecem em usage_daily, para o teto de escritas ler", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    const registro: string[] = [];
    const enfileiradas: SyncMessage[] = [];
    const ambiente = {
      ...AMBIENTE,
      SYNC_QUEUE: {
        send: async (mensagem: SyncMessage) => {
          enfileiradas.push(mensagem);
        },
      },
    } as unknown as Env;

    await handleSyncBatch({ messages: [mensagemDaFila(runId, 0, 1, registro)] }, ambiente, {
      agora: () => new Date(AGORA),
      fetch: pluggyFalsoEmMemoria(2),
    });
    expect(registro).toEqual(["ack"]);
    expect(enfileiradas).toEqual([{ runId, seq: 1 }]);

    const contador = await env.DB.prepare("SELECT rows_written FROM usage_daily WHERE day = ?")
      .bind(HOJE)
      .first<{ rows_written: number }>();
    expect(contador?.rows_written ?? 0).toBeGreaterThan(0);
  });
});
