import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { pluggyFalsoEmMemoria } from "../../../src/worker/dev/pluggy-fake-fetch";
import { startRun } from "../../../src/worker/sync/runs";
import { runSyncSlice } from "../../../src/worker/sync/slice";
import {
  AGORA,
  AMBIENTE,
  contaDeTransacoes,
  cursorDaExecucao,
  db,
  execucao,
  rodar,
  semearBanco,
} from "./importacao-helpers";

// A fatia de transações em duas mensagens da fila (TASK-0208): a fase transacoes grava as linhas e deixa os ids no
// cursor; a fase pos_gravacao roda as etapas do afterIngest para esses ids e só então anda. O afterIngest é espiado
// (o módulo continua real) para provar em qual mensagem ele roda.
const espiao = vi.hoisted(() => ({ chamadas: [] as { novas: number; existentes: number }[] }));
vi.mock("../../../src/worker/bank/after-ingest", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../src/worker/bank/after-ingest")>();
  return {
    ...real,
    afterIngest: async (...argumentos: Parameters<typeof real.afterIngest>) => {
      espiao.chamadas.push({
        novas: argumentos[1].insertedIds.length,
        existentes: argumentos[1].updatedIds.length,
      });
      return real.afterIngest(...argumentos);
    },
  };
});

const BASE = pluggyFalsoEmMemoria(3);

const passo = (runId: string, seq: number) =>
  runSyncSlice(AMBIENTE, { db: db(), fetch: BASE }, { runId, seq, tentativa: 1 }, AGORA);

const filaDeCategorizacao = async (): Promise<number> =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM categorization_queue").first<{ n: number }>())?.n ?? 0;

async function cursorBruto(runId: string) {
  const linha = await env.DB.prepare("SELECT cursor_json FROM sync_runs WHERE id = ?")
    .bind(runId)
    .first<{ cursor_json: string }>();
  return JSON.parse(linha?.cursor_json ?? "{}") as {
    seq: number;
    phase: string;
    pos: {
      novas: string[];
      existentes: string[];
      offsetDepois: number | null;
      paginaDepois: string | null;
    } | null;
  };
}

// Leva a execução até a primeira fatia de transações com linhas (inicio e faturas rodam antes, seq 0 e 1).
async function atePrimeiraGravacao() {
  const banco = await semearBanco();
  const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
  await passo(runId, 0);
  await passo(runId, 1);
  espiao.chamadas.length = 0;
  return { banco, runId };
}

