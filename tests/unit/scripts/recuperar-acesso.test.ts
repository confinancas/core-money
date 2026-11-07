import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_DA_INSTALACAO, geraConfigDaInstalacao } from "../../../scripts/lib/config-instalacao";
import { criaWrangler } from "../../../scripts/lib/wrangler";
import {
  MINUTOS_DE_VALIDADE,
  type OpcoesRecuperar,
  recuperarAcesso,
} from "../../../scripts/recuperar-acesso";
import { sha256Hex } from "../../../src/shared/access-code";
import {
  CONTA_DE_TESTE,
  criaCloudflareFalso,
  criaPastaDoApp,
  criaTerminalFalso,
  type EstadoFalso,
  estadoInicial,
  INSTANTE_FIXO,
  type Invite,
  NOME_DO_BANCO,
  removePastaDoApp,
  URL_DO_WORKER,
  WRANGLER_DO_APP,
} from "./helpers/cloudflare-falso";

// Cenários 9 e 10 da TASK-0101, com o runner falso da Cloudflare (nada de rede).
const pastas: string[] = [];
const TOKEN_FIXO = "T".repeat(43);
const H_TITULAR = "11111111-aaaa-4bbb-8ccc-000000000001";
const H_CONJUGE = "11111111-aaaa-4bbb-8ccc-000000000002";
const LAR = "22222222-aaaa-4bbb-8ccc-000000000009";
const UUID_DO_BANCO = "11111111-2222-3333-4444-555555555555";
const BANCO_DA_INSTALACAO_NORMAL = "matrimoney-db";

afterEach(() => {
  for (const pasta of pastas.splice(0)) removePastaDoApp(pasta);
});

function novaPasta(): string {
  const pasta = criaPastaDoApp();
  pastas.push(pasta);
  return pasta;
}

// Estado que a conta teria depois de uma instalação: o banco existe e aparece no d1 list.
function estadoDeRecuperacao(parcial: Partial<EstadoFalso> = {}): EstadoFalso {
  return estadoInicial({
    bancos: [{ nome: NOME_DO_BANCO, uuid: UUID_DO_BANCO }],
    ...parcial,
  });
}

function gravaEstado(pasta: string, url: string, banco = NOME_DO_BANCO, nome = "matrimoney-teste"): void {
  mkdirSync(join(pasta, ".core-money"));
  writeFileSync(
    join(pasta, ".core-money", "instalacao.json"),
    JSON.stringify({
      nome,
      marca: "marca-teste",
      databaseName: banco,
      databaseId: UUID_DO_BANCO,
      url,
      contaId: CONTA_DE_TESTE.id,
      atualizadoEm: "2026-11-06T10:00:00.000Z",
    }),
  );
}

function doisMembros(): EstadoFalso["membros"] {
  return [
    {
      id: H_TITULAR,
      household_id: LAR,
      name: "[TEST] Pessoa A",
      role: "titular",
      created_at: "2026-11-01T10:00:00.000Z",
    },
    {
      id: H_CONJUGE,
      household_id: LAR,
      name: "[TEST] Pessoa B",
      role: "conjuge",
      created_at: "2026-11-02T10:00:00.000Z",
    },
  ];
}

function opcoesRecuperacao(
  pasta: string,
  estado: EstadoFalso,
  respostas: string[],
  argumentos: string[] = [],
): { opcoes: OpcoesRecuperar; terminal: ReturnType<typeof criaTerminalFalso> } {
  const terminal = criaTerminalFalso(respostas);
  let contador = 0;
  return {
    terminal,
    opcoes: {
      argumentos,
      pastaApp: pasta,
      wrangler: criaWrangler(criaCloudflareFalso(estado)),
      definirConta: () => {},
      terminal: terminal.terminal,
      versaoDoNode: "22.12.0",
      agora: () => new Date(INSTANTE_FIXO),
      gerarToken: () => TOKEN_FIXO,
      gerarId: () => {
        contador += 1;
        return `00000000-0000-4000-9000-${String(contador).padStart(12, "0")}`;
      },
    },
  };
}

