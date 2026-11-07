import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Os valores de compatibilidade são os do wrangler.jsonc; o teste de config confere que são iguais.
export const compatibilityDate = "2026-10-15";
export const compatibilityFlags = ["nodejs_compat"];

const pastaDeMigracoes = fileURLToPath(new URL("./migrations", import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./src/worker/index.ts",
      miniflare: {
        compatibilityDate,
        compatibilityFlags,
        d1Databases: ["DB"],
        bindings: { TEST_MIGRATIONS: await readD1Migrations(pastaDeMigracoes) },
      },
    })),
  ],
  test: {
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/setup/apply-migrations.ts"],
    // Os arquivos dividem o mesmo D1 de teste (sem armazenamento isolado): um de cada vez.
    fileParallelism: false,
  },
});
