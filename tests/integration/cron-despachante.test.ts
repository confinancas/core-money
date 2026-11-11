import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrandConfig } from "../../src/shared/brand/types";
import { processNewTransactions } from "../../src/worker/categorization/pipeline";
import { criarWorker } from "../../src/worker/criar-worker";
import { despachar, TAREFAS_DO_CRON, type TarefaDoCron } from "../../src/worker/cron/despachante";
import { createDb } from "../../src/worker/db/client";
import { newMeter } from "../../src/worker/db/metered-d1";
import type { Env } from "../../src/worker/env";
import { AGORA, criarLar, inserirTransacao } from "./helpers/regras";

// Despachante e scheduled (TASK-0303, rodada 1). Sem chave na instalação de teste: nenhuma chamada à IA.
const ambiente = env as unknown as Env;

afterEach(() => {
  vi.restoreAllMocks();
});

const tarefa = (nome: string, pesada: boolean, falha = false, chamadas: string[] = []): TarefaDoCron => ({
  nome,
  pesada,
  executar: async () => {
    chamadas.push(nome);
    if (falha) throw new Error("falha de teste");
  },
});

describe("despachante: uma tarefa pesada por execução", () => {
  it("roda as leves antes da pesada e para na pesada (K8)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const chamadas: string[] = [];
    await despachar(ambiente, new Date(AGORA), undefined, [
      tarefa("leve-1", false, false, chamadas),
      tarefa("pesada", true, false, chamadas),
      tarefa("leve-2", false, false, chamadas),
    ]);
    expect(chamadas).toEqual(["leve-1", "pesada"]);
  });

  it("a pesada que falha ainda conta como a da execução: a seguinte não roda, e nada é lançado", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const chamadas: string[] = [];
    await expect(
      despachar(ambiente, new Date(AGORA), undefined, [
        tarefa("pesada-que-falha", true, true, chamadas),
        tarefa("leve", false, false, chamadas),
      ]),
    ).resolves.toBeUndefined();
    expect(chamadas).toEqual(["pesada-que-falha"]);
    expect(erro.mock.calls.map((c) => String(c[0])).join("\n")).toContain("cron pesada-que-falha: falhou");
  });

  it("a instalação roda a categorização como a única tarefa pesada", () => {
    expect(TAREFAS_DO_CRON.map((t) => t.nome)).toEqual(["categorizacao"]);
    expect(TAREFAS_DO_CRON.filter((t) => t.pesada)).toHaveLength(1);
  });
});

describe("scheduled: o Worker embrulhado pelo medidor de uso", () => {
  it("exporta scheduled; sem chave, a fila e as transações ficam como estão e a linha do uso é gravada", async () => {
    const lar = await criarLar();
    const id = await inserirTransacao(lar, {
      na: "cartao",
      movement: "compra",
      amountCents: -8900,
      descricao: "[TEST] SCHEDULED SEM CHAVE",
    });
    await processNewTransactions(createDb(env.DB, newMeter()), lar.householdId, [id], AGORA);
    const antes = await env.DB.prepare(
      "SELECT attempts, last_error FROM categorization_queue WHERE transaction_id = ?",
    )
      .bind(id)
      .first();

    const worker = criarWorker({ marca: {} as unknown as BrandConfig, versao: "teste" });
    expect(typeof worker.scheduled).toBe("function");
    const ctx = createExecutionContext();
    await worker.scheduled({ scheduledTime: Date.parse(AGORA), cron: "*/5 * * * *" } as never, ambiente, ctx);
    await waitOnExecutionContext(ctx);

    expect(
      await env.DB.prepare("SELECT attempts, last_error FROM categorization_queue WHERE transaction_id = ?")
        .bind(id)
        .first(),
    ).toEqual(antes);
    const tx = await env.DB.prepare("SELECT category_id, ai_category_id FROM transactions WHERE id = ?")
      .bind(id)
      .first<{
        category_id: string | null;
        ai_category_id: string | null;
      }>();
    expect(tx?.category_id).toBeNull();
    expect(tx?.ai_category_id).toBeNull();
    const usos = await env.DB.prepare("SELECT COALESCE(SUM(requests), 0) AS total FROM usage_daily").first<{
      total: number;
    }>();
    expect(usos?.total).toBeGreaterThanOrEqual(1);
  });
});
