import { describe, expect, it, vi } from "vitest";
import {
  despachar,
  PASSO_DO_CRON_MS,
  TAREFAS_DO_CRON,
  type TarefaDoCron,
} from "../../../src/worker/cron/despachante";
import type { Db } from "../../../src/worker/db/client";
import type { Env } from "../../../src/worker/env";

// Despachante do cron (TASK-0204, TASK-0303 e TASK-0205, N10): tarefas fictícias, sem D1 nem rede. As leves rodam sempre;
// das pesadas, uma por execução, e a pesada sem trabalho cede a vez. O giro das pesadas começa num ponto que muda a cada
// execução do cron (um passo de cinco minutos).
const AMBIENTE = {} as Env;
const DB_MEDIDO = { marcador: "db-medido" } as unknown as Db;
// Instantes de cinco em cinco minutos: o ponto de partida do giro alterna entre execuções seguidas.
const TICK_0 = new Date(PASSO_DO_CRON_MS * 1000);
const _TICK_1 = new Date(PASSO_DO_CRON_MS * 1001);

const tarefa = (nome: string, pesada: boolean, chamadas: string[], trabalha = true): TarefaDoCron => ({
  nome,
  pesada,
  async executar() {
    chamadas.push(nome);
    return trabalha;
  },
});

describe("despachar: leves e pesadas", () => {
  it("as leves rodam sempre; das pesadas, só uma roda por execução", async () => {
    const chamadas: string[] = [];
    await despachar(AMBIENTE, TICK_0, DB_MEDIDO, [
      tarefa("leve-a", false, chamadas),
      tarefa("pesada-1", true, chamadas),
      tarefa("pesada-2", true, chamadas),
      tarefa("leve-b", false, chamadas),
    ]);
    expect(chamadas.filter((nome) => nome.startsWith("leve")).sort()).toEqual(["leve-a", "leve-b"]);
    expect(chamadas.filter((nome) => nome.startsWith("pesada"))).toHaveLength(1);
  });

  it("uma falha de leve não para as outras tarefas", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const chamadas: string[] = [];
    await despachar(AMBIENTE, TICK_0, DB_MEDIDO, [
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

  it("a pesada que falha encerra as pesadas (a CPU dela já foi gasta), e nada é lançado", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const chamadas: string[] = [];
    await expect(
      despachar(AMBIENTE, TICK_0, DB_MEDIDO, [
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

  it("cada tarefa recebe o db medido que o despachante recebeu", async () => {
    const recebidos: unknown[] = [];
    await despachar(AMBIENTE, TICK_0, DB_MEDIDO, [
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

  it("ordem combinada: retomada, atribuição de ciclos, cotação do dólar e agendamento são leves; a categorização é a pesada", () => {
    expect(TAREFAS_DO_CRON.map((t) => [t.nome, t.pesada])).toEqual([
      ["retomar-importacoes", false],
      ["atribuir-ciclos", false],
      ["cotacao-dolar", false],
      ["agendar-sincronizacao", false],
      ["categorizacao", true],
    ]);
  });
});
