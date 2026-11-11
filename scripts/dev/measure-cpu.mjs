#!/usr/bin/env node
// Mede a CPU das rotas no Worker de dev compartilhado (matrimoney-dev), só para medir: sem cron e só dados [TEST].
// Uso: npm run cpu -- tests/cpu/TASK-NNXX.json
// A URL do Worker e os valores do .env nunca vão para arquivo nem para a saída: qualquer texto impresso passa por mascara().
// A entrada do deploy é scripts/dev/cpu-worker.ts (o Worker do app mais as rotas de medição, TASK-0104).
// Campos do arquivo de medição (além de task e requests):
//   setupSql: comandos SQL, um por vez, depois do deploy. esvaziarBanco: esvazia todas as tabelas antes (filhos antes).
//   sessao: cria uma sessão [TEST] com token aleatório; as rotas com "headers": { "cookie": "{sessao}" } a usam.
//   passkeyDeLogin: o fluxo "login" usa uma passkey [TEST] gerada nesta execução (a chave nunca vai para arquivo).
//   requests[].corpos: lista de corpos, usada um a um por rodada (ex.: alternar uma categoria para forçar a escrita).
//   {i} na rota ou no corpo vira o número da rodada (1 a 12). Uma rota com {i} casa com qualquer número no lugar.
//   requests[].via: rota só medida por um fluxo de navegador (flows), não por requisição direta.
// Lar (TASK-0010): o lar é gravado uma vez e reaproveitado nas rodadas seguintes, se a impressão digital do banco (tabela
// _medicao_cpu, fora das migrações) for igual à do arquivo e todas as requisições forem GET, sem fluxo de navegador. Os
// outros casos apagam e gravam, como antes. A sessão de teste é renovada em toda rodada.
// Evento perdido (TASK-0010): a rota que faltou no tail é medida de novo, uma vez, com o mesmo deploy e o mesmo tail.
import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as lerJsonc } from "jsonc-parser";
import {
  AQUECIMENTO,
  avaliaResultados,
  escolheLar,
  impressaoDoLar,
  LIMITE_MS,
  MEDIDAS,
  mediaTail,
  ordemDeEsvaziamento,
  rotasParaRemedir,
  sohLeitura,
  TABELA_DA_MEDICAO,
} from "./cpu-medicao.mjs";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pastaDasTravas = resolve(raiz, "..", ".locks");
const caminhoDaTrava = join(pastaDasTravas, "cloudflare-dev.lock");
const WORKER = "matrimoney-dev";
const BANCO = "matrimoney-dev-db";
const CHAVE_DO_LAR = "lar";
const ESPERA_ANTES_DAS_REQUISICOES_MS = 5000;
const ESPERA_DEPOIS_DAS_REQUISICOES_MS = 10000;
// 1,5 s entre requisições: em rajada o tail do Cloudflare perde eventos (medido na TASK-0003: 13 de 24 perdidos).
const INTERVALO_ENTRE_REQUISICOES_MS = 1500;
const wranglerJs = join(raiz, "node_modules", "wrangler", "bin", "wrangler.js");
const viteJs = join(raiz, "node_modules", "vite", "bin", "vite.js");
const ENTRADA_DE_MEDICAO = join(raiz, "scripts", "dev", "cpu-worker.ts");

const valoresSecretos = [];
let travaCriada = false;
let tailFilho = null;

class Falha extends Error {}
const falha = (mensagem) => {
  throw new Falha(mensagem);
};

