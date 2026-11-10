import { defineConfig } from "@playwright/test";
import { portasDoE2E } from "./scripts/dev/e2e-portas.mjs";

// Só Chromium. O servidor do E2E (scripts/dev/e2e-server.mjs) sobe sozinho, nas portas do bloco de MM_E2E_PORTA_BASE
// (scripts/dev/e2e-portas.mjs; sem a variável, vale o padrão do módulo): a instalação pronta (a base) e a configuração inicial
// do zero (testes de configuracao-inicial.spec.ts). Um worker só: os testes mudam o estado do D1 local, e os dois
// projetos compartilham a instalação pronta.
const portas = portasDoE2E(process.env.MM_E2E_PORTA_BASE);
const origem = `http://127.0.0.1:${portas.instalacaoPronta}`;

export default defineConfig({
  testDir: "tests/e2e",
  // Semeia o lar, a passkey e a sessão da instalação pronta (TASK-0104), uma vez por execução.
  globalSetup: "./tests/e2e/global-setup.ts",
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: origem, trace: "on-first-retry" },
  webServer: {
    command: "npm run e2e:server",
    url: `${origem}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: "celular", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "tablet", use: { viewport: { width: 834, height: 1194 }, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
