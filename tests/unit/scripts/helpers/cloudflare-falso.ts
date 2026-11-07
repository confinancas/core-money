import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpcoesInstalar } from "../../../../scripts/instalar";
import type { Terminal } from "../../../../scripts/lib/terminal";
import type { ResultadoExecucao } from "../../../../scripts/lib/wrangler";
import { criaWrangler, type Execucao } from "../../../../scripts/lib/wrangler";

// Runner falso da Cloudflare (TASK-0101): simula o estado (bancos, segredos, convites, membros) e responde aos
// comandos do wrangler. Só entende os SQLs que os scripts montam: qualquer outro vira erro no teste.
// Nada aqui fala com a rede. Dados fictícios: [TEST], example.com, subdomínio de teste.

export const MARCA_DE_TESTE = {
  id: "marca-teste",
  name: "[TEST] Marca de teste",
  workerName: "matrimoney-teste",
};
export const NOME_DO_BANCO = "matrimoney-teste-db";
export const URL_DO_WORKER = "https://matrimoney-teste.subdominio-de-teste.workers.dev";
export const CONTA_DE_TESTE = { id: "0123456789abcdef0123456789abcdef", nome: "[TEST] Conta de teste" };
export const CODIGO_FIXO = "ABCD-EFGH-JKMN";
export const CHAVE_MESTRA_FIXA = "k7Qp2ZsLr9Xv4WcT1nYbH8mJd3Fg6Uo0AeRi5PqNs7M=";
export const INSTANTE_FIXO = "2026-11-07T12:00:00.000Z";
export const WRANGLER_DO_APP = `{
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
    "crons": ["0 3 * * *"]
  },
  "observability": { "enabled": true }
}
`;

export type Linhas = Record<string, unknown>[];

export type Invite = {
  id: string;
  household_id: string | null;
  kind: string;
  token_hash: string;
  member_id: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  used_at: string | null;
  cancelled_at: string | null;
};

export type Membro = { id: string; household_id: string; name: string; role: string; created_at: string };

export type Chamada = { args: string[]; entrada?: string };

export type EstadoFalso = {
  autenticado: boolean;
  contas: { id: string; nome: string }[];
  bancos: { nome: string; uuid: string }[];
  segredos: Map<string, string>;
  subdominioRegistrado: boolean;
  urlDoDeploy: string;
  falhaAoGravarSegredo: boolean;
  // database_name do wrangler.jsonc versionado do app. Um d1 execute sem --config com esse nome cai no id-marcador
  // 00000000-…, como acontece de verdade numa instalação normal.
  nomeDoBancoNoWranglerJsonc: string;
  falhaAoInserirConvite: boolean;
  migracoesAplicadas: number;
  convites: Invite[];
  membros: Membro[];
  chamadas: Chamada[];
};

export function estadoInicial(parcial: Partial<EstadoFalso> = {}): EstadoFalso {
  return {
    autenticado: true,
    contas: [CONTA_DE_TESTE],
    bancos: [],
    segredos: new Map(),
    subdominioRegistrado: true,
    urlDoDeploy: URL_DO_WORKER,
    falhaAoGravarSegredo: false,
    nomeDoBancoNoWranglerJsonc: "matrimoney-db",
    falhaAoInserirConvite: false,
    migracoesAplicadas: 0,
    convites: [],
    membros: [],
    chamadas: [],
    ...parcial,
  };
}

const DEPLOY_SEM_SUBDOMINIO = [
  "Uploaded matrimoney-teste (2.10 sec)",
  "▲ [WARNING] You need to register a workers.dev subdomain before publishing to workers.dev",
  "Would you like to register a workers.dev subdomain now? (y/n)",
  "🤖 Using fallback value in non-interactive context: no",
  "X [ERROR] You need to register a workers.dev subdomain before publishing to workers.dev",
].join("\n");

function resposta(codigo: number, stdout = "", stderr = ""): ResultadoExecucao {
  return { codigo, stdout, stderr };
}

const RE_CONTA_PRIMEIROS_USADOS =
  /^SELECT COUNT\(\*\) AS n FROM invites WHERE kind='primeiro_acesso' AND used_at IS NOT NULL$/;
const RE_CANCELA_PRIMEIROS =
  /^UPDATE invites SET cancelled_at = '([^']+)' WHERE kind='primeiro_acesso' AND used_at IS NULL AND cancelled_at IS NULL$/;
const RE_INSERE_PRIMEIRO =
  /^INSERT INTO invites \(id, household_id, kind, token_hash, created_at\) VALUES \('([^']+)', NULL, 'primeiro_acesso', '([^']+)', '([^']+)'\)$/;
