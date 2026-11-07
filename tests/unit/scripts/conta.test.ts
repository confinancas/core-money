import { describe, expect, it } from "vitest";
import { confirmaConta } from "../../../scripts/lib/conta";
import { criaWrangler } from "../../../scripts/lib/wrangler";
import { criaCloudflareFalso, criaTerminalFalso, estadoInicial } from "./helpers/cloudflare-falso";

// Escolha de conta (TASK-0101): a conta confirmada é a única que vai para o wrangler, por definirConta.
const CONTA_A = { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", nome: "[TEST] Conta A" };
const CONTA_B = { id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", nome: "[TEST] Conta B" };

function ambienteCom(contas: { id: string; nome: string }[]) {
  const wrangler = criaWrangler(criaCloudflareFalso(estadoInicial({ contas })));
  const escolhidas: string[] = [];
  return { wrangler, escolhidas, definirConta: (id: string) => escolhidas.push(id) };
}

describe("confirmaConta com duas contas", () => {
  it("com --sim, para sem escolher e não define conta nenhuma", async () => {
    const { wrangler, escolhidas, definirConta } = ambienteCom([CONTA_A, CONTA_B]);
    const { terminal, linhas } = criaTerminalFalso([]);

    const conta = await confirmaConta(wrangler, terminal, true, definirConta);

    expect(conta).toBeUndefined();
    expect(escolhidas).toEqual([]);
    expect(linhas.join("\n")).toContain("Com --sim, a autenticação precisa ter uma conta só");
  });

  it("sem --sim, a conta escolhida pelo número vai para definirConta", async () => {
    const { wrangler, escolhidas, definirConta } = ambienteCom([CONTA_A, CONTA_B]);
    const { terminal, linhas } = criaTerminalFalso(["2", "s"]);

    const conta = await confirmaConta(wrangler, terminal, false, definirConta);

    expect(conta).toEqual(CONTA_B);
    expect(escolhidas).toEqual([CONTA_B.id]);
    expect(linhas.join("\n")).toContain(`Vou usar a conta da Cloudflare: ${CONTA_B.nome} (${CONTA_B.id}).`);
  });

  it("sem --sim, um número fora da lista para sem definir conta", async () => {
    const { wrangler, escolhidas, definirConta } = ambienteCom([CONTA_A, CONTA_B]);
    const { terminal, linhas } = criaTerminalFalso(["3"]);

    const conta = await confirmaConta(wrangler, terminal, false, definirConta);

    expect(conta).toBeUndefined();
    expect(escolhidas).toEqual([]);
    expect(linhas.join("\n")).toContain("Número de conta inválido");
  });

  it("sem --sim, recusar a confirmação não define conta", async () => {
    const { wrangler, escolhidas, definirConta } = ambienteCom([CONTA_A, CONTA_B]);
    const { terminal } = criaTerminalFalso(["1", "n"]);

    const conta = await confirmaConta(wrangler, terminal, false, definirConta);

    expect(conta).toBeUndefined();
    expect(escolhidas).toEqual([]);
  });
});

describe("confirmaConta com uma conta", () => {
  it("com --sim, a única conta vai para definirConta sem perguntar", async () => {
    const { wrangler, escolhidas, definirConta } = ambienteCom([CONTA_A]);
    const { terminal, perguntas } = criaTerminalFalso([]);

    const conta = await confirmaConta(wrangler, terminal, true, definirConta);

    expect(conta).toEqual(CONTA_A);
    expect(escolhidas).toEqual([CONTA_A.id]);
    expect(perguntas).toEqual([]);
  });
});
