import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

// Preset dos apps: React, Tailwind, alias @ para src/web e saída em dist/client, com a API no wrangler dev (porta 8787).
// O alias sai do próprio arquivo: num app, o núcleo está em node_modules e o caminho muda.
// __DEV_ROUTES__ depende do mode: as rotas de desenvolvimento (o catálogo) não entram no build de produção.
export function presetVite() {
  return ({ mode }) => ({
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("../src/web", import.meta.url)) },
    },
    define: { __DEV_ROUTES__: JSON.stringify(mode !== "production") },
    build: { outDir: "dist/client", emptyOutDir: true },
    server: {
      port: 5173,
      strictPort: true,
      // 127.0.0.1, não localhost: o wrangler escuta em IPv4 e o Node pode resolver localhost para ::1.
      proxy: { "/api": "http://127.0.0.1:8787" },
    },
  });
}
