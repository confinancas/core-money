import react from "@vitejs/plugin-react";

// Preset dos apps: React, saída em dist/client e a API servida pelo wrangler dev na porta 8787.
export function presetVite() {
  return {
    plugins: [react()],
    build: { outDir: "dist/client", emptyOutDir: true },
    server: {
      port: 5173,
      strictPort: true,
      // 127.0.0.1, não localhost: o wrangler escuta em IPv4 e o Node pode resolver localhost para ::1.
      proxy: { "/api": "http://127.0.0.1:8787" },
    },
  };
}
