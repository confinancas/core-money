import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Roda SQL no D1 local de uma das duas instâncias do E2E (scripts/dev/e2e-server.mjs), pelo wrangler, sem shell.
// Só dados de teste: as tabelas de configuração e de chaves; nunca dado financeiro.
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const wranglerJs = join(raiz, "node_modules", "wrangler", "bin", "wrangler.js");

export const PORTA_DA_INSTALACAO_PRONTA = 8788;
export const PORTA_DA_CONFIGURACAO = 8790;

const ESTADO = {
  pronta: join(raiz, ".wrangler", "e2e-state"),
  configuracao: join(raiz, ".wrangler", "e2e-state-configuracao"),
} as const;

export type Instancia = keyof typeof ESTADO;

export function executaSql(instancia: Instancia, sql: string): void {
  const resultado = spawnSync(
    process.execPath,
    [
      wranglerJs,
      "d1",
      "execute",
      "matrimoney-db",
      "--local",
      "--persist-to",
      ESTADO[instancia],
      "--command",
      sql,
    ],
    { cwd: raiz, encoding: "utf8", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
  );
  if (resultado.status !== 0) {
    throw new Error(`wrangler d1 execute falhou (${instancia}): ${resultado.stderr || resultado.stdout}`);
  }
}

// Lê linhas de uma instância do E2E (só para conferir o banco de teste nos testes). Saída JSON do wrangler.
export function consultaSql(instancia: Instancia, sql: string): Record<string, unknown>[] {
  const resultado = spawnSync(
    process.execPath,
    [
      wranglerJs,
      "d1",
      "execute",
      "matrimoney-db",
      "--local",
      "--persist-to",
      ESTADO[instancia],
      "--command",
      sql,
      "--json",
    ],
    { cwd: raiz, encoding: "utf8", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
  );
  if (resultado.status !== 0) {
    throw new Error(`wrangler d1 execute falhou (${instancia}): ${resultado.stderr || resultado.stdout}`);
  }
  const texto = resultado.stdout;
  const blocos = JSON.parse(texto.slice(texto.indexOf("["), texto.lastIndexOf("]") + 1)) as {
    results: Record<string, unknown>[];
  }[];
  return blocos[0]?.results ?? [];
}
