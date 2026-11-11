import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { pluggyFalsoEmMemoria } from "../../../src/worker/dev/pluggy-fake-fetch";
import { escritasDeHoje } from "../../../src/worker/sync/orcamento";
import { startRun } from "../../../src/worker/sync/runs";
import { runSyncSlice } from "../../../src/worker/sync/slice";
import {
  AGORA,
  AMBIENTE,
  contaDeTransacoes,
  cursorDaExecucao,
  db,
  execucao,
  HOJE,
  rodar,
  semearBanco,
} from "./importacao-helpers";

// Teto diário de escritas (TASK-0204, R2): a importação para ao chegar a 60% do limite do dia (usage_daily, dia UTC) e
// volta na virada. Plano gratuito: 100 mil escritas por dia, então o teto são 60 mil. Dados [TEST].

const VIRADA = "2026-11-11T00:00:00.000Z";
const DEPOIS_DA_VIRADA = "2026-11-11T00:30:00.000Z";

async function contadorDoDia(dia: string, escritas: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO usage_daily (day, requests, rows_read, rows_written, size_bytes) VALUES (?, 0, 0, ?, 0)
     ON CONFLICT(day) DO UPDATE SET rows_written = excluded.rows_written`,
  )
    .bind(dia, escritas)
    .run();
}

describe("teto diário de escritas: a importação para em 60% e volta na virada (R2)", () => {
  it("com 59% do limite do dia, a fatia roda normalmente", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    await contadorDoDia(HOJE, 59_000);

    const resultado = await runSyncSlice(
      AMBIENTE,
      { db: db(), fetch: pluggyFalsoEmMemoria(2) },
      { runId, seq: 0, tentativa: 1 },
      AGORA,
    );
    expect(resultado).toEqual({ tipo: "continua" });
    expect((await cursorDaExecucao(runId)).seq).toBe(1);
  });

  it("com 61% do limite do dia, a fatia pausa: o cursor não anda, nada é gravado e o heartbeat vai para a virada", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    await contadorDoDia(HOJE, 61_000);

    const resultado = await runSyncSlice(
      AMBIENTE,
      { db: db(), fetch: pluggyFalsoEmMemoria(2) },
      { runId, seq: 0, tentativa: 1 },
      AGORA,
    );
    expect(resultado).toEqual({ tipo: "pulou" });

    const cursor = await cursorDaExecucao(runId);
    expect(cursor).toMatchObject({ seq: 0, phase: "inicio" });
    const linha = await env.DB.prepare(
      "SELECT heartbeat_at, finished_at, retried FROM sync_runs WHERE id = ?",
    )
      .bind(runId)
      .first<{ heartbeat_at: string; finished_at: string | null; retried: number }>();
    expect(linha).toEqual({ heartbeat_at: VIRADA, finished_at: null, retried: 0 });
    const contas = await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts WHERE bank_item_id = ?")
      .bind(banco.itemId)
      .first<{ n: number }>();
    expect(contas?.n).toBe(0);
  });

  it("no dia seguinte, com o contador zerado, a execução pausada retoma do mesmo seq e termina ok", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    await contadorDoDia(HOJE, 61_000);
    expect(
      await runSyncSlice(
        AMBIENTE,
        { db: db(), fetch: pluggyFalsoEmMemoria(2) },
        { runId, seq: 0, tentativa: 1 },
        AGORA,
      ),
    ).toEqual({ tipo: "pulou" });

    // Depois da virada, o dia de uso é outro: o contador começa do zero e a fatia 0 roda de novo.
    const passos = await rodar(runId, pluggyFalsoEmMemoria(2), 0, 1, DEPOIS_DA_VIRADA);
    expect(passos.at(-1)?.resultado).toEqual({ tipo: "encerrou", status: "ok", codigo: null });
    expect((await execucao(runId))?.status).toBe("ok");
  });

  it("a pausa no meio da importação não avança o cursor: a fatia de transações fica onde estava", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    const fetch = pluggyFalsoEmMemoria(2);
    // inicio (0) e faturas (1) passam sem o teto; depois o dia chega a 61%.
    await runSyncSlice(AMBIENTE, { db: db(), fetch }, { runId, seq: 0, tentativa: 1 }, AGORA);
    await runSyncSlice(AMBIENTE, { db: db(), fetch }, { runId, seq: 1, tentativa: 1 }, AGORA);
    await contadorDoDia(HOJE, 61_000);

    const resultado = await runSyncSlice(
      AMBIENTE,
      { db: db(), fetch },
      { runId, seq: 2, tentativa: 1 },
      AGORA,
    );
    expect(resultado).toEqual({ tipo: "pulou" });
    expect(await cursorDaExecucao(runId)).toMatchObject({ seq: 2, phase: "transacoes" });
    expect(await contaDeTransacoes(banco.itemId)).toBe(0);
  });

  it("escritasDeHoje lê o dia UTC: zero sem linha, e a virada da meia-noite UTC troca o dia", async () => {
    await contadorDoDia("2026-11-10", 1_234);
    expect(await escritasDeHoje(env.DB, new Date("2026-11-10T23:59:59.000Z"))).toBe(1_234);
    expect(await escritasDeHoje(env.DB, new Date("2026-11-11T00:00:00.000Z"))).toBe(0);
  });
});
