import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../../../src/worker/env";
import { scheduleDailySync } from "../../../src/worker/sync/daily";
import { AMBIENTE, type Banco, semearBanco } from "./importacao-helpers";

// Reconferência da TASK-0205 (N10): a importação (historico) de hoje segura o agendamento da diária. Sem esse teste,
// trocar 'historico' por só 'diaria' em SQL_AGENDAR passa em tudo, e um banco cuja importação falha rápido abriria uma
// importação a cada 5 minutos. Dados [TEST]; Pluggy não é chamado (a fila é falsa).

const ONTEM_AS_NOVE = "2026-11-09T12:00:00.000Z";
const TRES_E_CINCO_SP = "2026-11-10T03:05:00.000Z";
const TRES_E_DEZ_SP = "2026-11-10T03:10:00.000Z";

const AMBIENTE_COM_FILA = Object.assign({}, AMBIENTE, {
  SYNC_QUEUE: { send: async () => undefined },
}) as unknown as Env;

// Importação de ontem que falhou (banco instável): nenhuma importação concluída, então o agendamento é a importação.
async function importacaoDeOntemFalhou(banco: Banco): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sync_runs (id, bank_item_id, kind, started_at, finished_at, status, error_code, cursor_json, heartbeat_at)
     VALUES (?, ?, 'historico', ?, ?, 'instavel', 'banco_instavel', '{"seq":0,"phase":"inicio"}', NULL)`,
  )
    .bind(crypto.randomUUID(), banco.itemId, ONTEM_AS_NOVE, ONTEM_AS_NOVE)
    .run();
}

describe("agendamento com a importação de hoje (TASK-0205, N10)", () => {
  it("a importação que falhou ontem: às 03:05Z agenda uma; encerrada como instável, às 03:10Z não agenda outra", async () => {
    const banco = await semearBanco();
    await importacaoDeOntemFalhou(banco);

    expect(await scheduleDailySync(AMBIENTE_COM_FILA, { agora: new Date(TRES_E_CINCO_SP) })).toBe(1);
    const historicosDeHoje = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM sync_runs WHERE bank_item_id = ? AND kind = 'historico' AND started_at >= ?",
    )
      .bind(banco.itemId, "2026-11-10T03:00:00.000Z")
      .first<{ n: number }>();
    expect(historicosDeHoje?.n).toBe(1);

    // A execução de hoje termina como instável: o banco continua sem importação concluída, e o cron não reabre hoje.
    await env.DB.prepare(
      "UPDATE sync_runs SET finished_at = ?, status = 'instavel', error_code = 'banco_instavel' WHERE bank_item_id = ? AND started_at >= ? AND finished_at IS NULL",
    )
      .bind(TRES_E_DEZ_SP, banco.itemId, "2026-11-10T03:00:00.000Z")
      .run();
    expect(await scheduleDailySync(AMBIENTE_COM_FILA, { agora: new Date(TRES_E_DEZ_SP) })).toBe(0);
  });
});
