import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateLinkToken, sha256Hex } from "../src/shared/access-code";
import { confirmaConta } from "./lib/conta";
import { caminhoDoEstado, lerEstado } from "./lib/estado";
import { ErroDeUso, lerMarca, validaNomeDoWorker } from "./lib/marca";
import { sqlCancelaRecuperacoesAbertas, sqlInsereRecuperacao, sqlListaMembros } from "./lib/sql";
import { caixa, qrParaTerminal, type Terminal, terminalDoProcesso } from "./lib/terminal";
import {
  type AmbienteDoWrangler,
  criaWrangler,
  ErroDoWrangler,
  execucaoReal,
  type Wrangler,
} from "./lib/wrangler";

// Recuperação de acesso de nível 3 (TASK-0101, ADR-010): quem instalou gera um link de uso único, válido por 60 min.
// `npm run recuperar-acesso`. O link é mostrado só no terminal, e o banco guarda só o hash do token.

export const MINUTOS_DE_VALIDADE = 60;
const FORMATO_ENDERECO = /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/;

export type OpcoesRecuperar = {
  argumentos: string[];
  pastaApp: string;
  wrangler: Wrangler;
  definirConta: (id: string) => void;
  terminal: Terminal;
  versaoDoNode: string;
  agora: () => Date;
  gerarToken: () => string;
  gerarId: () => string;
};

export function leArgumentosDaRecuperacao(argumentos: string[]): { nome?: string; sim: boolean } {
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

type LinhaDeMembro = { id: string; household_id: string; name: string; role: string };

function leLinhaDeMembro(linha: Record<string, unknown>): LinhaDeMembro {
  const { id, household_id: householdId, name, role } = linha;
  if (typeof id !== "string" || typeof householdId !== "string" || typeof name !== "string") {
    throw new ErroDoWrangler("A lista de membros veio fora do formato esperado.");
  }
  return { id, household_id: householdId, name, role: typeof role === "string" ? role : "" };
}

export async function recuperarAcesso(opcoes: OpcoesRecuperar): Promise<number> {
  try {
    return await executaRecuperacao(opcoes);
  } catch (erro) {
    if (erro instanceof ErroDeUso || erro instanceof ErroDoWrangler) {
      opcoes.terminal.escreve(erro.message);
    } else {
      opcoes.terminal.escreve(`Erro inesperado: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
    return 1;
  }
}

async function executaRecuperacao(opcoes: OpcoesRecuperar): Promise<number> {
  const { pastaApp, wrangler, terminal } = opcoes;
  const { nome: nomeDaFlag, sim } = leArgumentosDaRecuperacao(opcoes.argumentos);
  if (Number(opcoes.versaoDoNode.split(".")[0]) < 22) {
    throw new ErroDeUso(`Precisa de Node 22 ou mais novo (aqui: ${opcoes.versaoDoNode}).`);
  }
  const marca = lerMarca(pastaApp);
  const nome = nomeDaFlag ?? marca.workerName;
  const bancoNome = `${nome}-db`;

  const conta = await confirmaConta(wrangler, terminal, sim, opcoes.definirConta);
  if (!conta) return 1;

  // O banco e o endereço vêm do estado local. Sem estado, a pessoa informa o endereço e o banco é <nome>-db.
  const estado = lerEstado(caminhoDoEstado(pastaApp, marca.id));
  let url: string;
  let banco: string;
  if (estado) {
    url = estado.url;
    banco = estado.databaseName;
  } else {
    const digitado = (
      await terminal.pergunta("Endereço do seu app (https://<nome>.<subdominio>.workers.dev): ")
    )
      .trim()
      .replace(/\/$/, "");
    if (!FORMATO_ENDERECO.test(digitado)) {
      throw new ErroDeUso(
        "Endereço inválido: use o endereço https://<nome>.<subdominio>.workers.dev do seu app.",
      );
    }
    url = digitado;
    banco = bancoNome;
  }

  const linhas = await wrangler.executaSql(banco, sqlListaMembros());
  if (linhas.length === 0) {
    terminal.escreve(
      "Ninguém cadastrou acesso ainda: use o código de primeiro acesso (rode npm run instalar).",
    );
    return 1;
  }
  const membros = linhas.map(leLinhaDeMembro);
  terminal.escreve("Quem cadastrou acesso:");
  for (const [posicao, membro] of membros.entries()) {
    terminal.escreve(`  ${posicao + 1}. ${membro.name} (${membro.role})`);
  }
  const numero = Number((await terminal.pergunta("Quem precisa entrar de novo? (número) ")).trim());
  if (!Number.isInteger(numero) || numero < 1 || numero > membros.length) {
    throw new ErroDeUso("Número inválido. Nada foi gerado.");
  }
  const escolhido = membros[numero - 1];

  const token = opcoes.gerarToken();
  const hash = await sha256Hex(token);
  const agora = opcoes.agora();
  const criadoEm = agora.toISOString();
  const expiraEm = new Date(agora.getTime() + MINUTOS_DE_VALIDADE * 60_000).toISOString();
  await wrangler.executaSql(banco, sqlCancelaRecuperacoesAbertas(escolhido.id, criadoEm));
  await wrangler.executaSql(
    banco,
    sqlInsereRecuperacao({
      id: opcoes.gerarId(),
      householdId: escolhido.household_id,
      hash,
      memberId: escolhido.id,
      criadoEm,
      expiraEm,
    }),
  );

  const link = `${url}/recuperar/${token}`;
  terminal.escreve(
    caixa([
      `Link de recuperação para ${escolhido.name}: ${link}`,
      `Vale por ${MINUTOS_DE_VALIDADE} minutos e serve uma vez só.`,
      "Abra no aparelho novo e crie uma passkey.",
    ]),
  );
  terminal.escreve("QR code com o link (escaneie com o aparelho novo):");
  terminal.escreve(await qrParaTerminal(link));
  return 0;
}

export async function executaPeloProcessoDeRecuperacao(): Promise<number> {
  const pastaApp = process.cwd();
  const ambiente: AmbienteDoWrangler = {};
  return recuperarAcesso({
    argumentos: process.argv.slice(2),
    pastaApp,
    wrangler: criaWrangler(execucaoReal(pastaApp, ambiente)),
    definirConta: (id) => {
      ambiente.CLOUDFLARE_ACCOUNT_ID = id;
    },
    terminal: terminalDoProcesso(),
    versaoDoNode: process.versions.node,
    agora: () => new Date(),
    gerarToken: generateLinkToken,
    gerarId: () => randomUUID(),
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  executaPeloProcessoDeRecuperacao().then((codigo) => {
    process.exitCode = codigo;
  });
}
