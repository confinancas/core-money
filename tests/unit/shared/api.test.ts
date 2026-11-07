import { describe, expect, it } from "vitest";
import { isApiErrorBody } from "../../../src/shared/api";

describe("isApiErrorBody", () => {
  it.each([
    [{ error: "x" }],
    [{ error: "x", message: "y" }],
    [{ error: "validacao", fields: { nome: "Informe o nome." } }],
  ])("aceita o corpo %o", (corpo) => {
    expect(isApiErrorBody(corpo)).toBe(true);
  });

  it.each([[null], ["texto"], [{ error: 1 }], [{ error: { code: "x" } }]])("recusa o valor %o", (valor) => {
    expect(isApiErrorBody(valor)).toBe(false);
  });
});
