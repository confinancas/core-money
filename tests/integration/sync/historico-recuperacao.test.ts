import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/worker/app";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import type { Env } from "../../../src/worker/env";
import { scheduleDailySync } from "../../../src/worker/sync/daily";
import { startRun } from "../../../src/worker/sync/runs";
import { callApi, semearPronto } from "../helpers/app";
import { AMBIENTE, type Banco, rodar, semearBanco } from "./importacao-helpers";
import { pluggyFalsoComTransacoes } from "./pluggy-com-transacoes";

// Banco cuja importação falhou (TASK-0205, A5, sonda S10): o agendamento e o "Baixar agora" refazem a importação de 12
// meses, e não uma sincronização recente. As duas transações (de junho e de novembro) entram. Dados [TEST]; sem rede.

const DIA_0 = "2026-11-09T12:00:00.000Z";
const MEIA_NOITE_SP = "2026-11-10T03:00:00.000Z";
const DIA_2 = "2026-11-10T13:00:00.000Z";
const AMBIENTE_COM_FILA = Object.assign({}, AMBIENTE, {
  SYNC_QUEUE: { send: async () => undefined },
}) as unknown as Env;

// Importação anterior que falhou: o banco ficou instável (banco_instavel).
async function importacaoFalhou(banco: Banco): Promise<void> {
  const runId = (await startRun(createDb(env.DB, newMeter()), banco.itemId, "historico", DIA_0)) as string;
  await env.DB.prepare(
    "UPDATE sync_runs SET finished_at = ?, status = 'instavel', error_code = 'banco_instavel' WHERE id = ?",
  )
    .bind(DIA_0, runId)
    .run();
  await env.DB.prepare("UPDATE bank_items SET status = 'instavel' WHERE id = ?").bind(banco.itemId).run();
}

const duasTransacoes = (banco: Banco) => {
  const conta = `${banco.itemId}-corrente`;
  return pluggyFalsoComTransacoes((c) =>
    c === conta
      ? [
          { id: "[TEST]-junho", conta, data: "2026-06-10", valor: -40 },
          { id: "[TEST]-novembro", conta, data: "2026-11-05", valor: -25 },
        ]
      : [],
  );
};

async function tipoDaUltimaExecucao(itemId: string): Promise<string | null> {
  const linha = await env.DB.prepare(
    "SELECT kind FROM sync_runs WHERE bank_item_id = ? AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1",
  )
    .bind(itemId)
    .first<{ kind: string }>();
  return linha?.kind ?? null;
}

describe("banco com importação que falhou: a diária refaz a importação (A5)", () => {
  it("o agendamento abre uma execução historico e as duas transações (junho e novembro) entram", async () => {
    const banco = await semearBanco();
    await importacaoFalhou(banco);
    expect(await scheduleDailySync(AMBIENTE_COM_FILA, { agora: new Date(MEIA_NOITE_SP) })).toBe(1);
    expect(await tipoDaUltimaExecucao(banco.itemId)).toBe("historico");

    const runId = (
      await env.DB.prepare("SELECT id FROM sync_runs WHERE bank_item_id = ? AND finished_at IS NULL")
        .bind(banco.itemId)
        .first<{ id: string }>()
    )?.id as string;
    await rodar(runId, duasTransacoes(banco), 0, 1, MEIA_NOITE_SP);

    const linhas = await env.DB.prepare(
      "SELECT external_id FROM transactions WHERE bank_item_id = ? ORDER BY external_id",
    )
      .bind(banco.itemId)
      .all<{ external_id: string }>();
    expect(linhas.results?.map((l) => l.external_id)).toEqual(["[TEST]-junho", "[TEST]-novembro"]);
  });
});

describe("'Baixar agora' sem importação concluída refaz a importação (A5)", () => {
  it("a rota abre uma execução historico, não manual", async () => {
    await semearPronto(env.DB);
    const banco = await semearBanco();
    await importacaoFalhou(banco);
    const app = createApp({
      resolveSession: async () => ({ memberId: "[TEST] membro", householdId: banco.householdId }),
      agora: () => new Date(DIA_2),
    });
    const resposta = await callApi(
      app,
      "POST",
      `/api/bank-items/${banco.itemId}/sync`,
      undefined,
      {},
      AMBIENTE_COM_FILA,
    );
    expect(resposta.status).toBe(202);
    expect(await tipoDaUltimaExecucao(banco.itemId)).toBe("historico");
  });
});
