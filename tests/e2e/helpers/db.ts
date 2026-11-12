import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { portasDoE2E } from "../../../scripts/dev/e2e-portas.mjs";

// Roda SQL no D1 local de uma das duas instâncias do E2E (scripts/dev/e2e-server.mjs), pelo wrangler, sem shell.
// Só dados de teste: as tabelas de configuração e de chaves; nunca dado financeiro.
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const wranglerJs = join(raiz, "node_modules", "wrangler", "bin", "wrangler.js");

// As portas vêm do bloco de MM_E2E_PORTA_BASE (scripts/dev/e2e-portas.mjs). Os nomes são os de sempre: as specs usam.
const PORTAS = portasDoE2E(process.env.MM_E2E_PORTA_BASE);
export const PORTA_DA_INSTALACAO_PRONTA = PORTAS.instalacaoPronta;
export const PORTA_DA_CONFIGURACAO = PORTAS.configuracao;

const ESTADO = {
  pronta: join(raiz, ".wrangler", "e2e-state"),
  configuracao: join(raiz, ".wrangler", "e2e-state-configuracao"),
} as const;

export type Instancia = keyof typeof ESTADO;

// O D1 local é um arquivo SQLite. Uma importação em segundo plano de outra spec pode estar escrevendo nele quando o
// comando chega: o SQLite responde "database is locked" (SQLITE_BUSY). Esse erro repete o comando, com pausa crescente
// e poucas tentativas (TASK-0204, R12). Qualquer outro erro sai na hora.
const PAUSAS_DO_BUSY_MS = [250, 500, 1000, 2000, 4000];

function ehBusy(saida: string): boolean {
  return /database is locked|SQLITE_BUSY/i.test(saida);
}

// Pausa síncrona (o helper é síncrono, como o spawnSync que ele chama).
function pausa(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function rodaWrangler(instancia: Instancia, argumentos: string[]): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    [
      wranglerJs,
      "d1",
      "execute",
      "matrimoney-db",
      "--local",
      "--persist-to",
      ESTADO[instancia],
      ...argumentos,
    ],
    { cwd: raiz, encoding: "utf8", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
  );
}

// Roda o comando e devolve a saída. Repete só quando o banco está travado, até o fim das pausas.
function executaComRepeticao(instancia: Instancia, argumentos: string[]): string {
  for (let tentativa = 0; ; tentativa += 1) {
    const resultado = rodaWrangler(instancia, argumentos);
    if (resultado.status === 0) return resultado.stdout;
    const pausaDeste = PAUSAS_DO_BUSY_MS[tentativa];
    if (!ehBusy(`${resultado.stderr}\n${resultado.stdout}`) || pausaDeste === undefined) {
      throw new Error(`wrangler d1 execute falhou (${instancia}): ${resultado.stderr || resultado.stdout}`);
    }
    pausa(pausaDeste);
  }
}

export function executaSql(instancia: Instancia, sql: string): void {
  executaComRepeticao(instancia, ["--command", sql]);
}

// Lê linhas de uma instância do E2E (só para conferir o banco de teste nos testes). Saída JSON do wrangler.
export function consultaSql(instancia: Instancia, sql: string): Record<string, unknown>[] {
  const texto = executaComRepeticao(instancia, ["--command", sql, "--json"]);
  const blocos = JSON.parse(texto.slice(texto.indexOf("["), texto.lastIndexOf("]") + 1)) as {
    results: Record<string, unknown>[];
  }[];
  return blocos[0]?.results ?? [];
}
