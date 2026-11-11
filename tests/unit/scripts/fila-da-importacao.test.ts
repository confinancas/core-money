import { describe, expect, it } from "vitest";
import { criaWrangler, ErroDoWrangler } from "../../../scripts/lib/wrangler";
import { criaCloudflareFalso, estadoInicial } from "./helpers/cloudflare-falso";

// Fila da importação no instalador (TASK-0204, R9): confere com `queues info` (existe no wrangler 4), cria se não
// existe, e trata "a fila já existe" como sucesso. Nenhum teste fala com a Cloudflare: o runner é o falso.

const FILA = "matrimoney-sync";

function comandosEnviados(estado: ReturnType<typeof estadoInicial>): string[][] {
  return estado.chamadas.map((chamada) => chamada.args).filter((args) => args[0] === "queues");
}

describe("criaFilaSeNaoExiste (instalador)", () => {
  it("a fila já existe: confere com queues info e não cria", async () => {
    const estado = estadoInicial({ filas: [FILA] });

    await criaWrangler(criaCloudflareFalso(estado)).criaFilaSeNaoExiste(FILA);

    expect(comandosEnviados(estado)).toEqual([["queues", "info", FILA]]);
    expect(estado.filas).toEqual([FILA]);
  });

  it("a fila não existe e a criação funciona: confere, cria e a fila passa a existir", async () => {
    const estado = estadoInicial({ filas: [] });

    await criaWrangler(criaCloudflareFalso(estado)).criaFilaSeNaoExiste(FILA);

    expect(comandosEnviados(estado)).toEqual([
      ["queues", "info", FILA],
      ["queues", "create", FILA],
    ]);
    expect(estado.filas).toEqual([FILA]);
  });

  it("a fila não existe e a criação responde 'already exists': é sucesso, sem erro", async () => {
    const estado = estadoInicial({ filas: [], criacaoDaFila: "ja_existe" });

    await expect(
      criaWrangler(criaCloudflareFalso(estado)).criaFilaSeNaoExiste(FILA),
    ).resolves.toBeUndefined();

    expect(comandosEnviados(estado)).toEqual([
      ["queues", "info", FILA],
      ["queues", "create", FILA],
    ]);
  });

  it("a criação falha por outra razão: o erro sai com o comando e a saída do wrangler", async () => {
    const estado = estadoInicial({ filas: [], criacaoDaFila: "falha" });

    const erro = await criaWrangler(criaCloudflareFalso(estado))
      .criaFilaSeNaoExiste(FILA)
      .catch((falha: unknown) => falha);

    expect(erro).toBeInstanceOf(ErroDoWrangler);
    expect((erro as Error).message).toContain("wrangler queues create falhou");
    expect((erro as Error).message).toContain("erro simulado ao criar a fila");
  });

  it("não usa mais queues list: o wrangler 4 do repositório não aceita --json nele", async () => {
    const estado = estadoInicial({ filas: [FILA] });

    await criaWrangler(criaCloudflareFalso(estado)).criaFilaSeNaoExiste(FILA);

    expect(comandosEnviados(estado).some((args) => args[1] === "list")).toBe(false);
  });
});