const RE_CANCELA_RECUPERACOES =
  /^UPDATE invites SET cancelled_at = '([^']+)' WHERE kind='recuperacao' AND member_id='([^']+)' AND used_at IS NULL AND cancelled_at IS NULL$/;
const RE_INSERE_RECUPERACAO =
  /^INSERT INTO invites \(id, household_id, kind, token_hash, member_id, created_by, created_at, expires_at\) VALUES \('([^']+)', '([^']+)', 'recuperacao', '([^']+)', '([^']+)', NULL, '([^']+)', '([^']+)'\)$/;
const SQL_LISTA_MEMBROS = "SELECT id, household_id, name, role FROM members ORDER BY created_at";

function executaSqlFalso(estado: EstadoFalso, sql: string): ResultadoExecucao {
  const json = (linhas: Linhas) => resposta(0, JSON.stringify([{ results: linhas, success: true }]));
  if (estado.falhaAoInserirConvite && sql.startsWith("INSERT INTO invites")) {
    return resposta(1, "", "erro simulado ao gravar o convite no banco");
  }
  if (RE_CONTA_PRIMEIROS_USADOS.test(sql)) {
    const n = estado.convites.filter((c) => c.kind === "primeiro_acesso" && c.used_at !== null).length;
    return json([{ n }]);
  }
  const cancelaPrimeiros = RE_CANCELA_PRIMEIROS.exec(sql);
  if (cancelaPrimeiros) {
    for (const convite of estado.convites) {
      if (convite.kind === "primeiro_acesso" && convite.used_at === null && convite.cancelled_at === null) {
        convite.cancelled_at = cancelaPrimeiros[1];
      }
    }
    return json([]);
  }
  const inserePrimeiro = RE_INSERE_PRIMEIRO.exec(sql);
  if (inserePrimeiro) {
    estado.convites.push({
      id: inserePrimeiro[1],
      household_id: null,
      kind: "primeiro_acesso",
      token_hash: inserePrimeiro[2],
      member_id: null,
      created_by: null,
      created_at: inserePrimeiro[3],
      expires_at: null,
      used_at: null,
      cancelled_at: null,
    });
    return json([]);
  }
  if (sql === SQL_LISTA_MEMBROS) {
    const ordenados = [...estado.membros].sort((a, b) => a.created_at.localeCompare(b.created_at));
    return json(
      ordenados.map((m) => ({ id: m.id, household_id: m.household_id, name: m.name, role: m.role })),
    );
  }
  const cancelaRecuperacoes = RE_CANCELA_RECUPERACOES.exec(sql);
  if (cancelaRecuperacoes) {
    for (const convite of estado.convites) {
      if (convite.kind === "recuperacao" && convite.member_id === cancelaRecuperacoes[2]) {
        if (convite.used_at === null && convite.cancelled_at === null)
          convite.cancelled_at = cancelaRecuperacoes[1];
      }
    }
    return json([]);
  }
  const insereRecuperacao = RE_INSERE_RECUPERACAO.exec(sql);
  if (insereRecuperacao) {
    estado.convites.push({
      id: insereRecuperacao[1],
      household_id: insereRecuperacao[2],
      kind: "recuperacao",
      token_hash: insereRecuperacao[3],
      member_id: insereRecuperacao[4],
      created_by: null,
      created_at: insereRecuperacao[5],
      expires_at: insereRecuperacao[6],
      used_at: null,
      cancelled_at: null,
    });
    return json([]);
  }
  return resposta(1, "", `SQL não previsto no runner falso: ${sql}`);
}

// Runner falso do wrangler, ligado ao estado. Cada chamada fica registrada em estado.chamadas.
export function criaCloudflareFalso(estado: EstadoFalso): Execucao {
  return async (args, opcoes) => {
    estado.chamadas.push({ args: [...args], entrada: opcoes?.entrada });
    const [primeiro, segundo] = args;
    if (primeiro === "whoami") {
      if (!estado.autenticado) return resposta(1, "", '{"loggedIn":false}');
      // O wrangler devolve cada conta como { id, name }.
      const accounts = estado.contas.map((conta) => ({ id: conta.id, name: conta.nome }));
      return resposta(0, JSON.stringify({ loggedIn: true, authType: "Account API Token", accounts }));
    }
    if (primeiro === "d1" && segundo === "list") {
      return resposta(
        0,
        JSON.stringify(
          estado.bancos.map((b) => ({ uuid: b.uuid, name: b.nome })),
          null,
          2,
        ),
      );
    }
    if (primeiro === "d1" && segundo === "create") {
      estado.bancos.push({ nome: args[2], uuid: "11111111-2222-3333-4444-555555555555" });
      return resposta(0, "Successfully created DB");
    }
    if (primeiro === "d1" && segundo === "migrations") {
      estado.migracoesAplicadas += 1;
      return resposta(0, "Migrations applied");
    }
    if (primeiro === "d1" && segundo === "execute") {
      // Sem --config, o wrangler resolve o banco pelo wrangler.jsonc versionado e cai no id-marcador (defeito real).
      if (!args.includes("--config") && args[2] === estado.nomeDoBancoNoWranglerJsonc) {
        return resposta(
          1,
          "",
          "A database with the id 00000000-0000-0000-0000-000000000000 was not found (código de erro 7400)",
        );
      }
      return executaSqlFalso(estado, args[args.indexOf("--command") + 1]);
    }
    if (primeiro === "deploy") {
      if (!estado.subdominioRegistrado) return resposta(1, "", DEPLOY_SEM_SUBDOMINIO);
      return resposta(0, `Deployed matrimoney-teste triggers\n  ${estado.urlDoDeploy}\n`);
    }
    if (primeiro === "secret" && segundo === "list") {
      return resposta(
        0,
        JSON.stringify([...estado.segredos.keys()].map((name) => ({ name, type: "secret_text" }))),
      );
    }
    if (primeiro === "secret" && segundo === "put") {
      if (estado.falhaAoGravarSegredo) {
        // Erro hostil: o wrangler ecoa o valor. O script não pode imprimir isso.
        return resposta(1, "", `não consegui gravar ${opcoes?.entrada ?? ""}`);
      }
      estado.segredos.set(args[2], opcoes?.entrada ?? "");
      return resposta(0, "Success! Uploaded secret");
    }
    return resposta(1, "", `comando não previsto no runner falso: ${args.join(" ")}`);
  };
}

// Terminal falso: registra cada linha escrita e responde às perguntas na ordem em que foram dadas.
export function criaTerminalFalso(respostas: string[] = []) {
  const linhas: string[] = [];
  const perguntas: string[] = [];
  const fila = [...respostas];
  const terminal: Terminal = {
    escreve(linha) {
      linhas.push(linha);
    },
    async pergunta(texto) {
      perguntas.push(texto);
      if (fila.length === 0) throw new Error(`pergunta sem resposta preparada: ${texto}`);
      return fila.shift() as string;
    },
  };
  return { terminal, linhas, perguntas };
}

export function criaPastaDoApp(): string {
  const pasta = mkdtempSync(join(tmpdir(), "core-money-instalar-"));
  writeFileSync(join(pasta, "marca.json"), `${JSON.stringify(MARCA_DE_TESTE, null, 2)}\n`);
  writeFileSync(
    join(pasta, "package.json"),
    `${JSON.stringify({ name: "app-de-teste", version: "9.9.9" }, null, 2)}\n`,
  );
  writeFileSync(join(pasta, "wrangler.jsonc"), WRANGLER_DO_APP);
  return pasta;
}

export function removePastaDoApp(pasta: string): void {
  rmSync(pasta, { recursive: true, force: true });
}

export function leArquivo(pasta: string, relativo: string): string {
  return readFileSync(join(pasta, relativo), "utf8");
}

export type OpcoesDeTeste = {
  pastaApp: string;
  estado: EstadoFalso;
  terminal: Terminal;
  argumentos?: string[];
  versaoDoNode?: string;
  npmCodigo?: number;
  npmChamadas?: { args: string[]; cwd: string }[];
  geradorDeId?: () => string;
};

// Contador do módulo: duas rodadas no mesmo teste não podem gerar o mesmo id de convite.
let contadorDeId = 0;

export function opcoesDeInstalacao(teste: OpcoesDeTeste): OpcoesInstalar {
  const npmChamadas = teste.npmChamadas ?? [];
  return {
    argumentos: teste.argumentos ?? [],
    pastaApp: teste.pastaApp,
    wrangler: criaWrangler(criaCloudflareFalso(teste.estado)),
    definirConta: () => {},
    npm: async (args, cwd) => {
      npmChamadas.push({ args, cwd });
      return { codigo: teste.npmCodigo ?? 0, saida: "build simulado" };
    },
    terminal: teste.terminal,
    versaoDoNode: teste.versaoDoNode ?? "22.12.0",
    agora: () => new Date(INSTANTE_FIXO),
    gerarCodigo: () => CODIGO_FIXO,
    gerarId:
      teste.geradorDeId ??
      (() => {
        contadorDeId += 1;
        return `00000000-0000-4000-8000-${String(contadorDeId).padStart(12, "0")}`;
      }),
    gerarChave: () => CHAVE_MESTRA_FIXA,
  };
}