// Todo d1 execute da recuperação tem de levar o wrangler.instalacao.jsonc (senão cai no id-marcador).
function execucoesD1(estado: EstadoFalso) {
  return estado.chamadas.filter((c) => c.args[0] === "d1" && c.args[1] === "execute");
}

describe("recuperar acesso (cenário 9)", () => {
  it("gera um link de 60 minutos para o membro escolhido e cancela a recuperação anterior dele", async () => {
    const pasta = novaPasta();
    gravaEstado(pasta, URL_DO_WORKER);
    const recuperacaoAnterior: Invite = {
      id: "00000000-0000-4000-9000-aaaaaaaaaaaa",
      household_id: LAR,
      kind: "recuperacao",
      token_hash: "b".repeat(64),
      member_id: H_CONJUGE,
      created_by: null,
      created_at: "2026-11-07T09:00:00.000Z",
      expires_at: "2026-11-07T10:00:00.000Z",
      used_at: null,
      cancelled_at: null,
    };
    const estado = estadoDeRecuperacao({ membros: doisMembros(), convites: [recuperacaoAnterior] });
    const { opcoes, terminal } = opcoesRecuperacao(pasta, estado, ["s", "2"]);

    const codigo = await recuperarAcesso(opcoes);

    expect(codigo).toBe(0);
    const anterior = estado.convites.find((c) => c.id === recuperacaoAnterior.id);
    expect(anterior?.cancelled_at).toBe(INSTANTE_FIXO);
    const novo = estado.convites.find((c) => c.id !== recuperacaoAnterior.id) as Invite;
    expect(novo.kind).toBe("recuperacao");
    expect(novo.member_id).toBe(H_CONJUGE);
    expect(novo.household_id).toBe(LAR);
    expect(novo.created_by).toBeNull();
    expect(novo.token_hash).toBe(await sha256Hex(TOKEN_FIXO));
    expect(novo.expires_at).toBe(
      new Date(Date.parse(INSTANTE_FIXO) + MINUTOS_DE_VALIDADE * 60_000).toISOString(),
    );
    expect(MINUTOS_DE_VALIDADE).toBe(60);
    expect(terminal.linhas.join("\n")).toContain(`${URL_DO_WORKER}/recuperar/${TOKEN_FIXO}`);
    expect(terminal.linhas.join("\n")).toContain("serve uma vez só");
  });

  it("o token nunca entra no SQL: só o hash vai para o banco", async () => {
    const pasta = novaPasta();
    gravaEstado(pasta, URL_DO_WORKER);
    const estado = estadoDeRecuperacao({ membros: doisMembros() });
    const { opcoes } = opcoesRecuperacao(pasta, estado, ["s", "1"]);

    await recuperarAcesso(opcoes);

    expect(JSON.stringify(estado.chamadas)).not.toContain(TOKEN_FIXO);
    expect(JSON.stringify(estado.convites)).not.toContain(TOKEN_FIXO);
  });

  it("o SQL só tem literais no formato esperado (ids, hash, instantes e palavras fixas)", async () => {
    const pasta = novaPasta();
    gravaEstado(pasta, URL_DO_WORKER);
    const estado = estadoDeRecuperacao({ membros: doisMembros() });
    const { opcoes } = opcoesRecuperacao(pasta, estado, ["s", "2"]);

    await recuperarAcesso(opcoes);

    const sqls = execucoesD1(estado).map((c) => c.args[c.args.indexOf("--command") + 1]);
    expect(sqls.length).toBeGreaterThanOrEqual(3);
    const formatos = [
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      /^[0-9a-f]{64}$/,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      /^[A-Za-z0-9_-]{1,64}$/,
      /^(recuperacao|primeiro_acesso)$/,
    ];
    for (const sql of sqls) {
      for (const [, literal] of sql.matchAll(/'([^']*)'/g)) {
        expect(
          formatos.some((formato) => formato.test(literal)),
          `${literal} em ${sql}`,
        ).toBe(true);
      }
    }
  });

  it("um id de membro com aspas não entra no SQL: a recuperação para antes da escrita", async () => {
    const pasta = novaPasta();
    gravaEstado(pasta, URL_DO_WORKER);
    const hostis = doisMembros();
    hostis[1].id = "x' OR '1'='1";
    const estado = estadoDeRecuperacao({ membros: hostis });
    const { opcoes, terminal } = opcoesRecuperacao(pasta, estado, ["s", "2"]);

    const codigo = await recuperarAcesso(opcoes);

    expect(codigo).toBe(1);
    expect(estado.convites).toHaveLength(0);
    expect(terminal.linhas.join("\n")).toContain("valor fora do formato esperado no SQL");
  });

  it("sem estado local, pergunta o endereço, tira a barra final e usa o banco <nome>-db", async () => {
    const pasta = novaPasta();
    const estado = estadoDeRecuperacao({ membros: doisMembros() });
    const { opcoes, terminal } = opcoesRecuperacao(pasta, estado, ["s", `${URL_DO_WORKER}/`, "1"]);

    const codigo = await recuperarAcesso(opcoes);

    expect(codigo).toBe(0);
    expect(terminal.linhas.join("\n")).toContain(`${URL_DO_WORKER}/recuperar/${TOKEN_FIXO}`);
    expect(estado.chamadas.some((c) => c.args[1] === "execute" && c.args[2] === NOME_DO_BANCO)).toBe(true);
  });

  it("um endereço digitado que não é workers.dev é recusado antes de qualquer SQL", async () => {
    const pasta = novaPasta();
    const estado = estadoDeRecuperacao({ membros: doisMembros() });
    const { opcoes, terminal } = opcoesRecuperacao(pasta, estado, ["s", "http://exemplo.com"]);

    const codigo = await recuperarAcesso(opcoes);

    expect(codigo).toBe(1);
    expect(terminal.linhas.join("\n")).toContain("Endereço inválido");
    expect(execucoesD1(estado)).toHaveLength(0);
  });
});

