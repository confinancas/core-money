import { describe, expect, it } from "vitest";
import {
  destinoDaVolta,
  estadoDaEscolha,
  iniciais,
  linhaDaSugestao,
  mesDoCiclo,
  rotuloDoDocumento,
  textoDaData,
  textoDeEstado,
  textoDoCiclo,
  textoDoImpacto,
} from "../../src/web/screens/pix-recebido/format";

describe("textos do Pix recebido", () => {
  it("as iniciais são as duas primeiras letras de cada uma das duas primeiras palavras", () => {
    expect(iniciais("Fulana Souza")).toBe("FS");
    expect(iniciais("[TEST] Fulana")).toBe("TF");
    expect(iniciais("Madonna")).toBe("MA");
    expect(iniciais(null)).toBe("?");
  });

  it("o rótulo é CNPJ quando o documento mascarado tem barra, senão CPF", () => {
    expect(rotuloDoDocumento("**.123.456/0001-**")).toBe("CNPJ");
    expect(rotuloDoDocumento("***.123.456-**")).toBe("CPF");
    expect(rotuloDoDocumento(null)).toBeNull();
  });

  it("o estado diz o que a classificação faz, e avisa quando não há", () => {
    expect(textoDeEstado(null)).toEqual({ texto: "Escolha uma opção", aviso: true });
    expect(textoDeEstado({ option: "salario", incomeSubtype: null }).texto).toBe("Parte do salário");
    expect(textoDeEstado({ option: "variavel", incomeSubtype: "venda" }).texto).toBe(
      "Renda variável · Venda",
    );
    expect(textoDeEstado({ option: "reembolso", incomeSubtype: null }).texto).toBe("Fora dos cálculos");
    expect(textoDeEstado({ option: "transferencia", incomeSubtype: null }).texto).toBe("Não é renda");
  });

  it("'Como conta' segue a escolha atual da tela, não a classificação salva (rodada E2E)", () => {
    expect(estadoDaEscolha(null, null)).toEqual({ texto: "Escolha uma opção", aviso: true });
    expect(estadoDaEscolha("reembolso", null).texto).toBe("Fora dos cálculos");
    expect(estadoDaEscolha("variavel", null).texto).toBe("Renda variável");
    expect(estadoDaEscolha("variavel", "cashback").texto).toBe("Renda variável · Cashback");
  });

  it("o impacto só aparece quando muda, no formato 'antes → depois'", () => {
    expect(textoDoImpacto(1_656_870, 1_806_870)).toBe("16.568,70 → 18.068,70");
    expect(textoDoImpacto(750_000, 750_000)).toBeNull();
  });

  it("a data é do dia e a hora de São Paulo", () => {
    expect(textoDaData("2026-10-10", "2026-10-10T21:05:00.000Z")).toBe("10/10 às 18:05");
  });
});

describe("textos da tela do Pix recebido (rodada de correção)", () => {
  it("a sugestão da IA diz a certeza por extenso, nunca o código cru", () => {
    expect(linhaDaSugestao("media", null)).toBe("Sugestão da IA · média certeza");
    expect(linhaDaSugestao("alta", "salário em dólar")).toBe(
      "Sugestão da IA · alta certeza · salário em dólar",
    );
    expect(linhaDaSugestao("pouca", "")).toBe("Sugestão da IA · pouca certeza");
    expect(linhaDaSugestao(null, null)).toBe("Sugestão da IA");
  });

  it("o mês do ciclo sai por extenso, e o ciclo como na spec", () => {
    expect(mesDoCiclo("2026-10")).toBe("outubro");
    expect(mesDoCiclo("2026-03")).toBe("março");
    expect(textoDoCiclo("2026-10", "2026-10-11", "2026-11-10")).toBe("Outubro · 11/10 – 10/11");
    expect(textoDoCiclo("2026-09", "2026-09-11", "2026-10-10")).toBe("Setembro · 11/09 – 10/10");
  });

  it("a volta usa o ?voltar= válido, depois o histórico, e por fim a Renda", () => {
    expect(destinoDaVolta("/para-categorizar", true)).toBe("/para-categorizar");
    expect(destinoDaVolta(null, true)).toBe(-1);
    expect(destinoDaVolta(null, false)).toBe("/renda");
  });
});
