import { describe, expect, it } from "vitest";
import pkg from "../../package.json";
import type { HealthResponse } from "../../src/shared/api";
import { createApp } from "../../src/worker/app";
import { callApi } from "./helpers/app";

describe("GET /api/health", () => {
  it("responde 200 com ok, a versão do package.json e a data em ISO 8601", async () => {
    const resposta = await callApi(createApp(), "GET", "/api/health");

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("content-type")).toContain("application/json");
    const corpo = (await resposta.json()) as HealthResponse;
    expect(corpo.ok).toBe(true);
    expect(corpo.version).toBe(pkg.version);
    expect(new Date(corpo.at).toISOString()).toBe(corpo.at);
  });
});