describe("fatia de transações em duas mensagens (TASK-0208)", () => {
  it("a mensagem de gravação grava e deixa os ids no cursor, sem afterIngest; a seguinte roda as etapas e anda", async () => {
    const { banco, runId } = await atePrimeiraGravacao();
    const filaAntes = await filaDeCategorizacao();

    expect(await passo(runId, 2)).toEqual({ tipo: "continua" });
    const aposGravacao = await cursorBruto(runId);
    expect(aposGravacao).toMatchObject({ seq: 3, phase: "pos_gravacao" });
    expect(aposGravacao.pos?.novas).toHaveLength(3);
    const ids = (
      await env.DB.prepare("SELECT id FROM transactions WHERE bank_item_id = ?")
        .bind(banco.itemId)
        .all<{ id: string }>()
    ).results.map((linha) => linha.id);
    expect([...(aposGravacao.pos?.novas ?? [])].sort()).toEqual([...ids].sort());
    // As linhas estão gravadas, mas nenhuma etapa depois da gravação rodou ainda.
    expect(espiao.chamadas).toEqual([]);
    expect(await filaDeCategorizacao()).toBe(filaAntes);

    expect(await passo(runId, 3)).toEqual({ tipo: "continua" });
    expect(espiao.chamadas).toEqual([{ novas: 3, existentes: 0 }]);
    expect(await filaDeCategorizacao()).toBeGreaterThan(filaAntes);
    const aposPos = await cursorBruto(runId);
    expect(aposPos).toMatchObject({ seq: 4, phase: "transacoes", pos: null });
  });

  it("a ordem das fases: cada gravação com linhas é seguida de uma pos_gravacao, e a progressão não conta a pos", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    const fases: string[] = [];
    let seq = 0;
    let feitasNaGravacao = -1;
    for (let i = 0; i < 400; i++) {
      const antes = await cursorDaExecucao(runId);
      fases.push(antes.phase);
      const resultado = await passo(runId, seq);
      if (resultado.tipo !== "continua") break;
      const depois = await cursorDaExecucao(runId);
      if (antes.phase === "transacoes" && depois.phase === "pos_gravacao")
        feitasNaGravacao = depois.slices_done;
      if (antes.phase === "pos_gravacao" && feitasNaGravacao >= 0) {
        // A gravação não somou fatia feita; a pos soma só quando a janela acaba.
        expect(depois.slices_done).toBeGreaterThanOrEqual(feitasNaGravacao);
        feitasNaGravacao = -1;
      }
      seq += 1;
    }
    for (let i = 0; i < fases.length; i++) {
      if (fases[i] === "pos_gravacao") expect(fases[i - 1]).toBe("transacoes");
      if (fases[i - 1] === "transacoes" && fases[i] !== "transacoes") {
        expect(["pos_gravacao", "conciliar"]).toContain(fases[i]);
      }
    }
    expect(fases).toContain("pos_gravacao");
    expect(fases.indexOf("pos_gravacao")).toBeGreaterThan(fases.indexOf("transacoes"));
    expect(fases.indexOf("conciliar")).toBeGreaterThan(fases.lastIndexOf("pos_gravacao"));
    expect((await execucao(runId))?.status).toBe("ok");
    expect(await contaDeTransacoes(banco.itemId)).toBeGreaterThan(0);
  });

  it("repetir a mensagem de gravação (mesmo seq) pula: nada duplica e o cursor não muda", async () => {
    const { banco, runId } = await atePrimeiraGravacao();
    await passo(runId, 2);
    const total = await contaDeTransacoes(banco.itemId);
    const cursor = await cursorBruto(runId);

    expect(await passo(runId, 2)).toEqual({ tipo: "pulou" });
    expect(await contaDeTransacoes(banco.itemId)).toBe(total);
    expect(await cursorBruto(runId)).toEqual(cursor);
    expect(espiao.chamadas).toEqual([]);
  });

  it("repetir a mensagem pós-gravação (mesmo seq) pula: as etapas não rodam de novo e a fila não duplica", async () => {
    const { banco, runId } = await atePrimeiraGravacao();
    await passo(runId, 2);
    await passo(runId, 3);
    const fila = await filaDeCategorizacao();
    const total = await contaDeTransacoes(banco.itemId);
    const cursor = await cursorBruto(runId);
    const chamadas = espiao.chamadas.length;

    expect(await passo(runId, 3)).toEqual({ tipo: "pulou" });
    expect(espiao.chamadas.length).toBe(chamadas);
    expect(await filaDeCategorizacao()).toBe(fila);
    expect(await contaDeTransacoes(banco.itemId)).toBe(total);
    expect(await cursorBruto(runId)).toEqual(cursor);
  });

  it("uma importação inteira dá o mesmo estado ao repetir cada mensagem uma vez", async () => {
    const limpa = await semearBanco();
    const runLimpa = (await startRun(db(), limpa.itemId, "historico", AGORA)) as string;
    await rodar(runLimpa, BASE);

    const repetida = await semearBanco();
    const runRepetida = (await startRun(db(), repetida.itemId, "historico", AGORA)) as string;
    let seq = 0;
    for (let i = 0; i < 400; i++) {
      const resultado = await passo(runRepetida, seq);
      if (resultado.tipo !== "continua") break;
      // A mesma mensagem de novo: a guarda de seq a pula.
      expect(await passo(runRepetida, seq)).toEqual({ tipo: "pulou" });
      seq += 1;
    }
    expect(await contaDeTransacoes(repetida.itemId)).toBe(await contaDeTransacoes(limpa.itemId));
    expect(await execucao(runRepetida)).toMatchObject({ status: "ok", progress_pct: 100 });
    const contagem = async (itemId: string, movimento: string) =>
      (
        await env.DB.prepare("SELECT COUNT(*) AS n FROM transactions WHERE bank_item_id = ? AND movement = ?")
          .bind(itemId, movimento)
          .first<{ n: number }>()
      )?.n;
    expect(await contagem(repetida.itemId, "pagamento_fatura")).toBe(
      await contagem(limpa.itemId, "pagamento_fatura"),
    );
  });

  it("a mensagem pós-gravação refeita depois de uma queda (mesmo seq, cursor sem andar) completa sem duplicar", async () => {
    const { banco, runId } = await atePrimeiraGravacao();
    await passo(runId, 2);
    const cursorAntes = await cursorBruto(runId);
    // A primeira tentativa da pos roda as etapas, mas o cursor não grava (queda): o seq e a fase voltam ao que eram.
    await passo(runId, 3);
    await env.DB.prepare("UPDATE sync_runs SET cursor_json = ? WHERE id = ?")
      .bind(JSON.stringify(cursorAntes), runId)
      .run();
    const fila = await filaDeCategorizacao();
    const total = await contaDeTransacoes(banco.itemId);

    expect(await passo(runId, 3)).toEqual({ tipo: "continua" });
    expect(await contaDeTransacoes(banco.itemId)).toBe(total);
    expect(await filaDeCategorizacao()).toBe(fila);
    expect(await cursorBruto(runId)).toMatchObject({ seq: 4, phase: "transacoes", pos: null });
  });
});
