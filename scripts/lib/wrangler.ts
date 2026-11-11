import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Roda o wrangler e interpreta a saída (TASK-0101). Sem shell: o caminho do wrangler sai do pacote instalado,
// porque numa pasta de app o núcleo e o wrangler ficam em node_modules. A entrada (o segredo) vai só pelo stdin.

export type ResultadoExecucao = { codigo: number; stdout: string; stderr: string };

export type Execucao = (args: string[], opcoes?: { entrada?: string }) => Promise<ResultadoExecucao>;

export type ContaCloudflare = { id: string; nome: string };
export type Autenticacao = { autenticada: false } | { autenticada: true; contas: ContaCloudflare[] };
export type BancoD1 = { nome: string; uuid: string };
export type Linha = Record<string, unknown>;

// Falha de um comando do wrangler, já pronta para o terminal (sem o stdin e sem o valor dos segredos).
export class ErroDoWrangler extends Error {}

// O deploy falhou porque a conta não tem subdomínio workers.dev (cenário 2 da TASK-0101).
export class ErroDeSubdominio extends Error {}

export const REGIAO_DO_BANCO = "enam";

export function caminhoDoWrangler(): string {
  const requerer = createRequire(import.meta.url);
  return join(dirname(requerer.resolve("wrangler/package.json")), "bin", "wrangler.js");
}

// Ambiente extra do processo do wrangler. A conta escolhida entra aqui, e o wrangler a usa no lugar do .env.
export type AmbienteDoWrangler = Record<string, string>;

