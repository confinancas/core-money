import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, CODIGO_DE_LIMITE, isCloudflareLimitResponse } from "@/lib/api";
import { lerLimiteAtingido, limpaLimiteAtingido } from "@/usage/limite-store";

// Limite do plano gratuito (TASK-0109, cenário 10): a página 1027 da Cloudflare e o 429 do D1 viram o código
// limite_atingido; um JSON da API nunca conta como limite.

const PAGINA_1027 =
  "<!DOCTYPE html><html><head><title>Error 1027</title></head><body>error code: 1027</body></html>";

afterEach(() => {
  vi.unstubAllGlobals();
  limpaLimiteAtingido();
});

function comFetch(resposta: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(resposta));
}

describe("isCloudflareLimitResponse", () => {
  it("JSON com status 429 não é a página da Cloudflare", () => {
    const json = JSON.stringify({ error: "limite_d1", resetsAt: "2026-11-11T00:00:00.000Z" });
    expect(isCloudflareLimitResponse({ status: 429 }, json)).toBe(false);
  });

  it("HTML com status 429 (sem JSON) é a página de limite", () => {
    expect(isCloudflareLimitResponse({ status: 429 }, "<html>Too many requests</html>")).toBe(true);
  });

  it("corpo que contém 1027 e não é JSON é a página de limite, mesmo sem o 429", () => {
    expect(isCloudflareLimitResponse({ status: 503 }, PAGINA_1027)).toBe(true);
  });

  it("um JSON da API com 1027 num id não é limite", () => {
    const json = JSON.stringify({ error: "convite_vencido", id: "a1027b" });
    expect(isCloudflareLimitResponse({ status: 410 }, json)).toBe(false);
  });

  it("uma resposta comum (500 sem JSON, sem 1027) não é limite", () => {
    expect(isCloudflareLimitResponse({ status: 500 }, "<html>erro</html>")).toBe(false);
  });
});

describe("apiFetch e o limite", () => {
  it("HTML 429 da Cloudflare: ApiError com limite_atingido e a tela de limite avisada por requisições", async () => {
    comFetch(
      async () => new Response(PAGINA_1027, { status: 429, headers: { "content-type": "text/html" } }),
    );

    const erro = await apiFetch("/api/members").catch((motivo: unknown) => motivo);

    expect(erro).toBeInstanceOf(ApiError);
    expect((erro as ApiError).code).toBe(CODIGO_DE_LIMITE);
    expect(CODIGO_DE_LIMITE).toBe("limite_atingido");
    expect(lerLimiteAtingido()).toBe("requisicoes");
  });

  it("429 limite_d1 da API: limite_atingido com a causa do banco", async () => {
    comFetch(async () =>
      Response.json({ error: "limite_d1", resetsAt: "2026-11-11T00:00:00.000Z" }, { status: 429 }),
    );

    const erro = await apiFetch("/api/usage").catch((motivo: unknown) => motivo);

    expect((erro as ApiError).code).toBe("limite_atingido");
    expect(lerLimiteAtingido()).toBe("banco");
  });

  it("um 422 comum da API continua com o código da convenção e não avisa limite", async () => {
    comFetch(async () => Response.json({ error: "dados_invalidos" }, { status: 422 }));

    const erro = await apiFetch("/api/x").catch((motivo: unknown) => motivo);

    expect((erro as ApiError).code).toBe("dados_invalidos");
    expect(lerLimiteAtingido()).toBeNull();
  });
});
