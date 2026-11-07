import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../../src/web/App";

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("mostra a versão quando a API responde", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, version: "0.1.0", at: "2026-11-07T00:00:00.000Z" })),
    );

    render(<App />);

    expect(await screen.findByText("API ok · versão 0.1.0")).toBeInTheDocument();
  });

  it("mostra que a API está fora quando a chamada falha", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    render(<App />);

    expect(await screen.findByText(/API fora do ar/)).toBeInTheDocument();
  });
});
