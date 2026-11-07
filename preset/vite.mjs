import react from "@vitejs/plugin-react";

// Preset dos apps: React, saída em dist/client e a API servida pelo wrangler dev na porta 8787.
export function presetVite() {
  return {
    plugins: [react()],
    build: { outDir: "dist/client", emptyOutDir: true },
    server: {
      port: 5173,
      strictPort: true,
      proxy: { "/api": "http://localhost:8787" },
    },
  };
}
