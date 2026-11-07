#!/usr/bin/env node
// Instala ou atualiza o app da pasta atual (TASK-0101). Roda scripts/instalar.ts pelo tsx, sem shell.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requerer = createRequire(import.meta.url);
const tsxCli = join(dirname(requerer.resolve("tsx/package.json")), "dist", "cli.mjs");
const script = join(raiz, "scripts", "instalar.ts");

const filho = spawn(process.execPath, [tsxCli, script, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: "inherit",
  shell: false,
  windowsHide: true,
});
filho.on("close", (codigo) => {
  process.exitCode = codigo ?? 1;
});
filho.on("error", (erro) => {
  console.error(`Não consegui rodar o instalador: ${erro.message}`);
  process.exitCode = 1;
});
