import { describe, expect, it } from "vitest";
import {
  ALFABETO_CODIGO,
  generateAccessCode,
  generateLinkToken,
  normalizeAccessCode,
  sha256Hex,
} from "../../../src/shared/access-code";

describe("generateAccessCode", () => {
  it("sai como XXXX-XXXX-XXXX, com 12 caracteres do alfabeto Crockford", () => {
    const codigo = generateAccessCode();

    expect(codigo).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(ALFABETO_CODIGO).toHaveLength(32);
    expect(ALFABETO_CODIGO).not.toMatch(/[ILOU]/);
  });

  it("não repete em 1.000 códigos", () => {
    const codigos = new Set(Array.from({ length: 1000 }, () => generateAccessCode()));

    expect(codigos.size).toBe(1000);
  });
});

describe("normalizeAccessCode", () => {
  it("põe em maiúsculas e tira espaços e hífens", () => {
    expect(normalizeAccessCode(" abcd-ef12 3456 ")).toBe("ABCDEF123456");
  });

  it("troca O por 0 e I e L por 1", () => {
    expect(normalizeAccessCode("OIL0-1ILO")).toBe("01101110");
  });
});

describe("sha256Hex", () => {
  it("bate com o vetor conhecido do SHA-256 de abc", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("as duas grafias do mesmo código dão o mesmo hash", async () => {
    const grafiaPadrao = await sha256Hex(normalizeAccessCode("ABCD-EF0O-1I34"));
    const grafiaDigitada = await sha256Hex(normalizeAccessCode("abcd ef00 1l34"));

    expect(grafiaDigitada).toBe(grafiaPadrao);
  });

  it("grafias diferentes dão hashes diferentes", async () => {
    expect(await sha256Hex(normalizeAccessCode("ABCD-EF01-2345"))).not.toBe(
      await sha256Hex(normalizeAccessCode("ABCD-EF01-2346")),
    );
  });
});

describe("generateLinkToken", () => {
  it("tem 43 caracteres em base64url, sem preenchimento", () => {
    const token = generateLinkToken();

    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("muda a cada chamada", () => {
    expect(generateLinkToken()).not.toBe(generateLinkToken());
  });
});
