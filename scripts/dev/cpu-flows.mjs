#!/usr/bin/env node
// Fluxos de navegador da medição de CPU (TASK-0103): o cadastro do lar com passkey, no matrimoney-dev, com o
// Chromium e o autenticador virtual. Quem chama é scripts/dev/measure-cpu.mjs, que passa pelo ambiente a URL do
// Worker (MM_CPU_URL) e o arquivo de configuração do deploy de medição (MM_CPU_CONFIG); o token vem do ambiente.
// Uso: node scripts/dev/cpu-flows.mjs <fluxo> <rodadas>. Só dados [TEST]. Nunca imprime a URL nem valores do .env:
// todo texto de erro passa por mascara().
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const wranglerJs = join(raiz, "node_modules", "wrangler", "bin", "wrangler.js");
const BANCO = "matrimoney-dev-db";
// Hash de TESTTESTTEST (o código TEST-TEST-TEST já normalizado), o mesmo do tests/cpu/TASK-0102.json.
const HASH_DO_CODIGO_DE_TESTE = "7a645eb78586d5ccd7fc56055f8fa13966cdcd43eb2483c7be208c1fc5b93fb7";
const CODIGO_DE_TESTE = "TEST-TEST-TEST";

const valoresSecretos = [];
for (const chave of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "MM_DEV_MASTER_KEY"]) {
  if (process.env[chave]) valoresSecretos.push(process.env[chave]);
}
if (process.env.MM_CPU_URL) valoresSecretos.push(process.env.MM_CPU_URL);

function mascara(texto) {
  let saida = String(texto).replace(/https?:\/\/[^\s"'<>]*/g, "<url-mascarada>");
  for (const valor of valoresSecretos) saida = saida.split(valor).join("<valor-mascarado>");
  return saida;
}

const [, , nomeDoFluxo, rodadasTexto] = process.argv;
const rodadas = Number(rodadasTexto);
const url = process.env.MM_CPU_URL;
const configuracao = process.env.MM_CPU_CONFIG;
if (!nomeDoFluxo || !Number.isInteger(rodadas) || rodadas < 1 || !url || !configuracao) {
  console.error(
    "Uso: node scripts/dev/cpu-flows.mjs <fluxo> <rodadas> (com MM_CPU_URL e MM_CPU_CONFIG no ambiente).",
  );
  process.exit(1);
}

// Comando do wrangler contra o D1 remoto de medição (o token já está no ambiente do processo).
function d1(sql, { json = false } = {}) {
  const args = [wranglerJs, "d1", "execute", BANCO, "-c", configuracao, "--remote", "--command", sql];
  if (json) args.push("--json");
  const resultado = spawnSync(process.execPath, args, {
    cwd: raiz,
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  if (resultado.status !== 0) {
    throw new Error(`wrangler d1 execute falhou: ${mascara(resultado.stderr || resultado.stdout)}`);
  }
  if (!json) return [];
  const texto = resultado.stdout;
  const blocos = JSON.parse(texto.slice(texto.indexOf("["), texto.lastIndexOf("]") + 1));
  return blocos[0]?.results ?? [];
}

// Esvazia todas as tabelas do banco de medição, filhos antes dos pais, e põe a instalação em "cadastro" com o
// código de teste aberto (e uma linha de chave, para o modo não ser "configuração"). Só dados [TEST].
function ordemDeEsvaziamento() {
  const tabelas = d1(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
    { json: true },
  ).map((linha) => linha.name);
  const pais = new Map(tabelas.map((nome) => [nome, new Set()]));
  for (const { filho, pai } of d1(
    "SELECT m.name AS filho, f.\"table\" AS pai FROM sqlite_master AS m JOIN pragma_foreign_key_list(m.name) AS f WHERE m.type = 'table'",
    { json: true },
  )) {
    if (pais.has(filho) && filho !== pai) pais.get(filho).add(pai);
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
  return ordem;
}

function preparaInstalacao(ordem) {
  const agora = new Date().toISOString();
  const comandos = ordem.map((nome) => `DELETE FROM "${nome}"`);
  comandos.push(
    `INSERT INTO invites (id, household_id, kind, token_hash, created_at, used_at) VALUES ('cpu-0103-primeiro-acesso', NULL, 'primeiro_acesso', '${HASH_DO_CODIGO_DE_TESTE}', '${agora}', NULL)`,
    `INSERT INTO app_secrets (name, ciphertext, iv, updated_at) VALUES ('claude_api_key', 'AAAA', 'AAAA', '${agora}')`,
  );
  for (const sql of comandos) d1(sql);
}

// Cadastro do lar: abre o código, cria o lar pela tela e a passkey no autenticador virtual. Só o que o usuário faz.
async function rodaCadastro(navegador) {
  const contexto = await navegador.newContext();
  try {
    const pagina = await contexto.newPage();
    const cdp = await contexto.newCDPSession(pagina);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await pagina.goto(`${url}/configuracao-inicial#codigo=${CODIGO_DE_TESTE}`, { timeout: 60000 });
    await pagina.getByRole("heading", { name: "Tudo pronto para começar" }).waitFor({ timeout: 60000 });
    await pagina.getByRole("link", { name: /Começar do zero/ }).click();
    await pagina.getByLabel("Seu nome").fill("[TEST] Pessoa A");
    await pagina.getByRole("button", { name: "Continuar", exact: true }).click();
    await pagina.getByRole("button", { name: "Criar passkey", exact: true }).click();
    await pagina.getByRole("heading", { name: "Adicione seu cônjuge" }).waitFor({ timeout: 60000 });
  } finally {
    await contexto.close();
  }
}

const FLUXOS = { cadastro: rodaCadastro };

async function main() {
  const fluxo = FLUXOS[nomeDoFluxo];
  if (!fluxo) throw new Error(`Fluxo desconhecido: ${nomeDoFluxo}`);
  const ordem = ordemDeEsvaziamento();
  const navegador = await chromium.launch();
  try {
    for (let i = 1; i <= rodadas; i++) {
      preparaInstalacao(ordem);
      await fluxo(navegador);
      console.log(`${nomeDoFluxo}: rodada ${i} de ${rodadas} ok`);
    }
  } finally {
    await navegador.close();
  }
}

main().then(
  () => process.exit(0),
  (erro) => {
    console.error(`Fluxo ${nomeDoFluxo} falhou: ${mascara(erro?.message ?? erro)}`);
    process.exit(1);
  },
);
