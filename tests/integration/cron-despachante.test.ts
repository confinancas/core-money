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
    return false;
  },
});

describe("despachante: uma tarefa pesada por execução", () => {
  it("roda todas as leves antes da pesada, e a pesada que trabalha encerra a rodada (K8)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const chamadas: string[] = [];
    await despachar(ambiente, new Date(AGORA), undefined, [
      tarefa("leve-1", false, false, chamadas),
      tarefa("pesada", true, false, chamadas),
      tarefa("leve-2", false, false, chamadas),
    ]);
    expect(chamadas).toEqual(["leve-1", "leve-2", "pesada"]);
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
    expect(chamadas).toEqual(["leve", "pesada-que-falha"]);
    expect(erro.mock.calls.map((c) => String(c[0])).join("\n")).toContain("cron pesada-que-falha: falhou");
  });

  it("a instalação roda as leves (importação e cotação) antes da categorização, a única tarefa pesada", () => {
    // A TASK-0204 acrescenta a retomada e a atribuição de ciclos, e a TASK-0902 a cotação do dólar, todas leves.
    expect(TAREFAS_DO_CRON.map((t) => t.nome)).toEqual([
      "retomar-importacoes",
      "atribuir-ciclos",
      "cotacao-dolar",
      "agendar-sincronizacao",
      "categorizacao",
    ]);
    expect(TAREFAS_DO_CRON.filter((t) => t.pesada).map((t) => t.nome)).toEqual(["categorizacao"]);
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

// Cotação do dólar no despachante (TASK-0902). O Banco Central é falso em todos os testes: o fetch global é espionado e
// responde a PTAX de 05/10 (5,50). Nenhum teste fala com a fonte de cotação de verdade.
describe("cotação do dólar no despachante (TASK-0902)", () => {
  const ptaxFalsa = (): Response =>
    new Response(
      JSON.stringify({
        value: [{ cotacaoCompra: 5.5, cotacaoVenda: 5.5, dataHoraCotacao: "2026-10-05 13:00:00.000" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  // Uma renda em dólar com um recebimento de 05/10 ainda sem cotação (o cron tem o que buscar).
  async function rendaComRecebimentoPendente(): Promise<string> {
    const lar = await criarLar();
    const rendaId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO fixed_incomes (id, household_id, name, currency, amount_cents, usual_day, arrival, statement_text, kept_usd_is_investment, archived_at) VALUES (?, ?, '[TEST] Dólar do despachante', 'USD', 200000, 5, 'partes', NULL, 1, NULL)",
    )
      .bind(rendaId, lar.householdId)
      .run();
    await env.DB.prepare(
      "INSERT INTO fixed_income_receipts (id, fixed_income_id, cycle_key, transaction_id, amount_cents, received_on, fx_rate, fx_date, confirmed_by) VALUES (?, ?, '2026-09', NULL, 400000, '2026-10-05', NULL, NULL, 'pessoa')",
    )
      .bind(crypto.randomUUID(), rendaId)
      .run();
    return rendaId;
  }

  const cotacaoDo = (rendaId: string) =>
    env.DB.prepare("SELECT fx_rate, fx_date FROM fixed_income_receipts WHERE fixed_income_id = ?")
      .bind(rendaId)
      .first<{ fx_rate: number | null; fx_date: string | null }>();

  const urlsDasChamadas = (espiao: { mock: { calls: unknown[][] } }): string[] =>
    espiao.mock.calls.map((chamada) => String(chamada[0]));

  it("o despachante busca a cotação pelo fetch falso, grava o dia de referência, e a execução segue", async () => {
    const rendaId = await rendaComRecebimentoPendente();
    const bcb = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ptaxFalsa());
    await despachar(ambiente, new Date(AGORA));
    expect(bcb).toHaveBeenCalledTimes(1);
    expect(urlsDasChamadas(bcb).every((url) => url.startsWith("https://olinda.bcb.gov.br/"))).toBe(true);
    expect(await cotacaoDo(rendaId)).toEqual({ fx_rate: 55000, fx_date: "2026-10-05" });
  });

  it("o scheduled roda a cotação com o fetch falso, como o Cron Trigger faz", async () => {
    const rendaId = await rendaComRecebimentoPendente();
    const bcb = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ptaxFalsa());
    const worker = criarWorker({ marca: {} as unknown as BrandConfig, versao: "teste" });
    const ctx = createExecutionContext();
    await worker.scheduled({ scheduledTime: Date.parse(AGORA), cron: "*/5 * * * *" } as never, ambiente, ctx);
    await waitOnExecutionContext(ctx);
    expect(urlsDasChamadas(bcb).some((url) => url.startsWith("https://olinda.bcb.gov.br/"))).toBe(true);
    expect(await cotacaoDo(rendaId)).toEqual({ fx_rate: 55000, fx_date: "2026-10-05" });
  });

  it("com o Banco Central fora (status 500), o despachante não lança e a renda segue pendente", async () => {
    const rendaId = await rendaComRecebimentoPendente();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 500 }));
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(despachar(ambiente, new Date(AGORA))).resolves.toBeUndefined();
    expect(await cotacaoDo(rendaId)).toEqual({ fx_rate: null, fx_date: null });
    expect(aviso.mock.calls.map((c) => String(c[0])).join("\n")).toContain("fx: data=2026-10-05 status=500");
  });
});
