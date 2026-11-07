import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateAccessCode, normalizeAccessCode, sha256Hex } from "../src/shared/access-code";
import { CONFIG_DA_INSTALACAO, geraConfigDaInstalacao, leWranglerJsonc } from "./lib/config-instalacao";
import { confirmaConta } from "./lib/conta";
import { ensureSecrets } from "./lib/ensure-secrets";
import { caminhoDoEstado, type EstadoDaInstalacao, gravaEstado, lerEstado } from "./lib/estado";
import { ErroDeUso, lerMarca, type Marca, validaNomeDoWorker } from "./lib/marca";
import {
  sqlCancelaPrimeirosAcessosAbertos,
  sqlContaPrimeirosAcessosUsados,
  sqlInserePrimeiroAcesso,
} from "./lib/sql";
import { caixa, confirma, qrParaTerminal, type Terminal, terminalDoProcesso } from "./lib/terminal";
import {
  type AmbienteDoWrangler,
  criaWrangler,
  ErroDeSubdominio,
  ErroDoWrangler,
  execucaoReal,
  type Wrangler,
} from "./lib/wrangler";

// Instalação e atualização do app (TASK-0101): `npm run instalar`. Rodado pela pasta do app, pelo bin do núcleo.
// Sem a rede, os testes trocam o wrangler, o npm e o terminal (runner falso).

export type ResultadoNpm = { codigo: number; saida: string };
export type Npm = (args: string[], cwd: string) => Promise<ResultadoNpm>;

export type OpcoesInstalar = {
  argumentos: string[];
  pastaApp: string;
  wrangler: Wrangler;
  definirConta: (id: string) => void;
  npm: Npm;
  terminal: Terminal;
  versaoDoNode: string;
  agora: () => Date;
  gerarCodigo: () => string;
  gerarId: () => string;
  gerarChave?: () => string;
};

export const MENSAGEM_SEM_SUBDOMINIO =
  "Sua conta ainda não tem um subdomínio workers.dev. Abra dash.cloudflare.com › Workers e Pages, escolha o subdomínio (ele fica no endereço do app para sempre) e rode npm run instalar de novo.";

export function leArgumentos(argumentos: string[]): { nome?: string; sim: boolean } {
  let nome: string | undefined;
  let sim = false;
  for (let posicao = 0; posicao < argumentos.length; posicao++) {
    const argumento = argumentos[posicao];
    if (argumento === "--sim") {
      sim = true;
    } else if (argumento === "--nome") {
      const valor = argumentos[posicao + 1];
      if (valor === undefined) throw new ErroDeUso("--nome precisa de um valor, por exemplo --nome meu-app.");
      nome = valor;
      posicao++;
    } else if (argumento.startsWith("--nome=")) {
      nome = argumento.slice("--nome=".length);
    } else {
      throw new ErroDeUso(`Argumento desconhecido: ${argumento}. Use --nome <worker> e, se quiser, --sim.`);
    }
  }
  if (nome !== undefined) validaNomeDoWorker(nome);
  return { nome, sim };
}

export function leVersaoDoApp(pastaApp: string): string {
  const caminho = join(pastaApp, "package.json");
  if (!existsSync(caminho))
    throw new ErroDeUso("Sem package.json nesta pasta: rode este comando na raiz do seu app.");
  const versao = (JSON.parse(readFileSync(caminho, "utf8")) as { version?: unknown }).version;
  if (typeof versao !== "string") throw new ErroDeUso("O package.json do app precisa de um campo version.");
  return versao;
}

function ehNodeAceito(versao: string): boolean {
  return Number(versao.split(".")[0]) >= 22;
}