describe("SQL da recuperação sempre pelo wrangler.instalacao.jsonc", () => {
  it("com estado local e sem a configuração, gera o arquivo com o uuid do banco antes do primeiro SQL", async () => {
    const pasta = novaPasta();
    gravaEstado(pasta, URL_DO_WORKER);
    const estado = estadoDeRecuperacao({ membros: doisMembros() });
    const { opcoes } = opcoesRecuperacao(pasta, estado, ["s", "2"]);

    const codigo = await recuperarAcesso(opcoes);

    expect(codigo).toBe(0);
    expect(existsSync(join(pasta, CONFIG_DA_INSTALACAO))).toBe(true);
    expect(parse(readFileSync(join(pasta, CONFIG_DA_INSTALACAO), "utf8")).d1_databases[0].database_id).toBe(
      UUID_DO_BANCO,
    );
    expect(execucoesD1(estado).length).toBeGreaterThan(0);
    for (const execucao of execucoesD1(estado)) {
      expect(execucao.args).toContain("--config");
      expect(execucao.args).toContain(CONFIG_DA_INSTALACAO);
    }
  });

  it("sem estado local, com o banco da instalação normal (matrimoney-db), não cai no id-marcador", async () => {
    // Defeito real: o wrangler.jsonc versionado diz database_name matrimoney-db. Sem --config, o SQL iria
    // para o id 00000000-…; no runner falso, esse caminho responde erro, e este teste pega a regressão.
    const pasta = novaPasta();
    const estado = estadoDeRecuperacao({
      bancos: [{ nome: BANCO_DA_INSTALACAO_NORMAL, uuid: UUID_DO_BANCO }],
      membros: doisMembros(),
    });
    const { opcoes, terminal } = opcoesRecuperacao(
      pasta,
      estado,
      ["s", URL_DO_WORKER, "1"],
      ["--nome", "matrimoney"],
    );

    const codigo = await recuperarAcesso(opcoes);

    expect(codigo).toBe(0);
    expect(terminal.linhas.join("\n")).toContain(`${URL_DO_WORKER}/recuperar/${TOKEN_FIXO}`);
    expect(parse(readFileSync(join(pasta, CONFIG_DA_INSTALACAO), "utf8")).d1_databases[0].database_name).toBe(
      BANCO_DA_INSTALACAO_NORMAL,
    );
    for (const execucao of execucoesD1(estado)) {
      expect(execucao.args[2]).toBe(BANCO_DA_INSTALACAO_NORMAL);
      expect(execucao.args).toContain(CONFIG_DA_INSTALACAO);
    }
  });

  it("com estado local de instalação normal e sem a configuração, também gera e usa o arquivo", async () => {
    const pasta = novaPasta();
    gravaEstado(pasta, URL_DO_WORKER, BANCO_DA_INSTALACAO_NORMAL, "matrimoney");
    const estado = estadoDeRecuperacao({
      bancos: [{ nome: BANCO_DA_INSTALACAO_NORMAL, uuid: UUID_DO_BANCO }],
      membros: doisMembros(),
    });
    const { opcoes } = opcoesRecuperacao(pasta, estado, ["s", "2"]);

    const codigo = await recuperarAcesso(opcoes);

    expect(codigo).toBe(0);
    for (const execucao of execucoesD1(estado)) {
      expect(execucao.args).toContain(CONFIG_DA_INSTALACAO);
    }
  });

  it("com o arquivo já existente (da instalação), não consulta a lista de bancos", async () => {
    const pasta = novaPasta();
    gravaEstado(pasta, URL_DO_WORKER);
    writeFileSync(
      join(pasta, CONFIG_DA_INSTALACAO),
      geraConfigDaInstalacao(WRANGLER_DO_APP, {
        nome: "matrimoney-teste",
        bancoNome: NOME_DO_BANCO,
        bancoId: UUID_DO_BANCO,
      }),
    );
    const estado = estadoDeRecuperacao({ membros: doisMembros() });
    const { opcoes } = opcoesRecuperacao(pasta, estado, ["s", "1"]);

    await recuperarAcesso(opcoes);

    expect(estado.chamadas.filter((c) => c.args[0] === "d1" && c.args[1] === "list")).toHaveLength(0);
    for (const execucao of execucoesD1(estado)) {
      expect(execucao.args).toContain(CONFIG_DA_INSTALACAO);
    }
  });

  it("se o banco não existe na conta, para com mensagem clara e não faz SQL", async () => {
    const pasta = novaPasta();
    gravaEstado(pasta, URL_DO_WORKER);
    const estado = estadoInicial({ membros: doisMembros(), bancos: [] });
    const { opcoes, terminal } = opcoesRecuperacao(pasta, estado, ["s"]);

    const codigo = await recuperarAcesso(opcoes);

    expect(codigo).toBe(1);
    expect(terminal.linhas.join("\n")).toContain(
      `Não achei o banco ${NOME_DO_BANCO} na sua conta da Cloudflare`,
    );
    expect(execucoesD1(estado)).toHaveLength(0);
  });
});