export function execucaoReal(pastaApp: string, ambiente: AmbienteDoWrangler): Execucao {
  const wranglerJs = caminhoDoWrangler();
  return (args, opcoes = {}) =>
    new Promise((resolver, rejeitar) => {
      const filho = spawn(process.execPath, [wranglerJs, ...args], {
        cwd: pastaApp,
        env: { ...process.env, ...ambiente, CI: "true", WRANGLER_SEND_METRICS: "false" },
        shell: false,
        windowsHide: true,
        stdio: [opcoes.entrada === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      filho.stdout?.on("data", (pedaco) => {
        stdout += pedaco;
      });
      filho.stderr?.on("data", (pedaco) => {
        stderr += pedaco;
      });
      filho.on("error", rejeitar);
      filho.on("close", (codigo) => resolver({ codigo: codigo ?? 1, stdout, stderr }));
      if (opcoes.entrada !== undefined) {
        // Se o wrangler fechar o stdin antes de a entrada chegar (EPIPE), o erro sai pelo código de saída, sem stack trace.
        filho.stdin?.on("error", () => {});
        filho.stdin?.end(opcoes.entrada);
      }
    });
}

// Troca cada valor secreto por um marcador. Usado em tudo que pode ir para o terminal.
export function mascara(texto: string, segredos: string[]): string {
  let saida = texto;
  for (const segredo of segredos) {
    if (segredo !== "") saida = saida.split(segredo).join("<valor-mascarado>");
  }
  return saida;
}

function tentaExtraiJson(texto: string): unknown {
  const aparado = texto.trim();
  const abre = aparado.search(/[[{]/);
  const fecha = Math.max(aparado.lastIndexOf("]"), aparado.lastIndexOf("}"));
  if (abre < 0 || fecha < abre) return undefined;
  try {
    return JSON.parse(aparado.slice(abre, fecha + 1));
  } catch {
    return undefined;
  }
}

function extraiJson(texto: string, rotulo: string): unknown {
  const json = tentaExtraiJson(texto);
  if (json === undefined) throw new ErroDoWrangler(`${rotulo}: a saída do wrangler não trouxe JSON.`);
  return json;
}

const texto = (valor: unknown): string | undefined => (typeof valor === "string" ? valor : undefined);

// `wrangler whoami --json`: com token ou login, traz as contas; sem autenticação, traz loggedIn false.
export function interpretaWhoami(stdout: string, stderr: string): Autenticacao {
  for (const pedaco of [stdout, stderr]) {
    const json = tentaExtraiJson(pedaco);
    if (json && typeof json === "object" && "loggedIn" in json) {
      const registro = json as { loggedIn: unknown; accounts?: unknown };
      if (registro.loggedIn === false) return { autenticada: false };
      if (registro.loggedIn === true && Array.isArray(registro.accounts)) {
        const contas: ContaCloudflare[] = [];
        for (const conta of registro.accounts as unknown[]) {
          const id = texto((conta as { id?: unknown })?.id);
          const nome = texto((conta as { name?: unknown })?.name);
          if (id && nome) contas.push({ id, nome });
        }
        return { autenticada: true, contas };
      }
    }
  }
  throw new ErroDoWrangler(
    "wrangler whoami não devolveu a conta. Rode npx wrangler whoami para ver o que acontece.",
  );
}

// `wrangler d1 list --json`: uma lista de bancos, cada um com name e uuid.
export function interpretaD1List(stdout: string): BancoD1[] {
  const json = extraiJson(stdout, "wrangler d1 list");
  if (!Array.isArray(json)) throw new ErroDoWrangler("wrangler d1 list: a saída não é uma lista.");
  const bancos: BancoD1[] = [];
  for (const banco of json as unknown[]) {
    const nome = texto((banco as { name?: unknown })?.name);
    const uuid = texto((banco as { uuid?: unknown })?.uuid);
    if (nome && uuid) bancos.push({ nome, uuid });
  }
  return bancos;
}

// `wrangler d1 execute --json`: devolve [{ results, success, meta }]. As linhas são o results do primeiro comando.
export function interpretaD1Execute(stdout: string): Linha[] {
  const json = extraiJson(stdout, "wrangler d1 execute");
  const primeiro = Array.isArray(json) ? (json[0] as { results?: unknown } | undefined) : undefined;
  if (!primeiro || !Array.isArray(primeiro.results)) {
    throw new ErroDoWrangler("wrangler d1 execute: a saída não trouxe as linhas.");
  }
  return primeiro.results as Linha[];
}

// `wrangler secret list --format json`: uma lista de { name, type }.
export function interpretaSecretList(stdout: string): string[] {
  const json = extraiJson(stdout, "wrangler secret list");
  if (!Array.isArray(json)) throw new ErroDoWrangler("wrangler secret list: a saída não é uma lista.");
  return (json as unknown[]).flatMap((segredo) => {
    const nome = texto((segredo as { name?: unknown })?.name);
    return nome ? [nome] : [];
  });
}

// URL do Worker na saída do deploy. Se houver URL de versão, fica a que começa pelo nome do Worker.
export function extraiUrlDoDeploy(saida: string, nome: string): string | undefined {
  const urls = saida.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/g) ?? [];
  return urls.find((url) => url.startsWith(`https://${nome}.`)) ?? urls[0];
}

// Conta sem subdomínio workers.dev: o deploy recusa com essa frase (no modo não interativo, a pergunta cai no não).
export function ehErroDeSubdominio(saida: string): boolean {
  return /workers\.dev subdomain/i.test(saida);
}

function falhaDoComando(
  rotulo: string,
  resultado: ResultadoExecucao,
  segredos: string[] = [],
): ErroDoWrangler {
  const saida = [resultado.stdout, resultado.stderr].filter((pedaco) => pedaco.trim() !== "").join("\n");
  const limpa = mascara(saida.trim(), segredos);
  return new ErroDoWrangler(
    `wrangler ${rotulo} falhou (código ${resultado.codigo}).${limpa ? `\n${limpa}` : ""}`,
  );
}

export type Wrangler = {
  whoami(): Promise<Autenticacao>;
  listaBancosD1(): Promise<BancoD1[]>;
  criaBancoD1(nome: string): Promise<void>;
  executaSql(banco: string, sql: string, config?: string): Promise<Linha[]>;
  aplicaMigracoes(banco: string, config: string): Promise<void>;
  criaFilaSeNaoExiste(nome: string): Promise<void>;
  deploy(config: string, nome: string): Promise<string>;
  listaSegredos(config: string): Promise<string[]>;
  gravaSegredo(nome: string, valor: string, config: string): Promise<void>;
};

export function criaWrangler(execucao: Execucao): Wrangler {
  return {
    async whoami() {
      const resultado = await execucao(["whoami", "--json"]);
      return interpretaWhoami(resultado.stdout, resultado.stderr);
    },

    async listaBancosD1() {
      const resultado = await execucao(["d1", "list", "--json"]);
      if (resultado.codigo !== 0) throw falhaDoComando("d1 list", resultado);
      return interpretaD1List(resultado.stdout);
    },

    async criaBancoD1(nome) {
      const resultado = await execucao(["d1", "create", nome, "--location", REGIAO_DO_BANCO]);
      if (resultado.codigo !== 0) throw falhaDoComando("d1 create", resultado);
    },

    async executaSql(banco, sql, config) {
      const extra = config === undefined ? [] : ["--config", config];
      const resultado = await execucao([
        "d1",
        "execute",
        banco,
        "--remote",
        "--json",
        "--command",
        sql,
        ...extra,
      ]);
      if (resultado.codigo !== 0) throw falhaDoComando("d1 execute", resultado);
      return interpretaD1Execute(resultado.stdout);
    },

    async aplicaMigracoes(banco, config) {
      const resultado = await execucao(["d1", "migrations", "apply", banco, "--remote", "--config", config]);
      if (resultado.codigo !== 0) throw falhaDoComando("d1 migrations apply", resultado);
    },

    // A fila da importação (TASK-0204): cria se não existe. Antes do deploy, porque o Worker a liga como consumidor.
    // `queues info` sai com código zero só quando a fila existe (o wrangler 4 não tem `queues list --json`). Se a
    // criação responde que a fila já existe, é sucesso: o instalador roda de novo sem erro.
    async criaFilaSeNaoExiste(nome) {
      const info = await execucao(["queues", "info", nome]);
      if (info.codigo === 0) return;
      const criada = await execucao(["queues", "create", nome]);
      if (criada.codigo === 0) return;
      if (/already exists|já existe/i.test(`${criada.stdout}\n${criada.stderr}`)) return;
      throw falhaDoComando("queues create", criada);
    },

    async deploy(config, nome) {
      const resultado = await execucao(["deploy", "--config", config]);
      const saida = `${resultado.stdout}\n${resultado.stderr}`;
      if (resultado.codigo !== 0) {
        if (ehErroDeSubdominio(saida)) throw new ErroDeSubdominio("A conta não tem subdomínio workers.dev.");
        throw falhaDoComando("deploy", resultado);
      }
      const url = extraiUrlDoDeploy(saida, nome);
      if (!url) throw new ErroDoWrangler("wrangler deploy: não achei a URL do Worker na saída.");
      return url;
    },

    async listaSegredos(config) {
      const resultado = await execucao(["secret", "list", "--format", "json", "--config", config]);
      if (resultado.codigo !== 0) throw falhaDoComando("secret list", resultado);
      return interpretaSecretList(resultado.stdout);
    },

    // O valor vai só pelo stdin. Se o comando falhar, a saída é impressa com o valor mascarado.
    async gravaSegredo(nome, valor, config) {
      const resultado = await execucao(["secret", "put", nome, "--config", config], { entrada: valor });
      if (resultado.codigo !== 0) throw falhaDoComando("secret put", resultado, [valor]);
    },
  };
}
