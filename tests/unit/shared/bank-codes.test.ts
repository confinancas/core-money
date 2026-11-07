import { describe, expect, it } from "vitest";
import { BANKS, bankNameFromCode, institutionFromText } from "../../../src/shared/bank-codes";

describe("bankNameFromCode", () => {
  it.each([
    ["341", "Itaú"],
    ["237", "Bradesco"],
    ["077", "Inter"],
    ["260", "Nubank"],
    ["001", "Banco do Brasil"],
    ["033", "Santander"],
    ["104", "Caixa"],
    ["323", "Mercado Pago"],
    ["336", "C6 Bank"],
    ["380", "PicPay"],
  ])("o código COMPE %s é %s", (compe, nome) => {
    expect(bankNameFromCode(compe)).toBe(nome);
  });

  it("completa o código COMPE com zeros à esquerda", () => {
    expect(bankNameFromCode("1")).toBe("Banco do Brasil");
  });

  it("código desconhecido vira 'Banco <código>'", () => {
    expect(bankNameFromCode("999")).toBe("Banco 999");
  });

  it("acha o banco pelo ISPB quando o código COMPE não vem", () => {
    expect(bankNameFromCode(undefined, "60701190")).toBe("Itaú");
  });

  it("acha o banco pelo ISPB quando o código COMPE é desconhecido", () => {
    expect(bankNameFromCode("999", "60701190")).toBe("Itaú");
  });

  it("sem código nenhum devolve null", () => {
    expect(bankNameFromCode()).toBeNull();
    expect(bankNameFromCode("", "")).toBeNull();
  });

  it("tem um código COMPE por banco, sem repetição", () => {
    const codigos = BANKS.map((banco) => banco.compe);
    expect(new Set(codigos).size).toBe(codigos.length);
    expect(codigos.length).toBeGreaterThanOrEqual(10);
  });
});

describe("institutionFromText", () => {
  it.each([
    ["Itaú Unibanco", "Itaú"],
    ["Conta Nubank", "Nubank"],
    ["Banco Inter", "Inter"],
    ["Caixa Econômica Federal", "Caixa"],
    ["Banco do Brasil", "Banco do Brasil"],
  ])("acha %s no texto", (texto, nome) => {
    expect(institutionFromText(texto)?.name).toBe(nome);
  });

  it("não acha banco em texto sem nome de banco", () => {
    expect(institutionFromText("MeuPluggy")).toBeNull();
  });

  it("não confunde 'internet' com o Inter (palavra inteira)", () => {
    expect(institutionFromText("internet banking")).toBeNull();
  });
});
