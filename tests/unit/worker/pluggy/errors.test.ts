import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyPluggyResponse, PluggyError, parseRetryAfter } from "../../../../src/worker/pluggy/errors";
import { lerFixture } from "../../../fixtures/pluggy/servidor";

const SEGREDO = "[TEST] segredo-do-cliente-fixture";

describe("classifyPluggyResponse: tabela de kind", () => {
  const linhas: [number, string][] = [
    [401, "auth"],
    [403, "forbidden"],
    [404, "not_found"],
    [429, "rate_limited"],
    [400, "bad_request"],
    [409, "bad_request"],
    [422, "bad_request"],
    [500, "temporary"],
    [502, "temporary"],
    [503, "temporary"],
  ];

  it.each(linhas)("status %i vira kind %s", (status, kind) => {
    const erro = classifyPluggyResponse({ status, corpo: undefined, metodo: "GET", rota: "/accounts" });
    expect(erro).toBeInstanceOf(PluggyError);
    expect(erro.kind).toBe(kind);
    expect(erro.status).toBe(status);
  });

  it("usa o codeDescription do corpo como code", () => {
    const corpo = lerFixture("error-403-list.json");
    const erro = classifyPluggyResponse({ status: 403, corpo, metodo: "GET", rota: "/items" });
    expect(erro.kind).toBe("forbidden");
    expect(erro.code).toBe("LIST_ITEMS_FEATURE_NOT_ENABLED");
  });

  it("sem codeDescription, o code é SEM_CODIGO e o corpo não entra na mensagem", () => {
    const erro = classifyPluggyResponse({
      status: 500,
      corpo: { code: 500, message: "[TEST] texto do corpo" },
      metodo: "GET",
      rota: "/accounts",
    });
    expect(erro.code).toBe("SEM_CODIGO");
    expect(erro.message).toBe("pluggy GET /accounts 500 SEM_CODIGO");
    expect(erro.message).not.toContain("texto do corpo");
  });

  it("a mensagem é exatamente pluggy <MÉTODO> <rota> <status> <code>, sem query", () => {
    const erro = classifyPluggyResponse({
      status: 404,
      corpo: { codeDescription: "ITEM_NOT_FOUND" },
      metodo: "GET",
      rota: "/items/:id",
    });
    expect(erro.message).toBe("pluggy GET /items/:id 404 ITEM_NOT_FOUND");
    expect(String(erro)).toBe("PluggyError: pluggy GET /items/:id 404 ITEM_NOT_FOUND");
  });

  it("codeDescription vazio ou que não é texto não vira code", () => {
    expect(
      classifyPluggyResponse({ status: 400, corpo: { codeDescription: "" }, metodo: "GET", rota: "/x" }).code,
    ).toBe("SEM_CODIGO");
    expect(
      classifyPluggyResponse({ status: 400, corpo: { codeDescription: 42 }, metodo: "GET", rota: "/x" }).code,
    ).toBe("SEM_CODIGO");
  });

  it("429 leva o retryAfterSec do cabeçalho", () => {
    const erro = classifyPluggyResponse({
      status: 429,
      corpo: undefined,
      metodo: "GET",
      rota: "/accounts",
      retryAfter: "60",
    });
    expect(erro.kind).toBe("rate_limited");
    expect(erro.retryAfterSec).toBe(60);
  });

  it("não anexa cause do erro original", () => {
    const erro = classifyPluggyResponse({ status: 502, corpo: undefined, metodo: "GET", rota: "/accounts" });
    expect("cause" in erro).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  it("segundos inteiros viram número", () => {
    expect(parseRetryAfter("60")).toBe(60);
    expect(parseRetryAfter(" 30 ")).toBe(30);
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("ausente, em formato de data, negativo ou inválido vira undefined, nunca NaN", () => {
    const invalidos = [null, "", "abc", "Wed, 21 Oct 2026 07:28:00 GMT", "-5", "1.5", "12s"];
    for (const valor of invalidos) {
      const resultado = parseRetryAfter(valor);
      expect(resultado).toBeUndefined();
      expect(Number.isNaN(resultado)).toBe(false);
    }
  });
});

describe("erro sem segredo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("String(erro) de um 401 do /auth não contém o segredo", () => {
    const erro = classifyPluggyResponse({
      status: 401,
      corpo: { codeDescription: "CLIENT_KEYS_UNAUTHORIZED", message: SEGREDO },
      metodo: "POST",
      rota: "/auth",
    });
    expect(String(erro)).not.toContain(SEGREDO);
    expect(erro.message).not.toContain(SEGREDO);
  });
});