export async function instalar(opcoes: OpcoesInstalar): Promise<number> {
  try {
    return await executaInstalacao(opcoes);
  } catch (erro) {
    if (erro instanceof ErroDeUso || erro instanceof ErroDoWrangler) {
      opcoes.terminal.escreve(erro.message);
    } else {
      opcoes.terminal.escreve(`Erro inesperado: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
    return 1;
  }
}

async function executaInstalacao(opcoes: OpcoesInstalar): Promise<number> {
  const { pastaApp, wrangler, terminal } = opcoes;
  const { nome: nomeDaFlag, sim } = leArgumentos(opcoes.argumentos);
  if (!ehNodeAceito(opcoes.versaoDoNode)) {
    throw new ErroDeUso(`Precisa de Node 22 ou mais novo (aqui: ${opcoes.versaoDoNode}).`);
  }
  const marca: Marca = lerMarca(pastaApp);
  terminal.escreve(`✔ Node ${opcoes.versaoDoNode} e marca ${marca.name} conferidos.`);
  const nome = nomeDaFlag ?? marca.workerName;
  const bancoNome = `${nome}-db`;
  const versao = leVersaoDoApp(pastaApp);
  const caminhoEstado = caminhoDoEstado(pastaApp);
  const estadoAnterior = lerEstado(caminhoEstado);
  // Lido já no começo: sem wrangler.jsonc, o comando para antes de criar qualquer coisa na Cloudflare.
  const textoDoWrangler = leWranglerJsonc(pastaApp);

  // Passo 2: a conta é conferida antes de qualquer escrita.
  const conta = await confirmaConta(wrangler, terminal, sim, opcoes.definirConta);
  if (!conta) return 1;
  terminal.escreve(`✔ Conta da Cloudflare confirmada: ${conta.nome}.`);

  // Passo 3: o banco é criado em ENAM, se ainda não existe.
  let bancos = await wrangler.listaBancosD1();
  if (!bancos.some((banco) => banco.nome === bancoNome)) {
    await wrangler.criaBancoD1(bancoNome);
    bancos = await wrangler.listaBancosD1();
  }
  const banco = bancos.find((item) => item.nome === bancoNome);
  if (!banco) throw new ErroDoWrangler(`O banco ${bancoNome} não apareceu na lista depois de criado.`);
  terminal.escreve(`✔ Banco D1 ${bancoNome} pronto (região ENAM).`);

  // Passo 4: a configuração da instalação. O wrangler.jsonc versionado não muda.
  const config = geraConfigDaInstalacao(textoDoWrangler, { nome, bancoNome, bancoId: banco.uuid });
  writeFileSync(join(pastaApp, CONFIG_DA_INSTALACAO), config);
  terminal.escreve(`✔ ${CONFIG_DA_INSTALACAO} gerado. O wrangler.jsonc não foi alterado.`);

  // Passo 5: build, migrações e deploy.
  const build = await opcoes.npm(["run", "build"], pastaApp);
  if (build.codigo !== 0) {
    throw new ErroDoWrangler(`npm run build falhou (código ${build.codigo}).\n${build.saida.trim()}`);
  }
  terminal.escreve("✔ Build pronto.");
  await wrangler.aplicaMigracoes(bancoNome, CONFIG_DA_INSTALACAO);
  terminal.escreve("✔ Migrações aplicadas.");
  let url: string;
  try {
    url = await wrangler.deploy(CONFIG_DA_INSTALACAO, nome);
  } catch (erro) {
    if (erro instanceof ErroDeSubdominio) {
      terminal.escreve(MENSAGEM_SEM_SUBDOMINIO);
      return 1;
    }
    throw erro;
  }
  terminal.escreve(`✔ Publicado em ${url}.`);

  // Passo 6: a chave mestra, criada uma vez e nunca sobrescrita.
  const segredos = await ensureSecrets(wrangler, {
    config: CONFIG_DA_INSTALACAO,
    gerarChave: opcoes.gerarChave,
  });
  terminal.escreve(
    segredos === "criada"
      ? "✔ Chave mestra criada e gravada como secret do Worker. Ela não aparece aqui."
      : "✔ Chave mestra já existia: mantida.",
  );

  // Passo 7: já há primeiro acesso usado?
  const linhas = await wrangler.executaSql(bancoNome, sqlContaPrimeirosAcessosUsados(), CONFIG_DA_INSTALACAO);
  const usados = Number(linhas[0]?.n);
  if (!Number.isInteger(usados))
    throw new ErroDoWrangler("A contagem de primeiro acesso não veio como número.");

  const estado: EstadoDaInstalacao = {
    nome,
    marca: marca.id,
    databaseName: bancoNome,
    databaseId: banco.uuid,
    url,
    contaId: conta.id,
    atualizadoEm: opcoes.agora().toISOString(),
  };

  if (usados === 0) {
    const mudou = estadoAnterior !== null && estadoAnterior.url !== url;
    if (estadoAnterior === null || mudou) {
      terminal.escreve(
        caixa([
          `Este é o endereço do seu ${marca.name}: ${url}.`,
          "Ele fica fixo para sempre: as passkeys só valem nele.",
          "Para trocar o subdomínio, faça isso agora no painel da Cloudflare (Workers e Pages › Subdomínio) e rode o script de novo.",
        ]),
      );
      if (!(await confirma(terminal, "O endereço está bom?", sim))) {
        terminal.escreve(
          "Nada foi gerado. Troque o subdomínio no painel da Cloudflare e rode o script de novo.",
        );
        return 1;
      }
    }
    const codigo = opcoes.gerarCodigo();
    const hash = await sha256Hex(normalizeAccessCode(codigo));
    const agora = opcoes.agora().toISOString();
    await wrangler.executaSql(bancoNome, sqlCancelaPrimeirosAcessosAbertos(agora), CONFIG_DA_INSTALACAO);
    await wrangler.executaSql(
      bancoNome,
      sqlInserePrimeiroAcesso({ id: opcoes.gerarId(), hash, criadoEm: agora }),
      CONFIG_DA_INSTALACAO,
    );
    gravaEstado(caminhoEstado, estado);
    terminal.escreve(
      caixa([
        `Endereço: ${url}`,
        `Código de primeiro acesso: ${codigo}`,
        "Guarde o código até terminar a configuração. Ele vale uma vez só.",
      ]),
    );
    terminal.escreve("QR code com o endereço e o código (escaneie com o celular):");
    terminal.escreve(await qrParaTerminal(`${url}/configuracao-inicial#codigo=${codigo}`));
    return 0;
  }

  if (estadoAnterior !== null && estadoAnterior.url !== url) {
    terminal.escreve(
      caixa([
        `Atenção: o endereço mudou de ${estadoAnterior.url} para ${url}.`,
        "As passkeys só valem no endereço antigo, então ninguém vai conseguir entrar.",
        "Volte o subdomínio no painel da Cloudflare e rode o script de novo.",
      ]),
    );
    return 2;
  }
  gravaEstado(caminhoEstado, estado);
  terminal.escreve(`Atualização concluída: versão ${versao} publicada em ${url}.`);
  return 0;
}

// Roda `npm run build` (ou outro comando do npm) pelo npm que chamou este script. Sem shell.
export function executaNpm(args: string[], cwd: string): Promise<ResultadoNpm> {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    return Promise.resolve({ codigo: 1, saida: "Rode este comando pelo npm: npm run instalar." });
  }
  return new Promise((resolver, rejeitar) => {
    const filho = spawn(process.execPath, [npmCli, ...args], {
      cwd,
      env: process.env,
      shell: false,
      windowsHide: true,
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
    filho.on("close", (codigo) => resolver({ codigo: codigo ?? 1, saida }));
  });
}

export async function executaPeloProcesso(): Promise<number> {
  const pastaApp = process.cwd();
  const ambiente: AmbienteDoWrangler = {};
  return instalar({
    argumentos: process.argv.slice(2),
    pastaApp,
    wrangler: criaWrangler(execucaoReal(pastaApp, ambiente)),
    definirConta: (id) => {
      ambiente.CLOUDFLARE_ACCOUNT_ID = id;
    },
    npm: executaNpm,
    terminal: terminalDoProcesso(),
    versaoDoNode: process.versions.node,
    agora: () => new Date(),
    gerarCodigo: generateAccessCode,
    gerarId: () => randomUUID(),
  });
}

// Só roda quando o arquivo é o script de entrada (o bin chama o tsx com este arquivo).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  executaPeloProcesso().then((codigo) => {
    process.exitCode = codigo;
  });
}
