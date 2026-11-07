import { defineConfig } from "@playwright/test";

// Só Chromium. O servidor do E2E (scripts/dev/e2e-server.mjs) sobe sozinho na porta 8788.
export default defineConfig({
  testDir: "tests/e2e",
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:8788", trace: "on-first-retry" },
  webServer: {
    command: "npm run e2e:server",
    url: "http://127.0.0.1:8788/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: "celular", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "tablet", use: { viewport: { width: 834, height: 1194 }, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
