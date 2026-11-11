import { describe, expect, it } from "vitest";
import {
  executarCron,
  ORDEM_DO_CRON,
  registrarTarefa,
  type TarefaDoCron,
} from "../../../../src/worker/cron/registro";

type Tarefa = TarefaDoCron<string>;

const tarefa = (name: string, heavy: boolean, trabalha: boolean, chamadas: string[]): Tarefa => ({
  name,
  heavy,
  async run() {
    chamadas.push(name);
    return trabalha;
  },
});

describe("executarCron", () => {
  it("cenário 11: com duas pesadas que trabalham, só a primeira roda; as leves rodam sempre", async () => {
    const chamadas: string[] = [];
    const lista: Tarefa[] = [];
    registrarTarefa(lista, tarefa("leve-a", false, true, chamadas));
    registrarTarefa(lista, tarefa("pesada-1", true, true, chamadas));
    registrarTarefa(lista, tarefa("pesada-2", true, true, chamadas));
    registrarTarefa(lista, tarefa("leve-b", false, false, chamadas));

    const trabalharam = await executarCron(lista, "env", new Date("2026-11-11T12:00:00Z"));

    expect(chamadas).toEqual(["leve-a", "pesada-1", "leve-b"]);
    expect(trabalharam).toEqual(["leve-a", "pesada-1"]);
  });

  it("a pesada que não trabalha deixa a próxima rodar", async () => {
    const chamadas: string[] = [];
    const lista: Tarefa[] = [];
    registrarTarefa(lista, tarefa("pesada-1", true, false, chamadas));
    registrarTarefa(lista, tarefa("pesada-2", true, true, chamadas));
    await executarCron(lista, "env", new Date());
    expect(chamadas).toEqual(["pesada-1", "pesada-2"]);
  });

  it("uma falha de tarefa não para as outras e só o nome vai para o log", async () => {
    const chamadas: string[] = [];
    const erros: string[] = [];
    const lista: Tarefa[] = [
      {
        name: "quebra",
        heavy: false,
        async run() {
          throw new TypeError("[TEST] segredo no erro");
        },
      },
      tarefa("segue", false, true, chamadas),
    ];
    const trabalharam = await executarCron(lista, "env", new Date(), (mensagem) => erros.push(mensagem));
    expect(trabalharam).toEqual(["segue"]);
    expect(erros).toEqual(["cron quebra: TypeError"]);
    expect(chamadas).toEqual(["segue"]);
  });
});

describe("registrarTarefa", () => {
  it("mantém a ordem combinada, com as desconhecidas no fim na ordem de registro", () => {
    const lista: Tarefa[] = [];
    registrarTarefa(lista, tarefa("resumo-do-mes", true, false, []));
    registrarTarefa(lista, tarefa("desconhecida", false, false, []));
    registrarTarefa(lista, tarefa("categorizacao", true, false, []));
    registrarTarefa(lista, tarefa("retomar-importacoes", false, false, []));
    registrarTarefa(lista, tarefa("cotacao-do-dolar", false, false, []));
    expect(lista.map((t) => t.name)).toEqual([
      "retomar-importacoes",
      "categorizacao",
      "cotacao-do-dolar",
      "resumo-do-mes",
      "desconhecida",
    ]);
    expect(ORDEM_DO_CRON.indexOf("categorizacao")).toBeLessThan(ORDEM_DO_CRON.indexOf("cotacao-do-dolar"));
  });

  it("nome repetido é erro", () => {
    const lista: Tarefa[] = [];
    registrarTarefa(lista, tarefa("x", false, false, []));
    expect(() => registrarTarefa(lista, tarefa("x", true, false, []))).toThrow(/já registrada/);
  });
});
