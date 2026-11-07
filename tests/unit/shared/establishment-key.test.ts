import { describe, expect, it } from "vitest";
import { establishmentKey, INSTALLMENT_SUFFIX_RE } from "../../../src/shared/establishment-key";

describe("establishmentKey", () => {
  it.each([
    [" asaas12mat ", "ASAAS12MAT"],
    ["ASAAS12MAT", "ASAAS12MAT"],
    ["LOJA X 02/10", "LOJA X"],
    ["loja x parc 03/10", "LOJA X"],
    ["LOJA X PARCELA 3 DE 10", "LOJA X"],
    ["Açaí do Zé", "ACAI DO ZE"],
  ])("a chave de %j é %j", (descricao, chave) => {
    expect(establishmentKey(descricao)).toBe(chave);
  });

  it("mantém diferentes os estabelecimentos com dígitos no nome", () => {
    expect(establishmentKey("ASAAS12MAT")).not.toBe(establishmentKey("ASAAS13MAT"));
  });

  it("texto vazio devolve null", () => {
    expect(establishmentKey("")).toBeNull();
    expect(establishmentKey("   ")).toBeNull();
  });

  it("só marca de parcela também devolve null", () => {
    expect(establishmentKey("02/10")).toBeNull();
  });

  it("a marca de parcela só sai do fim do texto", () => {
    expect(establishmentKey("10/12 LOJA")).toBe("10/12 LOJA");
  });
});

describe("INSTALLMENT_SUFFIX_RE", () => {
  it("é a expressão da especificação", () => {
    expect(INSTALLMENT_SUFFIX_RE.source).toBe(
      "\\s*(?:PARC(?:ELA)?\\.?\\s*)?\\d{1,2}\\s*(?:\\/|DE)\\s*\\d{1,2}$",
    );
  });
});
