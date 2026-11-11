import { describe, expect, it } from "vitest";
import { despachar, TAREFAS_DO_CRON, type TarefaDoCron } from "../../../src/worker/cron/despachante";
import type { Db } from "../../../src/worker/db/client";
import type { Env } from "../../../src/worker/env";

// Despachante do cron (TASK-0204, forma combinada com a TASK-0303): tarefas fictícias, sem D1 nem rede. O db é um
// marcador: o despachante só o repassa às tarefas, e o teste confere que a mesma instância chega a todas.
const AMBIENTE = {} as Env;
const AGORA = new Date("2026-11-10T12:00:00.000Z");
const DB_MEDIDO = { marcador: "db-medido" } as unknown as Db;

const tarefa = (nome: string, pesada: boolean, trabalha: boolean, chamadas: string[]): TarefaDoCron => ({
  nome,
  pesada,
  async executar() {
    chamadas.push(nome);
    return trabalha;
  },
});

describe("despachar", () => {
  it("cenário 11: com duas pesadas que trabalham, só a primeira roda; as leves rodam sempre", async () => {
    const chamadas: string[] = [];
    const trabalharam = await despachar(AMBIENTE, AGORA, DB_MEDIDO, [
      tarefa("leve-a", false, true, chamadas),
      tarefa("pesada-1", true, true, chamadas),
      tarefa("pesada-2", true, true, chamadas),
      tarefa("leve-b", false, false, chamadas),
    ]);
    expect(chamadas).toEqual(["leve-a", "pesada-1", "leve-b"]);
    expect(trabalharam).toEqual(["leve-a", "pesada-1"]);
  });

  it("a pesada que não trabalha deixa a próxima pesada rodar", async () => {
    const chamadas: string[] = [];
    await despachar(AMBIENTE, AGORA, DB_MEDIDO, [
      tarefa("pesada-1", true, false, chamadas),
      tarefa("pesada-2", true, true, chamadas),
    ]);
    expect(chamadas).toEqual(["pesada-1", "pesada-2"]);
  });

  it("a pesada que falha encerra as pesadas (a CPU dela já foi gasta), e a leve depois dela ainda roda", async () => {
    const chamadas: string[] = [];
    const trabalharam = await despachar(AMBIENTE, AGORA, DB_MEDIDO, [
      {
        nome: "pesada-quebra",
        pesada: true,
        async executar() {
          chamadas.push("pesada-quebra");
          throw new TypeError("[TEST] segredo no erro");
        },
      },
      tarefa("pesada-2", true, true, chamadas),
      tarefa("leve-depois", false, true, chamadas),
    ]);
    expect(chamadas).toEqual(["pesada-quebra", "leve-depois"]);
    expect(trabalharam).toEqual(["leve-depois"]);
  });

  it("uma falha não para as outras tarefas", async () => {
    const chamadas: string[] = [];
    const trabalharam = await despachar(AMBIENTE, AGORA, DB_MEDIDO, [
      {
        nome: "quebra",
        pesada: false,
        async executar() {
          throw new TypeError("[TEST] segredo no erro");
        },
      },
      tarefa("segue", false, true, chamadas),
    ]);
    expect(trabalharam).toEqual(["segue"]);
    expect(chamadas).toEqual(["segue"]);
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

  it("ordem combinada: a retomada da importação é leve e vem antes da atribuição de ciclos, que é pesada", () => {
    expect(TAREFAS_DO_CRON.map((t) => [t.nome, t.pesada])).toEqual([
      ["retomar-importacoes", false],
      ["atribuir-ciclos", true],
    ]);
  });
});
