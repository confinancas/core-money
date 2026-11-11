import { describe, expect, it } from "vitest";
import { suggestionText } from "../../src/shared/categorization";
import {
  caminhoDoDetalhe,
  linhaDeDetalhe,
  rotuloDaData,
  rotuloDaOpcaoDeRenda,
  tituloDaLinha,
} from "../../src/shared/para-categorizar";

// Formatação da fila Para categorizar (TASK-0304): títulos, linha de detalhe, data relativa e caminho do detalhe.
const base = { customName: null, counterpartyName: null, originalDescription: "  ASAAS12MAT  " };

describe("título da linha", () => {
  it("nome próprio vence tudo", () => {
    expect(
      tituloDaLinha({
        ...base,
        movement: "pix_enviado",
        customName: "[TEST] Mercado",
        counterpartyName: "X",
      }),
    ).toBe("[TEST] Mercado");
  });
  it("cada movimento com contraparte", () => {
    const contraparte = "JOAO P SILVA";
    expect(tituloDaLinha({ ...base, movement: "pix_enviado", counterpartyName: contraparte })).toBe(
      `Pix para ${contraparte}`,
    );
    expect(tituloDaLinha({ ...base, movement: "ted_enviada", counterpartyName: contraparte })).toBe(
      `TED para ${contraparte}`,
    );
    expect(tituloDaLinha({ ...base, movement: "pix_recebido", counterpartyName: contraparte })).toBe(
      `Pix de ${contraparte}`,
    );
    expect(tituloDaLinha({ ...base, movement: "ted_recebida", counterpartyName: contraparte })).toBe(
      `TED de ${contraparte}`,
    );
  });
  it("sem contraparte, ou compra, vale a descrição sem espaços", () => {
    expect(tituloDaLinha({ ...base, movement: "pix_enviado", counterpartyName: null })).toBe("ASAAS12MAT");
    expect(tituloDaLinha({ ...base, movement: "compra", counterpartyName: "IGNORADO" })).toBe("ASAAS12MAT");
    expect(tituloDaLinha({ ...base, movement: "boleto", counterpartyName: "IGNORADO" })).toBe("ASAAS12MAT");
  });
});

describe("data relativa (São Paulo)", () => {
  it("hoje, ontem e dd/mm", () => {
    expect(rotuloDaData("2026-11-11", "2026-11-11")).toBe("Hoje");
    expect(rotuloDaData("2026-11-10", "2026-11-11")).toBe("Ontem");
    expect(rotuloDaData("2026-10-06", "2026-11-11")).toBe("06/10");
  });
  it("virada do dia: 23h59 ainda é ontem, 00h01 é hoje", () => {
    expect(rotuloDaData("2026-11-10", "2026-11-10")).toBe("Hoje");
    expect(rotuloDaData("2026-11-10", "2026-11-11")).toBe("Ontem");
    expect(rotuloDaData("2026-11-11", "2026-11-11")).toBe("Hoje");
  });
  it("virada de mês", () => {
    expect(rotuloDaData("2026-10-31", "2026-11-01")).toBe("Ontem");
  });
});

describe("linha de detalhe", () => {
  const hoje = "2026-10-10";
  it("cartão com banco", () => {
    expect(
      linhaDeDetalhe({ dataLocal: "2026-10-06", hoje, movement: "compra", cartao: true, banco: "Itaú" }),
    ).toBe("06/10 · cartão Itaú");
  });
  it("Pix com banco e sem banco", () => {
    expect(
      linhaDeDetalhe({ dataLocal: hoje, hoje, movement: "pix_enviado", cartao: false, banco: "Inter" }),
    ).toBe("Hoje · Pix · Inter");
    expect(
      linhaDeDetalhe({ dataLocal: hoje, hoje, movement: "pix_enviado", cartao: false, banco: null }),
    ).toBe("Hoje · Pix");
  });
  it("tipos das outras saídas e entradas", () => {
    const f = (movement: string) =>
      linhaDeDetalhe({ dataLocal: "2026-10-10", hoje, movement, cartao: false, banco: "Inter" });
    expect(f("ted_enviada")).toBe("Hoje · TED · Inter");
    expect(f("pix_recebido")).toBe("Hoje · Pix recebido · Inter");
    expect(f("ted_recebida")).toBe("Hoje · TED recebida · Inter");
    expect(f("debito")).toBe("Hoje · Débito · Inter");
    expect(f("boleto")).toBe("Hoje · Boleto · Inter");
    expect(f("outro")).toBe("Hoje · Outra saída · Inter");
  });
});

describe("caminho do detalhe", () => {
  it("cada tipo", () => {
    expect(caminhoDoDetalhe({ id: "a", tipo: "cartao", movement: "compra" })).toBe("/compras/a");
    expect(caminhoDoDetalhe({ id: "a", tipo: "pix", movement: "pix_enviado" })).toBe("/pix/a");
    expect(caminhoDoDetalhe({ id: "a", tipo: "pix", movement: "ted_enviada" })).toBe("/pix/a");
    expect(caminhoDoDetalhe({ id: "a", tipo: "entrada", movement: "pix_recebido" })).toBe("/pix-recebido/a");
    expect(caminhoDoDetalhe({ id: "a", tipo: "outro", movement: "debito" })).toBe("/compras/a");
    expect(caminhoDoDetalhe({ id: "a", tipo: "outro", movement: "boleto" })).toBe("/compras/a");
    expect(caminhoDoDetalhe({ id: "a", tipo: "outro", movement: "outro" })).toBe("/compras/a");
  });
});

describe("textos de sugestão", () => {
  it("categoria: motivo e certeza", () => {
    expect(suggestionText("alta", "CNPJ de restaurante")).toBe("CNPJ de restaurante · certeza alta");
    expect(suggestionText("pouca", null)).toBe("pouca certeza");
    expect(suggestionText(null, null)).toBeNull();
  });
  it("opções de renda", () => {
    expect(rotuloDaOpcaoDeRenda("salario")).toBe("Parte do salário");
    expect(rotuloDaOpcaoDeRenda("variavel")).toBe("Renda variável");
    expect(rotuloDaOpcaoDeRenda("reembolso")).toBe("Reembolso de terceiros");
    expect(rotuloDaOpcaoDeRenda("transferencia")).toBe("Transferência entre vocês");
  });
});
