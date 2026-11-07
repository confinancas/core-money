import { beforeEach, describe, expect, it } from "vitest";
import {
  apagarApiKey,
  guardarApiKey,
  lerApiKey,
  limparCacheApiKey,
  TTL_API_KEY_MS,
} from "../../../../src/worker/pluggy/api-key-cache";

const MINUTO = 60 * 1000;
const T0 = 1_000_000;

describe("cache da apiKey", () => {
  beforeEach(() => {
    limparCacheApiKey();
  });

  it("o TTL é 110 minutos", () => {
    expect(TTL_API_KEY_MS).toBe(110 * MINUTO);
  });

  it("vale com 109 minutos e vence com 111", () => {
    guardarApiKey("conexao-a", "[TEST] key-a", T0);
    expect(lerApiKey("conexao-a", T0 + 109 * MINUTO)).toBe("[TEST] key-a");
    expect(lerApiKey("conexao-a", T0 + 111 * MINUTO)).toBeNull();
  });

  it("no limite exato de 110 minutos já está vencida", () => {
    guardarApiKey("conexao-a", "[TEST] key-a", T0);
    expect(lerApiKey("conexao-a", T0 + 110 * MINUTO - 1)).toBe("[TEST] key-a");
    expect(lerApiKey("conexao-a", T0 + 110 * MINUTO)).toBeNull();
  });

  it("dois cacheKey diferentes não se misturam", () => {
    guardarApiKey("conexao-a", "[TEST] key-a", T0);
    guardarApiKey("conexao-b", "[TEST] key-b", T0);
    expect(lerApiKey("conexao-a", T0)).toBe("[TEST] key-a");
    expect(lerApiKey("conexao-b", T0)).toBe("[TEST] key-b");
    expect(lerApiKey("conexao-c", T0)).toBeNull();
  });

  it("apagarApiKey remove só a entrada pedida", () => {
    guardarApiKey("conexao-a", "[TEST] key-a", T0);
    guardarApiKey("conexao-b", "[TEST] key-b", T0);
    apagarApiKey("conexao-a");
    expect(lerApiKey("conexao-a", T0)).toBeNull();
    expect(lerApiKey("conexao-b", T0)).toBe("[TEST] key-b");
  });
});
