import { describe, expect, it } from "vitest";
import { decidirSumicos } from "../../../../src/worker/sync/regras";
import { situacaoDoBanco } from "../../../../src/worker/sync/situacao";

// Guardas do que sumiu (TASK-0205): janela com zero linhas não marca; sumiço acima de 30% e pelo menos 5 não marca e pede
// conferência. Função pura. E a situação do banco para "Baixar agora": falhou e pode repetir.

describe("decidirSumicos", () => {
  it("janela que voltou com zero linhas: não marca nada (leitura vazia com autorização vencida)", () => {
    expect(decidirSumicos({ lidas: 0, locais: 12, candidatas: 12 })).toEqual({
      marcar: false,
      conferir: false,
    });
  });

  it("nenhuma candidata: nada a marcar, sem conferência", () => {
    expect(decidirSumicos({ lidas: 9, locais: 12, candidatas: 0 })).toEqual({
      marcar: false,
      conferir: false,
    });
  });

  it("um sumiço isolado: marca", () => {
    expect(decidirSumicos({ lidas: 9, locais: 100, candidatas: 1 })).toEqual({
      marcar: true,
      conferir: false,
    });
  });

  it("quatro candidatas de dez (acima de 30%, mas abaixo de 5): marca, a guarda de tamanho não se aplica", () => {
    expect(decidirSumicos({ lidas: 9, locais: 10, candidatas: 4 })).toEqual({
      marcar: true,
      conferir: false,
    });
  });

  it("exatamente 30% de 100 linhas (com 30 candidatas): marca, porque a guarda é 'mais de 30%'", () => {
    expect(decidirSumicos({ lidas: 90, locais: 100, candidatas: 30 })).toEqual({
      marcar: true,
      conferir: false,
    });
  });

  it("40 de 100 ausentes (cenário 11): não marca e pede conferência", () => {
    expect(decidirSumicos({ lidas: 60, locais: 100, candidatas: 40 })).toEqual({
      marcar: false,
      conferir: true,
    });
  });

  it("cinco de dez (50% e cinco): não marca e pede conferência", () => {
    expect(decidirSumicos({ lidas: 5, locais: 10, candidatas: 5 })).toEqual({
      marcar: false,
      conferir: true,
    });
  });
});

describe("situacaoDoBanco: falhou e pode repetir", () => {
  it("última execução instável por banco instável, sem aberta: falhou e pode repetir", () => {
    expect(
      situacaoDoBanco({ ultimoStatus: "instavel", ultimoErro: "banco_instavel", aberta: false }),
    ).toEqual({
      failed: true,
      canRetry: true,
    });
  });

  it("erro inesperado: falhou e pode repetir", () => {
    expect(situacaoDoBanco({ ultimoStatus: "erro", ultimoErro: "erro_inesperado", aberta: false })).toEqual({
      failed: true,
      canRetry: true,
    });
  });

  it("erro de chaves: falhou, mas repetir não resolve (cenário 6)", () => {
    expect(situacaoDoBanco({ ultimoStatus: "erro", ultimoErro: "sem_chaves", aberta: false })).toEqual({
      failed: true,
      canRetry: false,
    });
  });

  it("com execução aberta: não pode repetir", () => {
    expect(situacaoDoBanco({ ultimoStatus: "instavel", ultimoErro: "banco_instavel", aberta: true })).toEqual(
      {
        failed: true,
        canRetry: false,
      },
    );
  });

  it("última com sucesso ou sem execução: não falhou", () => {
    expect(situacaoDoBanco({ ultimoStatus: "ok", ultimoErro: null, aberta: false })).toEqual({
      failed: false,
      canRetry: false,
    });
    expect(situacaoDoBanco({ ultimoStatus: null, ultimoErro: null, aberta: false })).toEqual({
      failed: false,
      canRetry: false,
    });
  });
});