describe("recuperar sem membros (cenário 10)", () => {
  it("manda usar o código de primeiro acesso e não gera link", async () => {
    const pasta = novaPasta();
    gravaEstado(pasta, URL_DO_WORKER);
    const estado = estadoDeRecuperacao({ membros: [] });
    const { opcoes, terminal } = opcoesRecuperacao(pasta, estado, ["s"]);

    const codigo = await recuperarAcesso(opcoes);

    expect(codigo).toBe(1);
    expect(terminal.linhas).toContain(
      "Ninguém cadastrou acesso ainda: use o código de primeiro acesso (rode npm run instalar).",
    );
    expect(estado.convites).toHaveLength(0);
  });
});

describe("conta de recuperação", () => {
  it("sem autenticação, para antes de listar membros", async () => {
    const pasta = novaPasta();
    gravaEstado(pasta, URL_DO_WORKER);
    const estado = estadoDeRecuperacao({ autenticado: false, membros: doisMembros() });
    const { opcoes, terminal } = opcoesRecuperacao(pasta, estado, []);

    const codigo = await recuperarAcesso(opcoes);

    expect(codigo).toBe(1);
    expect(terminal.linhas.join("\n")).toContain("Sem autenticação na Cloudflare");
    expect(estado.chamadas.map((c) => c.args[0])).toEqual(["whoami"]);
  });
});
