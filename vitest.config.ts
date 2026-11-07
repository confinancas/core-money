import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Dois projetos: unit (Node) e web (jsdom, para as telas em React).
// A integração com o D1 local tem config própria: vitest.integration.config.ts.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "web",
          environment: "jsdom",
          include: ["tests/unit/web/**/*.test.tsx"],
          setupFiles: ["tests/setup/web.ts"],
        },
      },
    ],
  },
});
