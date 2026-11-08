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
// O token da sessão de teste do fluxo convite também não sai na saída de erro.
if (process.env.MM_CPU_SESSAO) valoresSecretos.push(process.env.MM_CPU_SESSAO);
// A chave privada da passkey de teste (TASK-0104) nunca sai na saída de erro.
if (process.env.MM_CPU_PASSKEY) {
  const passkeyDeTeste = JSON.parse(process.env.MM_CPU_PASSKEY);
  if (passkeyDeTeste.privateKeyPkcs8Base64) valoresSecretos.push(passkeyDeTeste.privateKeyPkcs8Base64);
}

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
// O D1 remoto recusa as funções de pragma (SQLITE_AUTH); as chaves estrangeiras saem do texto do CREATE TABLE.
function ordemDeEsvaziamento() {
  const tabelas = d1(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
    { json: true },
  );
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

// Entrada com passkey (TASK-0104): a passkey de teste (criada pelo measure-cpu, no banco de medição, com a chave pública
// no D1) entra no autenticador virtual. Cada rodada abre /entrar, toca em Entrar com passkey e chega a /inicio (login/
// options e login/verify), e sai pela API (logout). Não zera o banco: o login usa a passkey do preparo.
async function rodaLogin(navegador, total) {
  const passkey = JSON.parse(process.env.MM_CPU_PASSKEY ?? "null");
  if (!passkey)
    throw new Error("Sem passkey de teste: o measure-cpu passa MM_CPU_PASSKEY para o fluxo login.");
  const contexto = await navegador.newContext();
  try {
    const pagina = await contexto.newPage();
    const cdp = await contexto.newCDPSession(pagina);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await cdp.send("WebAuthn.addCredential", {
      authenticatorId,
      credential: {
        credentialId: passkey.credentialIdBase64,
        isResidentCredential: true,
        rpId: new URL(url).hostname,
        privateKey: passkey.privateKeyPkcs8Base64,
        userHandle: passkey.userHandleBase64,
        signCount: 0,
      },
    });
    // O tail do Cloudflare perde eventos em rajada (o medidor espaça as próprias requisições em 1 s): cada passo do
    // login tem uma pausa, para que options, verify e logout cheguem um a um.
    for (let i = 1; i <= total; i++) {
      await pagina.goto(`${url}/entrar`, { timeout: 60000 });
      await pagina.waitForTimeout(PAUSA_DO_LOGIN_MS);
      await pagina.getByRole("button", { name: "Entrar com passkey", exact: true }).click();
      try {
        await pagina.waitForURL(/\/inicio$/, { timeout: 30000 });
      } catch {
        // Diagnóstico sem segredo: o caminho da tela (sem o host) e os avisos que ela mostra.
        const avisos = await pagina
          .getByRole("alert")
          .allTextContents()
          .catch(() => []);
        throw new Error(
          `login: a rodada ${i} não chegou a /inicio (caminho: ${new URL(pagina.url()).pathname}; avisos: ${avisos.join(" | ") || "nenhum"}).`,
        );
      }
      await pagina.waitForTimeout(PAUSA_DO_LOGIN_MS);
      const saiu = await pagina.request.post(`${url}/api/auth/logout`, { data: {} });
      if (!saiu.ok()) throw new Error(`logout falhou (${saiu.status()}).`);
      console.log(`login: rodada ${i} de ${total} ok`);
      await pagina.waitForTimeout(PAUSA_DO_LOGIN_MS);
    }
  } finally {
    await contexto.close();
  }
}

// Convite (TASK-0105): cada rodada tira o cônjuge do lar de medição e refaz o convite pela sessão do titular (a
// sessão do setupSql, em MM_CPU_SESSAO): cria, gera um link novo, cancela, cria de novo e aceita num segundo aparelho
// (outro contexto do navegador, com o autenticador virtual). Os pedidos do titular saem pela API do contexto, com o
// cookie da sessão; o aceite é o da pessoa convidada, pelo navegador. Não zera o lar: só o que é do convite.
const PAUSA_DO_CONVITE_MS = 1500;
const NOME_DO_CONJUGE_DE_TESTE = "[TEST] Pessoa B";
const EMAIL_DO_CONJUGE_DE_TESTE = "pessoa.b@example.com";
const pausaDoConvite = () => new Promise((resolver) => setTimeout(resolver, PAUSA_DO_CONVITE_MS));

// Tira o cônjuge, as passkeys e as sessões dele, os convites e os desafios: o titular e a sessão dele ficam.
function resetaConvite() {
  for (const sql of [
    "DELETE FROM sessions WHERE member_id <> 'cpu-membro-1'",
    "DELETE FROM passkeys WHERE added_via = 'convite'",
    "DELETE FROM webauthn_challenges",
    "DELETE FROM invites WHERE kind = 'conjuge'",
    "DELETE FROM members WHERE role = 'conjuge'",
  ]) {
    d1(sql);
  }
}

async function criaConviteDoTitular(api, url) {
  const resposta = await api.post(`${url}/api/invites/conjuge`, {
    data: { name: NOME_DO_CONJUGE_DE_TESTE, email: EMAIL_DO_CONJUGE_DE_TESTE },
  });
  if (resposta.status() !== 201) throw new Error(`convite: a criação respondeu ${resposta.status()}.`);
  return resposta.json();
}

// A pessoa convidada abre o link num aparelho novo, cria o nome e a passkey, e chega ao início.
async function aceitaNoOutroAparelho(navegador, link) {
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
    await pagina.goto(link, { timeout: 60000 });
    await pagina.getByLabel("Seu nome no app").fill(NOME_DO_CONJUGE_DE_TESTE);
    await pausaDoConvite();
    await pagina.getByRole("button", { name: "Continuar", exact: true }).click();
    await pagina.getByRole("heading", { name: "Crie sua passkey" }).waitFor({ timeout: 60000 });
    await pausaDoConvite();
    await pagina.getByRole("button", { name: "Criar passkey", exact: true }).click();
    await pagina.waitForURL(/\/inicio$/, { timeout: 60000 });
  } finally {
    await contexto.close();
  }
}

