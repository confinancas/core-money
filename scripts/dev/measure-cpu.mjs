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
import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as lerJsonc } from "jsonc-parser";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pastaDasTravas = resolve(raiz, "..", ".locks");
const caminhoDaTrava = join(pastaDasTravas, "cloudflare-dev.lock");
const WORKER = "matrimoney-dev";
const BANCO = "matrimoney-dev-db";
const LIMITE_MS = 10;
const AQUECIMENTO = 2;
const MEDIDAS = 10;
const ESPERA_ANTES_DAS_REQUISICOES_MS = 5000;
const ESPERA_DEPOIS_DAS_REQUISICOES_MS = 10000;
// Uma requisição por segundo: em rajada o tail do Cloudflare perde eventos (medido na TASK-0003: 13 de 24 perdidos).
const INTERVALO_ENTRE_REQUISICOES_MS = 1000;
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

// Lê objetos JSON concatenados (um por evento, com ou sem quebra de linha), sem depender do formato da linha.
function eventosDoTail(texto) {
  const objetos = [];
  let profundidade = 0;
  let emTexto = false;
  let escapado = false;
  let inicio = -1;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (emTexto) {
      if (escapado) escapado = false;
      else if (c === "\\") escapado = true;
      else if (c === '"') emTexto = false;
      continue;
    }
    if (c === '"') emTexto = true;
    else if (c === "{") {
      if (profundidade === 0) inicio = i;
      profundidade++;
    } else if (c === "}") {
      profundidade--;
      if (profundidade === 0 && inicio >= 0) {
        try {
          objetos.push(JSON.parse(texto.slice(inicio, i + 1)));
        } catch {
          // um evento ilegível vira "faltou evento" na contagem
        }
        inicio = -1;
      }
    }
  }
  return objetos;
}

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

const mediana = (valores) => {
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
};

// {i} em textos, listas e objetos: a rodada entra no caminho, no corpo e nos cabeçalhos.
const trocaI = (valor, i) => {
  if (typeof valor === "string") return valor.split("{i}").join(String(i));
  if (Array.isArray(valor)) return valor.map((item) => trocaI(item, i));
  if (valor !== null && typeof valor === "object") {
    return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, trocaI(item, i)]));
  }
  return valor;
};

// Caminho com {i} vira um padrão: /api/rules/cpu-regra-{i} casa com cpu-regra-1, cpu-regra-2... (qualquer número).
function padraoDoCaminho(caminho) {
  const escapado = caminho.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // {id} casa com um segmento qualquer (o id do convite é um UUID gerado pelo Worker).
  return new RegExp(`^${escapado.split("\\{i\\}").join("\\d+").split("\\{id\\}").join("[^/]+")}$`);
}

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

