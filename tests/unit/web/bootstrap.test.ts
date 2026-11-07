import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStartRoute, START_CHECKS } from "@/app/bootstrap";
import { ApiError } from "@/lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveStartRoute", () => {
  it("com a saúde da API ok, vai para /inicio", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, version: "0.1.0", at: "2026-11-07T00:00:00.000Z" })),
    );

    await expect(resolveStartRoute()).resolves.toBe("/inicio");
  });

  it("consulta GET /api/health", async () => {
    const fetchSimulado = vi.fn(async () => Response.json({ ok: true, version: "0.1.0", at: "x" }));
    vi.stubGlobal("fetch", fetchSimulado);

    await resolveStartRoute();

    expect(fetchSimulado).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("com o fetch rejeitado, falha com ApiError sem_conexao", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const erro = await resolveStartRoute().catch((motivo: unknown) => motivo);

    expect(erro).toBeInstanceOf(ApiError);
    expect(erro).toMatchObject({ status: 0, code: "sem_conexao" });
  });

  it("uma verificação que devolve uma rota vence as seguintes (as das próximas tasks)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, version: "0.1.0", at: "x" })),
    );
    const verificacao = async () => "/entrar";
    START_CHECKS.unshift(verificacao);
    try {
      await expect(resolveStartRoute()).resolves.toBe("/entrar");
    } finally {
      START_CHECKS.shift();
    }
  });
});
