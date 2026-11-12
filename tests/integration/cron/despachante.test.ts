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
const TICK_1 = new Date(PASSO_DO_CRON_MS * 1001);
const TICK_2 = new Date(PASSO_DO_CRON_MS * 1002);

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
});

describe("despachar: N10, a vez de cada pesada", () => {
  it("pesada sem trabalho cede a vez: a seguinte com trabalho roda", async () => {
    const chamadas: string[] = [];
    await despachar(AMBIENTE, TICK_0, DB_MEDIDO, [
      tarefa("pesada-sem-trabalho", true, chamadas, false),
      tarefa("pesada-com-trabalho", true, chamadas, true),
    ]);
    expect(chamadas).toEqual(["pesada-sem-trabalho", "pesada-com-trabalho"]);
  });

  it("duas pesadas com trabalho se revezam: cada execução do cron põe uma delas em vez", async () => {
    const primeira: string[] = [];
    await despachar(AMBIENTE, TICK_0, DB_MEDIDO, [
      tarefa("pesada-1", true, primeira),
      tarefa("pesada-2", true, primeira),
    ]);
    const segunda: string[] = [];
    await despachar(AMBIENTE, TICK_1, DB_MEDIDO, [
      tarefa("pesada-1", true, segunda),
      tarefa("pesada-2", true, segunda),
    ]);
    expect(primeira).toHaveLength(1);
    expect(segunda).toHaveLength(1);
    expect(segunda[0]).not.toBe(primeira[0]);
    // Na terceira execução, volta a primeira: nenhuma fica sem rodar.
    const terceira: string[] = [];
    await despachar(AMBIENTE, TICK_2, DB_MEDIDO, [
      tarefa("pesada-1", true, terceira),
      tarefa("pesada-2", true, terceira),
    ]);
    expect(terceira[0]).toBe(primeira[0]);
  });

  it("duas pesadas com trabalho e uma sem: a sem trabalho cede e as outras duas se revezam, sem ninguém parado", async () => {
    const execucoes: string[][] = [];
    for (const tick of [TICK_0, TICK_1]) {
      const chamadas: string[] = [];
      await despachar(AMBIENTE, tick, DB_MEDIDO, [
        tarefa("sem-trabalho", true, chamadas, false),
        tarefa("com-trabalho-a", true, chamadas, true),
        tarefa("com-trabalho-b", true, chamadas, true),
      ]);
      execucoes.push(chamadas);
    }
    // Nunca a que não tem trabalho fica com a rodada; as duas com trabalho se alternam.
    const rodadas = execucoes.map((chamadas) => chamadas.at(-1));
    expect(rodadas).not.toContain("sem-trabalho");
    expect(new Set(rodadas)).toEqual(new Set(["com-trabalho-a", "com-trabalho-b"]));
  });
});

describe("TAREFAS_DO_CRON: ordem combinada", () => {
  it("retomada da importação, atribuição de ciclos e agendamento da sincronização são leves; a categorização é a pesada", () => {
    expect(TAREFAS_DO_CRON.map((t) => [t.nome, t.pesada])).toEqual([
      ["retomar-importacoes", false],
      ["atribuir-ciclos", false],
      ["agendar-sincronizacao", false],
      ["categorizacao", true],
    ]);
  });
});
