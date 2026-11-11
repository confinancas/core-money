import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { pluggyFalsoEmMemoria } from "../../../src/worker/dev/pluggy-fake-fetch";
import { startRun } from "../../../src/worker/sync/runs";
import { runSyncSlice } from "../../../src/worker/sync/slice";
import {
  AGORA,
  AMBIENTE,
  type Busca,
  db,
  dbComFalha,
  execucao,
  rodar,
  semearBanco,
  urlDe,
} from "./importacao-helpers";

// Paradas e erros da importação que não tinham teste (TASK-0204, R13d).

const BASE = pluggyFalsoEmMemoria(2);

// O item do Meu Pluggy com os campos dados por cima de um item saudável.
function comItem(itemId: string, campos: Record<string, unknown>): Busca {
  return async (entrada, init) => {
    if (urlDe(entrada).pathname.startsWith("/items/")) {
      return new Response(
        JSON.stringify({
          id: itemId,
          connector: { id: 200, name: "MeuPluggy", type: "PERSONAL_BANK", isSandbox: false },
          status: "UPDATED",
          executionStatus: "SUCCESS",
          error: null,
          consentExpiresAt: "2027-10-01T00:00:00.000Z",
          ...campos,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return BASE(entrada, init);
  };
}

// Leitura de transações com 429 e o Retry-After dado.
function limitadoComRetryAfter(valor: string): Busca {
  return async (entrada, init) => {
    if (urlDe(entrada).pathname === "/v2/transactions") {
      return new Response(JSON.stringify({ code: "LIMITE" }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": valor },
      });
    }
    return BASE(entrada, init);
  };
}

describe("paradas da importação com ação do casal (TASK-0204, R13d)", () => {
  it("chaves apagadas: termina como sem_chaves e o banco vai para ação necessária", async () => {
    const banco = await semearBanco();
    await env.DB.prepare(
      "UPDATE pluggy_connections SET client_id_enc = NULL, client_secret_enc = NULL WHERE id = ?",
    )
      .bind(banco.connectionId)
      .run();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;

    const passos = await rodar(runId, BASE);
    expect(passos.at(-1)?.resultado).toEqual({ tipo: "encerrou", status: "erro", codigo: "sem_chaves" });
    expect(await execucao(runId)).toMatchObject({ error_code: "sem_chaves" });
    expect(await statusDoBanco(banco.itemId)).toBe("acao_necessaria");
  });

  it.each([
    ["o status do item é LOGIN_ERROR", { status: "LOGIN_ERROR" }],
    ["a autorização foi revogada no item", { error: { code: "USER_AUTHORIZATION_REVOKED" } }],
  ])("autorização vencida (%s): termina como autorizacao_vencida, sem repetir", async (_, campos) => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;

    const passos = await rodar(runId, comItem(banco.itemId, campos));
    expect(passos.at(-1)?.resultado).toEqual({
      tipo: "encerrou",
      status: "erro",
      codigo: "autorizacao_vencida",
    });
    expect(await statusDoBanco(banco.itemId)).toBe("acao_necessaria");
  });

  it("erro de código no meio da fatia termina como erro_inesperado e não mexe no status do banco", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    const resultado = await runSyncSlice(
      AMBIENTE,
      { db: dbComFalha(() => new TypeError("forma inesperada")), fetch: BASE },
      { runId, seq: 0, tentativa: 1 },
      AGORA,
    );
    expect(resultado).toEqual({ tipo: "encerrou", status: "erro", codigo: "erro_inesperado" });
    expect(await execucao(runId)).toMatchObject({ error_code: "erro_inesperado" });
    expect(await statusDoBanco(banco.itemId)).toBe("ativo");
  });

  it("item OUTDATED: o banco vai a instável e a execução segue até o fim ok", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;

    const passos = await rodar(runId, comItem(banco.itemId, { status: "OUTDATED" }));
    expect(passos.at(-1)?.resultado).toEqual({ tipo: "encerrou", status: "ok", codigo: null });
    expect(await execucao(runId)).toMatchObject({ status: "ok", progress_pct: 100 });
    expect(await statusDoBanco(banco.itemId)).toBe("instavel");
  });
});

describe("Retry-After do Pluggy na repetição (TASK-0204, R13d)", () => {
  it.each([
    ["9000", 9000],
    ["60", 300],
  ])(
    "Retry-After de %s s: a repetição espera o maior entre ele e a tabela (%i s)",
    async (valor, esperado) => {
      const banco = await semearBanco();
      const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
      await runSyncSlice(AMBIENTE, { db: db(), fetch: BASE }, { runId, seq: 0, tentativa: 1 }, AGORA);
      await runSyncSlice(AMBIENTE, { db: db(), fetch: BASE }, { runId, seq: 1, tentativa: 1 }, AGORA);

      const resultado = await runSyncSlice(
        AMBIENTE,
        { db: db(), fetch: limitadoComRetryAfter(valor) },
        { runId, seq: 2, tentativa: 1 },
        AGORA,
      );
      expect(resultado).toEqual({ tipo: "repete", atrasoSegundos: esperado });
    },
  );
});

async function statusDoBanco(bankItemId: string): Promise<string | undefined> {
  const linha = await env.DB.prepare("SELECT status FROM bank_items WHERE id = ?")
    .bind(bankItemId)
    .first<{ status: string }>();
  return linha?.status;
}
