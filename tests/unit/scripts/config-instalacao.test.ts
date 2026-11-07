import { parse } from "jsonc-parser";
import { describe, expect, it } from "vitest";
import { CABECALHO_DA_CONFIG, geraConfigDaInstalacao } from "../../../scripts/lib/config-instalacao";
import { ErroDeUso } from "../../../scripts/lib/marca";

// Um wrangler.jsonc de app, com o que a instalação não pode perder: crons, assets, flags, comentário e migrations_dir.
const WRANGLER_DO_APP = `{
  // Comentário que explica o assets: não pode sumir na configuração gerada.
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "matrimoney",
  "main": "src/worker.ts",
  "compatibility_date": "2026-10-15",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist/client",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "matrimoney-db",
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "node_modules/@confinancas/core-money/migrations"
    }
  ],
  "triggers": {
    "crons": ["0 3 * * *", "*/30 * * * *"]
  },
  "observability": { "enabled": true }
}
`;

const DADOS = {
  nome: "matrimoney-teste",
  bancoNome: "matrimoney-teste-db",
  bancoId: "11111111-2222-3333-4444-555555555555",
};

describe("geraConfigDaInstalacao", () => {
  it("troca o name e o banco DB, e grava o cabeçalho que avisa para não editar", () => {
    const gerada = geraConfigDaInstalacao(WRANGLER_DO_APP, DADOS);
    const lida = parse(gerada);

    expect(gerada.startsWith(CABECALHO_DA_CONFIG)).toBe(true);
    expect(lida.name).toBe("matrimoney-teste");
    expect(lida.d1_databases[0].database_name).toBe("matrimoney-teste-db");
    expect(lida.d1_databases[0].database_id).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("preserva crons, assets, flags, observability e migrations_dir", () => {
    const lida = parse(geraConfigDaInstalacao(WRANGLER_DO_APP, DADOS));

    expect(lida.triggers.crons).toEqual(["0 3 * * *", "*/30 * * * *"]);
    expect(lida.assets).toEqual({
      directory: "./dist/client",
      not_found_handling: "single-page-application",
      run_worker_first: ["/api/*"],
    });
    expect(lida.compatibility_flags).toEqual(["nodejs_compat"]);
    expect(lida.observability).toEqual({ enabled: true });
    expect(lida.d1_databases[0].migrations_dir).toBe("node_modules/@confinancas/core-money/migrations");
    expect(lida.main).toBe("src/worker.ts");
  });

  it("mantém os comentários do arquivo original", () => {
    const gerada = geraConfigDaInstalacao(WRANGLER_DO_APP, DADOS);

    expect(gerada).toContain("// Comentário que explica o assets: não pode sumir na configuração gerada.");
  });

  it("sem o binding DB, recusa com uma mensagem de uso", () => {
    const semBanco = WRANGLER_DO_APP.replace('"binding": "DB"', '"binding": "OUTRO"');

    expect(() => geraConfigDaInstalacao(semBanco, DADOS)).toThrow(ErroDeUso);
  });
});
