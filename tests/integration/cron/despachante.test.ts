import { describe, expect, it, vi } from "vitest";
import { despachar, TAREFAS_DO_CRON, type TarefaDoCron } from "../../../src/worker/cron/despachante";
import type { Db } from "../../../src/worker/db/client";
import type { Env } from "../../../src/worker/env";

// Despachante do cron (TASK-0204, fundido com a TASK-0303): tarefas fictícias, sem D1 nem rede. O db é um marcador: o
// despachante só o repassa às tarefas, e o teste confere que a mesma instância chega a todas.
const AMBIENTE = {} as Env;
const AGORA = new Date("2026-11-10T12:00:00.000Z");
const DB_MEDIDO = { marcador: "db-medido" } as unknown as Db;

const tarefa = (nome: string, pesada: boolean, chamadas: string[]): TarefaDoCron => ({
  nome,
  pesada,
  async executar() {
    chamadas.push(nome);
    return true;
  },
});

describe("despachar", () => {
  it("uma pesada por execução: a primeira pesada encerra a rodada; as leves antes dela rodam", async () => {
    const chamadas: string[] = [];
    await despachar(AMBIENTE, AGORA, DB_MEDIDO, [
      tarefa("leve-a", false, chamadas),
      tarefa("pesada-1", true, chamadas),
      tarefa("pesada-2", true, chamadas),
    ]);
    expect(chamadas).toEqual(["leve-a", "pesada-1"]);
  });

  it("a pesada que não trabalha também encerra a rodada: a seguinte pesada não roda", async () => {
    const chamadas: string[] = [];
    await despachar(AMBIENTE, AGORA, DB_MEDIDO, [
      {
        nome: "pesada-1",
        pesada: true,
        async executar() {
          chamadas.push("pesada-1");
          return false;
        },
      },
      tarefa("pesada-2", true, chamadas),
    ]);
    expect(chamadas).toEqual(["pesada-1"]);
  });

  it("a pesada que falha encerra as pesadas (a CPU dela já foi gasta), e nada é lançado", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const chamadas: string[] = [];
    await expect(
      despachar(AMBIENTE, AGORA, DB_MEDIDO, [
        {
          nome: "pesada-quebra",
          pesada: true,
          async executar() {
            chamadas.push("pesada-quebra");
            throw new TypeError("[TEST] segredo no erro");
          },
        },
        tarefa("pesada-2", true, chamadas),
      ]),
    ).resolves.toBeUndefined();
    expect(chamadas).toEqual(["pesada-quebra"]);
    expect(erro.mock.calls.map((c) => String(c[0])).join("\n")).toContain("cron pesada-quebra: falhou");
    erro.mockRestore();
  });

  it("uma falha de leve não para as outras tarefas", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const chamadas: string[] = [];
    await despachar(AMBIENTE, AGORA, DB_MEDIDO, [
      {
        nome: "quebra",
        pesada: false,
        async executar() {
          throw new TypeError("[TEST] segredo no erro");
        },
      },
      tarefa("segue", false, chamadas),
    ]);
    expect(chamadas).toEqual(["segue"]);
    erro.mockRestore();
  });

  it("cada tarefa recebe o db medido que o despachante recebeu", async () => {
    const recebidos: unknown[] = [];
    await despachar(AMBIENTE, AGORA, DB_MEDIDO, [
      {
        nome: "confere",
        pesada: false,
        async executar(_env, _agora, db) {
          recebidos.push(db);
          return false;
        },
      },
    ]);
    expect(recebidos).toEqual([DB_MEDIDO]);
  });

  it("ordem combinada: retomada da importação, atribuição de ciclos e cotação do dólar são leves e vêm antes da categorização, a única pesada", () => {
    expect(TAREFAS_DO_CRON.map((t) => [t.nome, t.pesada])).toEqual([
      ["retomar-importacoes", false],
      ["atribuir-ciclos", false],
      ["cotacao-dolar", false],
      ["categorizacao", true],
    ]);
  });
});
