import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { CreatedConnectionResponse } from "../../../src/shared/pluggy-api";
import type { Env } from "../../../src/worker/env";
import type { SyncMessage } from "../../../src/worker/sync/plan";
import { COOKIE_DO_TITULAR, criaLarDeDuas } from "../helpers/aparelhos";
import { callApi, semearPronto } from "../helpers/app";
import {
  appComPluggy,
  CLIENT_ID_VALIDO,
  ITEM_A,
  ITEM_B,
  pluggyFalso,
  SEGREDO_VALIDO,
} from "../helpers/pluggy";

// Começo da importação (TASK-0204, item 9 do escopo): conectar um banco e acrescentar outro abrem a execução do histórico
// e mandam a primeira fatia para a fila ({runId, seq: 0}). A fila é falsa (guarda as mensagens); o Meu Pluggy é o falso.
const CHAVES = { clientId: CLIENT_ID_VALIDO, clientSecret: SEGREDO_VALIDO };

beforeEach(async () => {
  await semearPronto(env.DB);
  await criaLarDeDuas();
});

// Ambiente do teste: o D1 de teste e uma fila que guarda as mensagens enviadas.
function ambienteComFila(fila: SyncMessage[]): Env {
  return {
    ...env,
    SYNC_QUEUE: { send: async (mensagem: SyncMessage) => void fila.push(mensagem) },
  } as unknown as Env;
}

async function execucaoAberta(bancoId: string): Promise<string | null> {
  const linha = await env.DB.prepare(
    "SELECT id FROM sync_runs WHERE bank_item_id = ? AND finished_at IS NULL",
  )
    .bind(bancoId)
    .first<{ id: string }>();
  return linha?.id ?? null;
}

describe("começo da importação: conectar e acrescentar banco", () => {
  it("conectar um banco abre a execução do histórico e manda {runId, seq: 0} para a fila", async () => {
    const app = appComPluggy(pluggyFalso());
    const fila: SyncMessage[] = [];

    const resposta = await callApi(
      app,
      "POST",
      "/api/pluggy-connections",
      { label: "[TEST] Conta da importação", ...CHAVES, items: [{ itemId: ITEM_A }] },
      { cookie: COOKIE_DO_TITULAR },
      ambienteComFila(fila),
    );

    expect(resposta.status).toBe(201);
    const corpo = (await resposta.json()) as CreatedConnectionResponse;
    expect(corpo.bankItems.map((banco) => banco.id)).toEqual([ITEM_A]);
    const runId = await execucaoAberta(ITEM_A);
    expect(runId).not.toBeNull();
    expect(fila).toEqual([{ runId, seq: 0 }]);
  });

  it("acrescentar um banco a uma conexão abre a execução dele e manda a primeira fatia para a fila", async () => {
    const app = appComPluggy(pluggyFalso());
    const fila: SyncMessage[] = [];
    const criada = await callApi(
      app,
      "POST",
      "/api/pluggy-connections",
      { label: "[TEST] Conta de dois bancos", ...CHAVES, items: [{ itemId: ITEM_A }] },
      { cookie: COOKIE_DO_TITULAR },
      ambienteComFila(fila),
    );
    const { connection } = (await criada.json()) as CreatedConnectionResponse;
    // Só interessa a mensagem do banco acrescentado: a da conexão fica de fora.
    fila.length = 0;

    const acrescentado = await callApi(
      app,
      "POST",
      `/api/pluggy-connections/${connection.id}/bank-items`,
      { items: [{ itemId: ITEM_B }] },
      { cookie: COOKIE_DO_TITULAR },
      ambienteComFila(fila),
    );

    expect(acrescentado.status).toBe(201);
    const runId = await execucaoAberta(ITEM_B);
    expect(runId).not.toBeNull();
    expect(fila).toEqual([{ runId, seq: 0 }]);
  });
});