// Esvazia todas as tabelas do banco de medição, filhos antes dos pais (só dados [TEST]; o banco é de teste).
async function esvaziaBanco(env, cfg) {
  const consulta = await executa(
    [
      wranglerJs,
      "d1",
      "execute",
      BANCO,
      "-c",
      cfg,
      "--remote",
      "--json",
      "--command",
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
    ],
    ambienteDoWrangler(env),
  );
  if (consulta.codigo !== 0) falha(`Leitura das tabelas falhou.\n${mascara(consulta.saida)}`);
  const texto = consulta.saida;
  const tabelas = JSON.parse(texto.slice(texto.indexOf("["), texto.lastIndexOf("]") + 1))[0]?.results ?? [];
  const pais = new Map(tabelas.map((linha) => [linha.name, new Set()]));
  for (const { name: filho, sql } of tabelas) {
    for (const casa of String(sql ?? "").matchAll(/REFERENCES\s+[`"[]?(\w+)/gi)) {
      const pai = casa[1];
      if (pais.has(pai) && pai !== filho) pais.get(filho).add(pai);
    }
  }
  const ordem = [];
  while (pais.size > 0) {
    const referenciadas = new Set([...pais.values()].flatMap((conjunto) => [...conjunto]));
    const saem = [...pais.keys()].filter((nome) => !referenciadas.has(nome));
    const lote = saem.length > 0 ? saem : [...pais.keys()];
    for (const nome of lote) {
      ordem.push(nome);
      pais.delete(nome);
    }
  }
  for (const nome of ordem) {
    const apaga = await executa(
      [wranglerJs, "d1", "execute", BANCO, "-c", cfg, "--remote", "--command", `DELETE FROM "${nome}"`],
      ambienteDoWrangler(env),
    );
    if (apaga.codigo !== 0) falha(`Esvaziamento do banco de medição falhou.\n${mascara(apaga.saida)}`);
  }
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

    // Estado do banco de teste antes das rotas (só dados [TEST]): zera, depois o preparo da task, depois a sessão e a
    // passkey de teste geradas nesta execução.
    if (pedido.esvaziarBanco === true) await esvaziaBanco(env, cfg);
    const comandos = [...(pedido.setupSql ?? [])];
    const agora = new Date();
    const expira = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const sessao = pedido.sessao === true ? geraSessaoDeTeste() : null;
    const passkeyDeLogin = (pedido.flows ?? []).some((fluxo) => fluxo.name === "login")
      ? geraPasskeyDeTeste()
      : null;
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
    for (const sql of comandos) {
      const preparo = await executa(
        [wranglerJs, "d1", "execute", BANCO, "-c", cfg, "--remote", "--command", sql],
        ambienteDoWrangler(env),
      );
      if (preparo.codigo !== 0) falha(`Preparo do banco de medição falhou.\n${mascara(preparo.saida)}`);
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

    for (const rota of pedido.requests) {
      // Rota com "via" é medida pelo fluxo de navegador indicado (abaixo): não é enviada daqui.
      if (rota.via !== undefined) continue;
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
    }

    // Fluxos de navegador (TASK-0103, cadastro com passkey; TASK-0104, entrada com passkey): rodam com o tail aberto. A
    // URL e a configuração vão pelo ambiente do processo filho; a saída do fluxo nunca traz a URL (cpu-flows.mjs mascara).
    for (const fluxo of pedido.flows ?? []) {
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
    }

    await esperar(ESPERA_DEPOIS_DAS_REQUISICOES_MS);
    tailFilho.kill();
    tailFilho = null;

    const porRota = new Map();
    for (const evento of eventosDoTail(textoDoTail)) {
      const requisicao = evento?.event?.request;
      if (typeof requisicao?.method !== "string" || typeof requisicao?.url !== "string") continue;
      const chave = `${requisicao.method} ${new URL(requisicao.url).pathname}`;
      if (!porRota.has(chave)) porRota.set(chave, []);
      porRota.get(chave).push({ ts: Number(evento.eventTimestamp ?? 0), cpu: evento.cpuTime });
    }

    const resultados = [];
    let faltou = false;
    for (const rota of pedido.requests) {
      // Os eventos da rota: a mesma rota (com {i} casando qualquer número), em ordem de chegada.
      const padrao = padraoDoCaminho(rota.path);
      const eventos = [];
      for (const [chave, lista] of porRota) {
        const separador = chave.indexOf(" ");
        if (chave.slice(0, separador) !== rota.method) continue;
        if (padrao.test(chave.slice(separador + 1))) eventos.push(...lista);
      }
      eventos.sort((a, b) => a.ts - b.ts);
      const medidos = eventos.slice(AQUECIMENTO, AQUECIMENTO + MEDIDAS);
      if (medidos.length < MEDIDAS || medidos.some((evento) => typeof evento.cpu !== "number")) {
        faltou = true;
        resultados.push({
          name: rota.name,
          method: rota.method,
          path: rota.path,
          n: medidos.length,
          faltou: true,
        });
        continue;
      }
      const cpus = medidos.map((evento) => evento.cpu);
      resultados.push({
        name: rota.name,
        method: rota.method,
        path: rota.path,
        n: cpus.length,
        medianaMs: mediana(cpus),
        maximaMs: Math.max(...cpus),
        cpuMs: cpus,
        faltou: false,
      });
    }

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
      `${JSON.stringify({ task: pedido.task, medidoEm: new Date().toISOString(), limiteMs: LIMITE_MS, requests: resultados }, null, 2)}\n`,
    );

    if (faltou) falha("Faltou evento do tail para alguma requisição.");
    const acima = resultados.filter((r) => r.medianaMs >= LIMITE_MS);
    if (acima.length > 0) {
      falha(`Mediana igual ou acima de ${LIMITE_MS} ms: ${acima.map((r) => r.name).join(", ")}.`);
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