async function rodaConvite(navegador, total) {
  const sessao = process.env.MM_CPU_SESSAO;
  if (!sessao)
    throw new Error("Sem sessão de teste: o measure-cpu passa MM_CPU_SESSAO para o fluxo convite.");
  const titular = await navegador.newContext();
  try {
    await titular.addCookies([{ name: "mm_sess", value: sessao, url }]);
    const api = titular.request;
    for (let i = 1; i <= total; i++) {
      resetaConvite();
      await pausaDoConvite();
      const primeiro = await criaConviteDoTitular(api, url);
      await pausaDoConvite();
      const renovado = await api.post(`${url}/api/invites/${primeiro.invite.id}/renew`, { data: {} });
      if (renovado.status() !== 201) throw new Error(`convite: o link novo respondeu ${renovado.status()}.`);
      const novoConvite = await renovado.json();
      await pausaDoConvite();
      const cancelado = await api.delete(`${url}/api/invites/${novoConvite.invite.id}`);
      if (cancelado.status() !== 200)
        throw new Error(`convite: o cancelamento respondeu ${cancelado.status()}.`);
      await pausaDoConvite();
      const convite = await criaConviteDoTitular(api, url);
      await pausaDoConvite();
      await aceitaNoOutroAparelho(navegador, convite.link);
      console.log(`convite: rodada ${i} de ${total} ok`);
      await pausaDoConvite();
    }
  } finally {
    await titular.close();
  }
}

const PAUSA_DO_LOGIN_MS = 1500;

const FLUXOS = { cadastro: rodaCadastro, login: rodaLogin, convite: rodaConvite };

async function main() {
  const fluxo = FLUXOS[nomeDoFluxo];
  if (!fluxo) throw new Error(`Fluxo desconhecido: ${nomeDoFluxo}`);
  const navegador = await chromium.launch();
  try {
    if (nomeDoFluxo === "login" || nomeDoFluxo === "convite") {
      // Login e convite rodam em série e não zeram o banco: cada um cuida só do que é dele.
      await fluxo(navegador, rodadas);
      return;
    }
    const ordem = ordemDeEsvaziamento();
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