function mascara(texto) {
  let saida = String(texto).replace(/https:\/\/[^\s"'<>]*\.workers\.dev/g, "<url-mascarada>");
  for (const valor of valoresSecretos) saida = saida.split(valor).join("<valor-mascarado>");
  return saida;
}

function lerEnv() {
  const ausente = () => falha("Copie o .env da pasta principal para o worktree.");
  const caminho = join(raiz, ".env");
  if (!existsSync(caminho)) ausente();
  const valores = {};
  for (const linha of readFileSync(caminho, "utf8").split(/\r?\n/)) {
    const casa = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linha);
    if (casa) valores[casa[1]] = casa[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  const necessarias = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "MM_DEV_D1_ID", "MM_DEV_MASTER_KEY"];
  if (necessarias.some((chave) => !valores[chave])) ausente();
  for (const chave of necessarias) valoresSecretos.push(valores[chave]);
  return valores;
}

// Ambiente só do processo filho: o token do .env vale aqui e não muda o login da máquina.
function ambienteDoWrangler(env) {
  return {
    ...process.env,
    CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
    WRANGLER_SEND_METRICS: "false",
  };
}

// Igual ao executa, mas a entrada vai pelo stdin: o valor de um segredo nunca entra em argumento.
function executaComEntrada(args, ambiente, entrada) {
  return new Promise((resolver, rejeitar) => {
    const filho = spawn(process.execPath, args, {
      cwd: raiz,
      env: ambiente,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let saida = "";
    filho.stdout.on("data", (pedaco) => {
      saida += pedaco;
    });
    filho.stderr.on("data", (pedaco) => {
      saida += pedaco;
    });
    filho.on("error", rejeitar);
    filho.on("close", (codigo) => resolver({ codigo, saida }));
    filho.stdin.end(entrada);
  });
}

// Nomes dos segredos do Worker, a partir da saída JSON do wrangler secret list.
function nomesDeSegredos(saida) {
  const inicio = saida.indexOf("[");
  const fim = saida.lastIndexOf("]");
  try {
    return JSON.parse(saida.slice(inicio, fim + 1)).map((segredo) => segredo.name);
  } catch {
    falha("Não consegui ler a lista de segredos do Worker de medição.");
  }
  return [];
}

function executa(args, ambiente) {
  return new Promise((resolver, rejeitar) => {
    const filho = spawn(process.execPath, args, {
      cwd: raiz,
      env: ambiente,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let saida = "";
    filho.stdout.on("data", (pedaco) => {
      saida += pedaco;
    });
    filho.stderr.on("data", (pedaco) => {
      saida += pedaco;
    });
    filho.on("error", rejeitar);
    filho.on("close", (codigo) => resolver({ codigo, saida }));
  });
}

function confereConta(env) {
  return executa([wranglerJs, "whoami"], ambienteDoWrangler(env)).then(({ codigo, saida }) => {
    if (codigo !== 0) falha(`wrangler whoami falhou; nada foi publicado.\n${mascara(saida)}`);
    if (!saida.includes(env.CLOUDFLARE_ACCOUNT_ID)) {
      falha("A conta do wrangler whoami não é a da conta do .env; nada foi publicado.");
    }
  });
}

function pegaTrava(task) {
  mkdirSync(pastaDasTravas, { recursive: true });
  let descritor;
  try {
    descritor = openSync(caminhoDaTrava, "wx");
  } catch (erro) {
    if (erro.code !== "EEXIST") throw erro;
    let quem = "(conteúdo ilegível)";
    try {
      quem = readFileSync(caminhoDaTrava, "utf8");
    } catch {
      // mantém a mensagem genérica
    }
    falha(
      `Trava ocupada (${caminhoDaTrava}):\n${mascara(quem)}\nAbortado sem deploy. Não apague a trava de outro processo; se o processo morreu, avise o Opus.`,
    );
  }
  writeFileSync(
    descritor,
    `${JSON.stringify({ task, pid: process.pid, inicio: new Date().toISOString() }, null, 2)}\n`,
  );
  closeSync(descritor);
  travaCriada = true;
}

function soltaTrava() {
  if (!travaCriada) return;
  rmSync(caminhoDaTrava, { force: true });
  travaCriada = false;
}

function geraConfigDeDev(env, pedido) {
  const base = lerJsonc(readFileSync(join(raiz, "wrangler.jsonc"), "utf8"));
  // Só o fluxo do cadastro volta a cadastro a cada rodada: só ele desliga o cache de "pronto" do portão.
  // As outras medições rodam com o cache, como em produção.
  const voltaAoCadastro = (pedido.flows ?? []).some((fluxo) => fluxo.name === "cadastro");
  const config = {
    ...base,
    name: WORKER,
    main: ENTRADA_DE_MEDICAO,
    assets: { ...base.assets, directory: join(raiz, "dist", "client") },
    d1_databases: base.d1_databases.map((banco) => ({
      ...banco,
      database_name: BANCO,
      database_id: env.MM_DEV_D1_ID,
      migrations_dir: join(raiz, "migrations"),
    })),
    ...(voltaAoCadastro ? { vars: { ...(base.vars ?? {}), SETUP_SEM_CACHE: "1" } } : {}),
  };
  delete config.triggers;
  delete config.$schema;
  const pasta = join(raiz, ".wrangler", "cpu");
  mkdirSync(pasta, { recursive: true });
  const arquivo = join(pasta, "wrangler.dev.json");
  writeFileSync(arquivo, `${JSON.stringify(config, null, 2)}\n`);
  return arquivo;
}

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// {i} em textos, listas e objetos: a rodada entra no caminho, no corpo e nos cabeçalhos.
const trocaI = (valor, i) => {
  if (typeof valor === "string") return valor.split("{i}").join(String(i));
  if (Array.isArray(valor)) return valor.map((item) => trocaI(item, i));
  if (valor !== null && typeof valor === "object") {
    return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, trocaI(item, i)]));
  }
  return valor;
};

const base64Url = (bytes) => Buffer.from(bytes).toString("base64url");

// Passkey de teste: um par de chaves P-256 gerado agora. A chave pública vai para o banco (COSE, ES256); a privada
// só vai para o navegador do fluxo de login, pela variável de ambiente. Nada disso é impresso nem gravado em arquivo.
function geraPasskeyDeTeste() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  // Mapa COSE de cinco pares (kty EC2, alg ES256, crv P-256, x, y), como o authenticator entrega.
  const cose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    x,
    Buffer.from([0x22, 0x58, 0x20]),
    y,
  ]);
  const idDaCredencial = randomBytes(16);
  const idDoUsuario = Buffer.from("cpu-membro-1", "utf8");
  valoresSecretos.push(privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"));
  return {
    idDaPasskey: base64Url(idDaCredencial),
    chavePublica: base64Url(cose),
    credentialIdBase64: idDaCredencial.toString("base64"),
    privateKeyPkcs8Base64: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    userHandleBase64: idDoUsuario.toString("base64"),
  };
}

// Sessão de teste: o token é aleatório a cada execução (nunca vai para arquivo); o banco guarda o sha256 dele.
function geraSessaoDeTeste() {
  const token = base64Url(randomBytes(32));
  valoresSecretos.push(token);
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

// Consulta ao D1 de medição (o token já está no ambiente do processo filho). Devolve as linhas do primeiro comando.
async function consultaD1(env, cfg, sql, mensagem) {
  const resultado = await executa(
    [wranglerJs, "d1", "execute", BANCO, "-c", cfg, "--remote", "--json", "--command", sql],
    ambienteDoWrangler(env),
  );
  if (resultado.codigo !== 0) falha(`${mensagem}\n${mascara(resultado.saida)}`);
  const texto = resultado.saida;
  return JSON.parse(texto.slice(texto.indexOf("["), texto.lastIndexOf("]") + 1))[0]?.results ?? [];
}

async function executaSql(env, cfg, sql, mensagem) {
  const resultado = await executa(
    [wranglerJs, "d1", "execute", BANCO, "-c", cfg, "--remote", "--command", sql],
    ambienteDoWrangler(env),
  );
  if (resultado.codigo !== 0) falha(`${mensagem}\n${mascara(resultado.saida)}`);
}

// Esvazia todas as tabelas do banco de medição, filhos antes dos pais (só dados [TEST]; o banco é de teste).
// A tabela da medição (_medicao_cpu) fica de fora: é a impressão digital do lar, e não é do app.
async function esvaziaBanco(env, cfg) {
  const tabelas = await consultaD1(
    env,
    cfg,
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
    "Leitura das tabelas falhou.",
  );
  for (const nome of ordemDeEsvaziamento(tabelas)) {
    await executaSql(env, cfg, `DELETE FROM "${nome}"`, "Esvaziamento do banco de medição falhou.");
  }
}

// Migrações do branch: só os .sql da pasta migrations (o meta do drizzle não entra).
function lerMigracoes() {
  const pasta = join(raiz, "migrations");
  return readdirSync(pasta)
    .filter((nome) => nome.endsWith(".sql"))
    .sort()
    .map((nome) => ({ nome, conteudo: readFileSync(join(pasta, nome), "utf8") }));
}

// Impressão gravada do lar. Cria a tabela da medição se faltar (fora das migrações do app); sem linha, devolve null.
async function impressaoGravada(env, cfg) {
  await executaSql(
    env,
    cfg,
    `CREATE TABLE IF NOT EXISTS ${TABELA_DA_MEDICAO} (chave TEXT PRIMARY KEY, impressao TEXT NOT NULL, gravado_em TEXT NOT NULL)`,
    "Criação da tabela de medição falhou.",
  );
  const linhas = await consultaD1(
    env,
    cfg,
    `SELECT impressao FROM ${TABELA_DA_MEDICAO} WHERE chave = '${CHAVE_DO_LAR}'`,
    "Leitura da impressão do lar falhou.",
  );
  return linhas[0]?.impressao ?? null;
}

async function main() {
  const arquivo = process.argv[2];
  if (!arquivo) falha("Uso: npm run cpu -- tests/cpu/TASK-NNXX.json");
  const pedido = JSON.parse(readFileSync(resolve(raiz, arquivo), "utf8"));
  if (typeof pedido.task !== "string" || !Array.isArray(pedido.requests) || pedido.requests.length === 0) {
    falha('Arquivo de medição inválido: precisa de "task" e de "requests".');
  }
  if (
    pedido.flows !== undefined &&
    !(
      Array.isArray(pedido.flows) &&
      pedido.flows.every(
        (fluxo) => typeof fluxo?.name === "string" && Number.isInteger(fluxo.runs) && fluxo.runs > 0,
      )
    )
  ) {
    falha('Arquivo de medição inválido: "flows" é uma lista de { "name", "runs" }.');
  }
  if (
    pedido.setupSql !== undefined &&
    !(Array.isArray(pedido.setupSql) && pedido.setupSql.every((sql) => typeof sql === "string"))
  ) {
    falha('Arquivo de medição inválido: "setupSql" é uma lista de comandos SQL.');
  }

  const env = lerEnv();
  await confereConta(env);
  pegaTrava(pedido.task);

  try {
    const cfg = geraConfigDeDev(env, pedido);
    const build = await executa([viteJs, "build"], process.env);
    if (build.codigo !== 0) falha(`vite build falhou.\n${mascara(build.saida)}`);

    const deploy = await executa([wranglerJs, "deploy", "-c", cfg], ambienteDoWrangler(env));
    if (deploy.codigo !== 0) falha(`wrangler deploy falhou.\n${mascara(deploy.saida)}`);
    const casa = /https:\/\/matrimoney-dev\.[^\s"'<>]+\.workers\.dev/.exec(deploy.saida);
    if (!casa) falha("A saída do deploy não trouxe a URL do Worker.");
    const urlDoWorker = casa[0];
    console.log("Deploy ok (URL mascarada nesta saída).");

    // Chave mestra do Worker de medição: gravada só se faltar, nunca trocada (cifra as chaves de teste).
    const segredos = await executa(
      [wranglerJs, "secret", "list", "-c", cfg, "--format", "json"],
      ambienteDoWrangler(env),
    );
    if (segredos.codigo !== 0) falha(`wrangler secret list falhou.\n${mascara(segredos.saida)}`);
    if (!nomesDeSegredos(segredos.saida).includes("MASTER_KEY")) {
      const gravacao = await executaComEntrada(
        [wranglerJs, "secret", "put", "MASTER_KEY", "-c", cfg],
        ambienteDoWrangler(env),
        env.MM_DEV_MASTER_KEY,
      );
      if (gravacao.codigo !== 0) falha(`wrangler secret put falhou.\n${mascara(gravacao.saida)}`);
      console.log("Chave mestra gravada no Worker de medição (valor não exibido).");
    } else {
      console.log("Chave mestra já existia no Worker de medição; não foi trocada.");
    }

    const migracao = await executa(
      [wranglerJs, "d1", "migrations", "apply", BANCO, "-c", cfg, "--remote"],
      ambienteDoWrangler(env),
    );
    if (migracao.codigo !== 0) falha(`Migração remota falhou.\n${mascara(migracao.saida)}`);
    console.log("Migrações remotas ok.");

    // Lar: reaproveita o que está gravado quando a impressão digital bate e a rodada só lê; senão, apaga e grava.
    const impressaoDoArquivo = impressaoDoLar({
      setupSql: pedido.setupSql ?? [],
      migracoes: lerMigracoes(),
      esvaziarBanco: pedido.esvaziarBanco === true,
      codigoDoEsvaziamento: esvaziaBanco.toString() + ordemDeEsvaziamento.toString(),
    });
    const impressaoDoBanco = await impressaoGravada(env, cfg);
    const lar = escolheLar({
      impressaoDoBanco,
      impressaoDoArquivo,
      requests: pedido.requests,
      flows: pedido.flows,
    });
    console.log(
      `Lar ${lar.modo === "reaproveitar" ? "reaproveitado" : "gravado"}: ${lar.motivo} (task ${pedido.task}).`,
    );

    const agora = new Date();
    const expira = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const sessao = pedido.sessao === true ? geraSessaoDeTeste() : null;
    const passkeyDeLogin = (pedido.flows ?? []).some((fluxo) => fluxo.name === "login")
      ? geraPasskeyDeTeste()
      : null;

    if (lar.modo === "gravar") {
      // Antes de mexer no lar, a impressão sai do banco: se o preparo falhar no meio, a próxima rodada grava de novo.
      await executaSql(env, cfg, `DELETE FROM ${TABELA_DA_MEDICAO}`, "Limpeza da impressão do lar falhou.");
      if (pedido.esvaziarBanco === true) await esvaziaBanco(env, cfg);
      const comandos = [...(pedido.setupSql ?? [])];
      if (passkeyDeLogin) {
        comandos.push(
          `INSERT INTO passkeys (id, member_id, public_key, counter, transports, device_name, added_via, created_at, last_used_at) VALUES ('${passkeyDeLogin.idDaPasskey}', 'cpu-membro-1', '${passkeyDeLogin.chavePublica}', 0, NULL, 'CPU Chromium', 'cadastro', '${agora.toISOString()}', NULL)`,
        );
      }
      if (sessao) {
        comandos.push(
          `INSERT INTO passkeys (id, member_id, public_key, counter, transports, device_name, added_via, created_at, last_used_at) VALUES ('cpu-passkey-sessao', 'cpu-membro-1', 'CPU-SEM-LOGIN', 0, NULL, 'CPU Chromium', 'cadastro', '${agora.toISOString()}', NULL)`,
          `INSERT INTO sessions (token_hash, member_id, passkey_id, created_at, last_seen_at, expires_at, notices_seen_at) VALUES ('${sessao.hash}', 'cpu-membro-1', 'cpu-passkey-sessao', '${agora.toISOString()}', '${agora.toISOString()}', '${expira}', NULL)`,
        );
      }
      for (const sql of comandos) await executaSql(env, cfg, sql, "Preparo do banco de medição falhou.");
      // Só uma rodada de leitura deixa o lar como o setupSql o deixou: só então a impressão volta para o banco.
      if (sohLeitura(pedido)) {
        await executaSql(
          env,
          cfg,
          `INSERT INTO ${TABELA_DA_MEDICAO} (chave, impressao, gravado_em) VALUES ('${CHAVE_DO_LAR}', '${impressaoDoArquivo}', '${agora.toISOString()}')`,
          "Gravação da impressão do lar falhou.",
        );
      }
    } else if (sessao) {
      // Reaproveitado: o lar fica como está. Só a sessão de teste é renovada, a cada rodada.
      const renovaSessao = [
        "DELETE FROM sessions WHERE passkey_id = 'cpu-passkey-sessao'",
        `INSERT OR IGNORE INTO passkeys (id, member_id, public_key, counter, transports, device_name, added_via, created_at, last_used_at) VALUES ('cpu-passkey-sessao', 'cpu-membro-1', 'CPU-SEM-LOGIN', 0, NULL, 'CPU Chromium', 'cadastro', '${agora.toISOString()}', NULL)`,
        `INSERT INTO sessions (token_hash, member_id, passkey_id, created_at, last_seen_at, expires_at, notices_seen_at) VALUES ('${sessao.hash}', 'cpu-membro-1', 'cpu-passkey-sessao', '${agora.toISOString()}', '${agora.toISOString()}', '${expira}', NULL)`,
      ];
      for (const sql of renovaSessao)
        await executaSql(env, cfg, sql, "Renovação da sessão de medição falhou.");
    }

    tailFilho = spawn(process.execPath, [wranglerJs, "tail", WORKER, "--format", "json"], {
      cwd: raiz,
      env: ambienteDoWrangler(env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let textoDoTail = "";
    tailFilho.stdout.on("data", (pedaco) => {
      textoDoTail += pedaco;
    });
    tailFilho.stderr.on("data", () => {});
    await esperar(ESPERA_ANTES_DAS_REQUISICOES_MS);

    // Uma rota direta: AQUECIMENTO + MEDIDAS requisições, com a rodada no caminho, no corpo e nos cabeçalhos.
    const enviaRota = async (rota) => {
      for (let i = 1; i <= AQUECIMENTO + MEDIDAS; i++) {
        const corpoDaRodada =
          rota.corpos !== undefined ? rota.corpos[(i - 1) % rota.corpos.length] : rota.body;
        const corpo = corpoDaRodada === undefined ? undefined : JSON.stringify(trocaI(corpoDaRodada, i));
        const cabecalhos = {};
        for (const [nome, valor] of Object.entries(rota.headers ?? {})) {
          if (valor === "{sessao}") {
            if (!sessao) falha(`A rota ${rota.name} pede sessão, mas o arquivo não tem "sessao": true.`);
            cabecalhos[nome] = `mm_sess=${sessao.token}`;
          } else {
            cabecalhos[nome] = trocaI(valor, i);
          }
        }
        if (corpo !== undefined && !("content-type" in cabecalhos))
          cabecalhos["content-type"] = "application/json";
        try {
          const resposta = await fetch(new URL(trocaI(rota.path, i), urlDoWorker), {
            method: rota.method,
            headers: cabecalhos,
            body: corpo,
          });
          await resposta.arrayBuffer();
        } catch {
          falha(`Requisição ${rota.method} ${rota.path} falhou (rede).`);
        }
        await esperar(INTERVALO_ENTRE_REQUISICOES_MS);
      }
    };

    // Fluxo de navegador (TASK-0103, cadastro com passkey; TASK-0104, entrada com passkey, e os de TASK-0105 e TASK-0106):
    // roda com o tail aberto. A URL e a configuração vão pelo ambiente do processo filho; a saída nunca traz a URL.
    const rodaFluxo = async (fluxo) => {
      const ambienteDoFluxo = { ...ambienteDoWrangler(env), MM_CPU_URL: urlDoWorker, MM_CPU_CONFIG: cfg };
      if (["convite", "aparelho", "recuperacao"].includes(fluxo.name)) {
        // Convite, aparelho e recuperação agem pela sessão de teste do arquivo (sessao: true): o token vai só pelo ambiente.
        if (!sessao) falha(`O fluxo ${fluxo.name} pede "sessao": true no arquivo de medição.`);
        ambienteDoFluxo.MM_CPU_SESSAO = sessao.token;
      }
      if (fluxo.name === "login") {
        ambienteDoFluxo.MM_CPU_PASSKEY = JSON.stringify({
          credentialIdBase64: passkeyDeLogin.credentialIdBase64,
          privateKeyPkcs8Base64: passkeyDeLogin.privateKeyPkcs8Base64,
          userHandleBase64: passkeyDeLogin.userHandleBase64,
        });
      }
      const rodada = await executa(
        [join(raiz, "scripts", "dev", "cpu-flows.mjs"), fluxo.name, String(fluxo.runs)],
        ambienteDoFluxo,
      );
      if (rodada.codigo !== 0) falha(`Fluxo ${fluxo.name} falhou.\n${mascara(rodada.saida)}`);
      console.log(mascara(rodada.saida).trim());
    };

    for (const rota of pedido.requests) {
      // Rota com "via" é medida pelo fluxo de navegador indicado (abaixo): não é enviada daqui.
      if (rota.via !== undefined) continue;
      await enviaRota(rota);
    }
    for (const fluxo of pedido.flows ?? []) await rodaFluxo(fluxo);

    await esperar(ESPERA_DEPOIS_DAS_REQUISICOES_MS);
    let resultados = mediaTail(pedido.requests, textoDoTail);

    // Evento perdido: cada rota que faltou é medida de novo, uma vez, com o mesmo deploy e o mesmo tail aberto.
    // Rota de fluxo de navegador: o fluxo que a mede roda de novo, uma vez, com as rodadas do arquivo.
    const jaRemedidas = new Set();
    const aRemedir = rotasParaRemedir(pedido.requests, resultados, jaRemedidas);
    if (aRemedir.length > 0) {
      console.log(
        `Faltou evento do tail para: ${aRemedir.map((rota) => rota.name).join("; ")}. Medindo de novo, uma vez, com o mesmo deploy e o mesmo tail.`,
      );
      const fluxosDeNovo = new Set();
      for (const rota of aRemedir) {
        jaRemedidas.add(rota);
        if (rota.via === undefined) {
          await enviaRota(rota);
          continue;
        }
        if (fluxosDeNovo.has(rota.via)) continue;
        fluxosDeNovo.add(rota.via);
        const fluxo = (pedido.flows ?? []).find((item) => item.name === rota.via);
        if (!fluxo) falha(`A rota ${rota.name} é de um fluxo que não está no arquivo.`);
        await rodaFluxo(fluxo);
      }
      await esperar(ESPERA_DEPOIS_DAS_REQUISICOES_MS);
      resultados = mediaTail(pedido.requests, textoDoTail);
    }
    tailFilho.kill();
    tailFilho = null;

    console.log("");
    console.log("| Requisição | n | mediana (ms) | máxima (ms) |");
    console.log("|---|---|---|---|");
    for (const r of resultados) {
      if (r.faltou) {
        console.log(`| ${r.name} | ${r.n} | faltou evento | faltou evento |`);
      } else {
        console.log(`| ${r.name} | ${r.n} | ${r.medianaMs.toFixed(3)} | ${r.maximaMs.toFixed(3)} |`);
      }
    }

    const pastaDeResultados = join(raiz, "test-results");
    mkdirSync(pastaDeResultados, { recursive: true });
    writeFileSync(
      join(pastaDeResultados, `cpu-${pedido.task}.json`),
      `${JSON.stringify({ task: pedido.task, medidoEm: new Date().toISOString(), limiteMs: LIMITE_MS, lar: lar.modo, requests: resultados }, null, 2)}\n`,
    );

    const veredito = avaliaResultados(resultados);
    if (veredito.faltaram.length > 0) {
      falha(
        `Faltou evento do tail para alguma requisição, mesmo depois da nova tentativa: ${veredito.faltaram.join(", ")}.`,
      );
    }
    if (veredito.acima.length > 0) {
      falha(`Mediana igual ou acima de ${LIMITE_MS} ms: ${veredito.acima.join(", ")}.`);
    }
  } finally {
    if (tailFilho) tailFilho.kill();
    soltaTrava();
  }
}

process.on("SIGINT", () => {
  if (tailFilho) tailFilho.kill();
  soltaTrava();
  process.exit(130);
});

main().then(
  () => {
    console.log("CPU medida: todas as medianas abaixo de 10 ms.");
    process.exit(0);
  },
  (erro) => {
    console.error(
      mascara(erro instanceof Falha ? erro.message : `Erro inesperado: ${erro?.message ?? erro}`),
    );
    process.exit(1);
  },
);
