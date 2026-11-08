import { describe, expect, it } from "vitest";
import { isPublicRoute, PUBLIC_API_ROUTES } from "../../../src/worker/auth/public-routes";

// Só as rotas de acesso, de configuração e a saúde ficam fora da sessão (TASK-0104). Todo o resto de /api exige sessão.
describe("rotas públicas", () => {
  it("lista exatamente as rotas da spec", () => {
    expect([...PUBLIC_API_ROUTES]).toEqual([
      "GET /api/health",
      "/api/setup/*",
      "POST /api/auth/login/options",
      "POST /api/auth/login/verify",
      "POST /api/auth/logout",
      "GET /api/auth/session",
      "POST /api/invites/inspect",
      "POST /api/invites/accept/options",
      "POST /api/invites/accept/verify",
    ]);
  });

  it.each([
    ["GET", "/api/health"],
    ["GET", "/api/setup/status"],
    ["POST", "/api/setup/unlock"],
    ["POST", "/api/setup/household/options"],
    ["POST", "/api/setup/household/verify"],
    ["POST", "/api/auth/login/options"],
    ["POST", "/api/auth/login/verify"],
    ["POST", "/api/auth/logout"],
    ["GET", "/api/auth/session"],
    ["POST", "/api/invites/inspect"],
    ["POST", "/api/invites/accept/options"],
    ["POST", "/api/invites/accept/verify"],
  ])("%s %s é pública", (metodo, caminho) => {
    expect(isPublicRoute(metodo, caminho)).toBe(true);
  });

  it.each([
    ["GET", "/api/features"],
    ["GET", "/api/settings/keys"],
    ["PUT", "/api/settings/keys/claude"],
    ["PUT", "/api/features/assistente"],
    ["GET", "/api/household"],
    ["PATCH", "/api/household"],
    ["GET", "/api/categories"],
    ["POST", "/api/rules"],
    ["GET", "/api/health/detalhe"],
    ["POST", "/api/auth/session"],
    ["GET", "/api/auth/login/options"],
    ["POST", "/api/auth/session"],
    ["GET", "/api/invites"],
    ["POST", "/api/invites/conjuge"],
    ["POST", "/api/invites/abc/renew"],
    ["DELETE", "/api/invites/abc"],
    ["POST", "/api/invites/inspect/extra"],
    ["GET", "/api/invites/inspect"],
    ["POST", "/api/invites/accept/options/extra"],
    ["POST", "/api/invites/accept"],
  ])("%s %s exige sessão", (metodo, caminho) => {
    expect(isPublicRoute(metodo, caminho)).toBe(false);
  });
});
