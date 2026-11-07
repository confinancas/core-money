import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

// Os valores de __BRAND__ e __DEV_ROUTES__ ficam em tests/setup/globais.ts (o define não chega aos projetos).
// O virtual:pwa-register vira um mock: o registro do service worker não roda no jsdom.
const aliasWeb = {
  "@": fileURLToPath(new URL("./src/web", import.meta.url)),
  "virtual:pwa-register": fileURLToPath(new URL("./tests/setup/pwa-register.ts", import.meta.url)),
};

// Dois projetos: unit (Node) e web (jsdom, para as telas em React e os testes de rota).
// A integração com o D1 local tem config própria: vitest.integration.config.ts.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "tests/unit/web/**"],
          setupFiles: ["tests/setup/globais.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: aliasWeb,
        },
        test: {
          name: "web",
          environment: "jsdom",
          include: ["tests/unit/web/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/setup/globais.ts", "tests/setup/web.ts"],
        },
      },
    ],
  },
});
