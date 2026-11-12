import { describe, expect, it } from "vitest";
import { casamentosDoExtrato, casaRendaPeloExtrato } from "../../src/worker/income/casamento-puro";

// Casamento de entradas com a renda pelo texto do extrato (TASK-0902). Sem acento e sem caixa; o texto mais longo vence;
// empate não casa. Os nomes são [TEST].

describe("casaRendaPeloExtrato", () => {
  it("casa quando o texto da renda aparece no extrato, sem acento e sem caixa", () => {
    const rendas = [{ id: "clt", statementText: "SALÁRIO" }];
    expect(casaRendaPeloExtrato("[TEST] salario empresa x", rendas)).toBe("clt");
  });

  it("cenário 13: entre SALARIO e SALARIO EMPRESA X, vence o mais longo", () => {
    const rendas = [
      { id: "curta", statementText: "SALARIO" },
      { id: "longa", statementText: "SALARIO EMPRESA X" },
    ];
    expect(casaRendaPeloExtrato("SALARIO EMPRESA X 11/2026", rendas)).toBe("longa");
  });

  it("cenário 13: dois textos iguais não casam (fica para classificar)", () => {
    const rendas = [
      { id: "a", statementText: "SALARIO" },
      { id: "b", statementText: "salario" },
    ];
    expect(casaRendaPeloExtrato("SALARIO EMPRESA", rendas)).toBeNull();
  });

  it("sem texto no extrato que bata, não casa; texto vazio não casa nada", () => {
    expect(casaRendaPeloExtrato("PIX RECEBIDO FULANO", [{ id: "clt", statementText: "SALARIO" }])).toBeNull();
    expect(casaRendaPeloExtrato("QUALQUER", [{ id: "vazia", statementText: "" }])).toBeNull();
  });
});

describe("casamentosDoExtrato", () => {
  it("não casa entrada sem ciclo atribuído (o passo 2 ainda não a viu)", () => {
    const candidatas = [
      { id: "t1", description: "SALARIO", receivedOn: "2026-11-05", cycleKey: null, amountCents: 500000 },
      {
        id: "t2",
        description: "SALARIO",
        receivedOn: "2026-11-05",
        cycleKey: "2026-10",
        amountCents: 500000,
      },
    ];
    const casados = casamentosDoExtrato(candidatas, [{ id: "clt", statementText: "SALARIO" }]);
    expect(casados).toEqual([
      {
        transactionId: "t2",
        fixedIncomeId: "clt",
        cycleKey: "2026-10",
        receivedOn: "2026-11-05",
        amountCents: 500000,
      },
    ]);
  });
});
