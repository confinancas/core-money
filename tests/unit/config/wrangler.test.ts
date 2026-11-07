import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";
import { describe, expect, it } from "vitest";
import { compatibilityDate, compatibilityFlags } from "../../../vitest.integration.config";

const configuracao = parse(readFileSync(new URL("../../../wrangler.jsonc", import.meta.url), "utf8"));

describe("wrangler.jsonc", () => {
  it("tem a mesma data e as mesmas flags de compatibilidade dos testes de integração", () => {
    expect(configuracao.compatibility_date).toBe(compatibilityDate);
    expect(configuracao.compatibility_flags).toEqual(compatibilityFlags);
  });

  it("se chama matrimoney", () => {
    expect(configuracao.name).toBe("matrimoney");
  });

  it("executa o Worker só nas rotas /api/*", () => {
    expect(configuracao.assets.run_worker_first).toEqual(["/api/*"]);
  });
});
