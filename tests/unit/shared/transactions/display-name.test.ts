import { describe, expect, it } from "vitest";
import { displayName, type LancamentoParaNome } from "../../../../src/shared/transactions/display-name";

const base: LancamentoParaNome = {
  customName: null,
  movement: "compra",
  counterpartyName: null,
  originalDescription: "[TEST] IFOOD *RESTAURANTE 123",
};

describe("displayName", () => {
  it("usa o nome corrigido pelo casal antes de tudo", () => {
    expect(
      displayName({ ...base, customName: "[TEST] Almoço", movement: "pix_enviado", counterpartyName: "X" }),
    ).toBe("[TEST] Almoço");
  });

  it("ignora nome corrigido em branco e cai para a regra seguinte", () => {
    expect(displayName({ ...base, customName: "   " })).toBe("[TEST] IFOOD *RESTAURANTE 123");
  });

  it("Pix e TED enviados mostram para quem", () => {
    expect(displayName({ ...base, movement: "pix_enviado", counterpartyName: "[TEST] Maria" })).toBe(
      "Pix para [TEST] Maria",
    );
    expect(displayName({ ...base, movement: "ted_enviada", counterpartyName: "[TEST] Corretora" })).toBe(
      "TED para [TEST] Corretora",
    );
  });

  it("Pix e TED recebidos mostram de quem", () => {
    expect(displayName({ ...base, movement: "pix_recebido", counterpartyName: "[TEST] João" })).toBe(
      "Pix de [TEST] João",
    );
    expect(displayName({ ...base, movement: "ted_recebida", counterpartyName: "[TEST] Empresa" })).toBe(
      "TED de [TEST] Empresa",
    );
  });

  it("sem contraparte, cai para a descrição original", () => {
    expect(displayName({ ...base, movement: "pix_enviado", counterpartyName: null })).toBe(
      "[TEST] IFOOD *RESTAURANTE 123",
    );
    expect(displayName({ ...base, movement: "pix_enviado", counterpartyName: "  " })).toBe(
      "[TEST] IFOOD *RESTAURANTE 123",
    );
  });

  it("compra com contraparte continua mostrando a descrição (contraparte só vale para Pix e TED)", () => {
    expect(displayName({ ...base, counterpartyName: "[TEST] Loja" })).toBe("[TEST] IFOOD *RESTAURANTE 123");
  });

  it("não remove espaços do meio do nome corrigido", () => {
    expect(displayName({ ...base, customName: "  [TEST]  Padaria   do Bairro " })).toBe(
      "[TEST]  Padaria   do Bairro",
    );
  });
});
