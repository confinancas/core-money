import { describe, expect, it } from "vitest";
import { textoDeRemocao } from "../../../src/web/devices/remove-device-warning";

// Qual dos textos de remoção vale para o caso (TASK-0106): o comum, o do aparelho em uso e o do último aparelho.
const base = { nome: "[TEST] Pessoa B", aparelho: "Android · Chrome", ehAtual: false, ehUltimo: false };

describe("textoDeRemocao", () => {
  it("aparelho comum: diz que a sessão aberta nele termina agora", () => {
    expect(textoDeRemocao(base)).toEqual({
      title: "Remover aparelho?",
      description: "Remover Android · Chrome? Ele deixa de entrar, e a sessão aberta nele termina agora.",
      confirmLabel: "Remover",
      cancelLabel: "Manter",
      tone: "danger",
    });
  });

  it("aparelho em uso: avisa que a pessoa sai agora", () => {
    expect(textoDeRemocao({ ...base, ehAtual: true }).description).toBe(
      "Este é o aparelho que você está usando. Ao remover, você sai agora.",
    );
  });

  it("último aparelho da pessoa: avisa que ela só volta com um link de recuperação", () => {
    expect(textoDeRemocao({ ...base, ehUltimo: true }).description).toBe(
      "É o único aparelho de [TEST] Pessoa B. Depois de remover, [TEST] Pessoa B só volta a entrar com um link de recuperação.",
    );
  });

  it("o aparelho em uso e o último ao mesmo tempo: o texto junta os dois avisos", () => {
    const texto = textoDeRemocao({ ...base, ehAtual: true, ehUltimo: true }).description;
    expect(texto).toContain("você está usando");
    expect(texto).toContain("você sai agora");
    expect(texto).toContain("só volta a entrar com um link de recuperação");
  });

  it("a confirmação é de perigo, com Remover e Manter", () => {
    const opcoes = textoDeRemocao(base);
    expect(opcoes.tone).toBe("danger");
    expect(opcoes.confirmLabel).toBe("Remover");
    expect(opcoes.cancelLabel).toBe("Manter");
  });
});
