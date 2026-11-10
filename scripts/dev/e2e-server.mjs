#!/usr/bin/env node
// Sobe o app para o Playwright: build no modo e2e (igual à produção), o stub do serviço de IA e duas instâncias do wrangler dev.
// As portas vêm do bloco de scripts/dev/e2e-portas.mjs (MM_E2E_PORTA_BASE; sem a variável, a base é 8788):
// - instalação pronta (a base): os testes semeiam o primeiro acesso; é a do webServer do Playwright.
// - configuração do zero (base + 2; TASK-0102): existe à parte porque o Worker guarda "pronto" no módulo:
//   uma instalação que volta à configuração precisa de outro processo.
// A base é validada antes de qualquer processo subir.
// Sem shell: roda os binários do node_modules com o próprio Node, no Windows e no Linux.
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { portasDoE2E } from "./e2e-portas.mjs";

// Chave mestra falsa e fixa, só do E2E: cifra as chaves de teste no D1 local.
const CHAVE_MESTRA_DO_E2E = "WlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlo=";

let portas;
try {
  portas = portasDoE2E(process.env.MM_E2E_PORTA_BASE);
} catch (erro) {
  console.error(erro.message);
  process.exit(1);
}

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const estadoPronto = join(".wrangler", "e2e-state");
const estadoConfiguracao = join(".wrangler", "e2e-state-configuracao");
const vite = join("node_modules", "vite", "bin", "vite.js");
const wrangler = join("node_modules", "wrangler", "bin", "wrangler.js");
const ambiente = {
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  MM_E2E_PORTA_DO_STUB: String(portas.stub),
};

function roda(args) {
  const resultado = spawnSync(process.execPath, args, { cwd: raiz, stdio: "inherit", env: ambiente });
  if (resultado.status !== 0) process.exit(resultado.status ?? 1);
}

// Cada wrangler dev tem a sua porta de inspeção, do bloco (a mesma para os dois derrubaria o segundo no CI).
// extras: variáveis a mais do Worker. A instância de configuração do zero leva SETUP_SEM_CACHE=1: volta a
// cadastro no mesmo processo, sem o cache de "pronto" do módulo (TASK-0103 cria o lar nela).
function sobeWrangler(porta, inspecao, estado, extras = []) {
  return spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      String(porta),
      "--inspector-port",
      String(inspecao),
      "--persist-to",
      estado,
      "--var",
      `MASTER_KEY:${CHAVE_MESTRA_DO_E2E}`,
      "--var",
      `ANTHROPIC_BASE_URL:http://127.0.0.1:${portas.stub}`,
      ...extras.flatMap((variavel) => ["--var", variavel]),
    ],
    { cwd: raiz, stdio: "inherit", env: ambiente },
  );
}

rmSync(join(raiz, estadoPronto), { recursive: true, force: true });
rmSync(join(raiz, estadoConfiguracao), { recursive: true, force: true });
roda([vite, "build", "--mode", "e2e"]);
roda([wrangler, "d1", "migrations", "apply", "matrimoney-db", "--local", "--persist-to", estadoPronto]);
roda([wrangler, "d1", "migrations", "apply", "matrimoney-db", "--local", "--persist-to", estadoConfiguracao]);

const processos = [
  spawn(process.execPath, [join(raiz, "scripts", "dev", "anthropic-stub.mjs")], {
    cwd: raiz,
    stdio: "inherit",
    env: ambiente,
  }),
  sobeWrangler(portas.instalacaoPronta, portas.inspecaoInstalacaoPronta, estadoPronto),
  sobeWrangler(portas.configuracao, portas.inspecaoConfiguracao, estadoConfiguracao, ["SETUP_SEM_CACHE:1"]),
];

function encerraTudo(sinal) {
  for (const processo of processos) processo.kill(sinal);
}

for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, () => {
    encerraTudo(sinal);
    process.exit(0);
  });
}

// Se um processo cai, os outros saem junto: o Playwright vê a falha em vez de testes pendurados.
for (const processo of processos) {
  processo.on("exit", (codigo) => {
    encerraTudo("SIGTERM");
    process.exit(codigo ?? 0);
  });
}
