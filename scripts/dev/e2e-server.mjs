#!/usr/bin/env node
// Sobe o app para o Playwright: build no modo e2e (igual à produção), D1 local zerado e wrangler dev na porta 8788.
// Sem shell: roda os binários do node_modules com o próprio Node, no Windows e no Linux.
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const estado = join(".wrangler", "e2e-state");
const vite = join("node_modules", "vite", "bin", "vite.js");
const wrangler = join("node_modules", "wrangler", "bin", "wrangler.js");
const ambiente = { ...process.env, WRANGLER_SEND_METRICS: "false" };

function roda(args) {
  const resultado = spawnSync(process.execPath, args, { cwd: raiz, stdio: "inherit", env: ambiente });
  if (resultado.status !== 0) process.exit(resultado.status ?? 1);
}

rmSync(join(raiz, estado), { recursive: true, force: true });
roda([vite, "build", "--mode", "e2e"]);
roda([wrangler, "d1", "migrations", "apply", "matrimoney-db", "--local", "--persist-to", estado]);

const dev = spawn(
  process.execPath,
  [wrangler, "dev", "--ip", "127.0.0.1", "--port", "8788", "--persist-to", estado],
  { cwd: raiz, stdio: "inherit", env: ambiente },
);
for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, () => dev.kill(sinal));
}
dev.on("exit", (codigo) => process.exit(codigo ?? 0));
