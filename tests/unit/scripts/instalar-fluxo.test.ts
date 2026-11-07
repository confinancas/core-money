import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { afterEach, describe, expect, it } from "vitest";
import { instalar, MENSAGEM_SEM_SUBDOMINIO } from "../../../scripts/instalar";
import { CONFIG_DA_INSTALACAO } from "../../../scripts/lib/config-instalacao";
import { normalizeAccessCode, sha256Hex } from "../../../src/shared/access-code";
import {
  CHAVE_MESTRA_FIXA,
  CODIGO_FIXO,
  criaPastaDoApp,
  criaTerminalFalso,
  type EstadoFalso,
  estadoInicial,
  leArquivo,
  MARCA_DE_TESTE,
  NOME_DO_BANCO,
  opcoesDeInstalacao,
  removePastaDoApp,
  URL_DO_WORKER,
} from "./helpers/cloudflare-falso";

// Cenários 1 a 7 e 11 da TASK-0101, com o runner falso da Cloudflare (nada de rede).
const pastas: string[] = [];

function novaPasta(): string {
  const pasta = criaPastaDoApp();
  pastas.push(pasta);
  return pasta;
}

afterEach(() => {
  for (const pasta of pastas.splice(0)) removePastaDoApp(pasta);
});

// Todos os arquivos de uma pasta, em texto, para o cenário 11.
function todosOsArquivos(pasta: string): { caminho: string; conteudo: string }[] {
  const saida: { caminho: string; conteudo: string }[] = [];
  const percorre = (atual: string) => {
    for (const nome of readdirSync(atual)) {
      const caminho = join(atual, nome);
      if (statSync(caminho).isDirectory()) percorre(caminho);
      else saida.push({ caminho, conteudo: readFileSync(caminho, "utf8") });
    }
  };
  percorre(pasta);
  return saida;
}

const chamadasDo = (estado: EstadoFalso, primeiro: string, segundo?: string) =>
  estado.chamadas.filter((c) => c.args[0] === primeiro && (segundo === undefined || c.args[1] === segundo));

describe("primeira instalação (cenário 1)", () => {
  it("cria o banco em ENAM, aplica migrações, publica, grava a chave e um único primeiro acesso", async () => {
    const pasta = novaPasta();
    const wranglerAntes = leArquivo(pasta, "wrangler.jsonc");
    const estado = estadoInicial();
    const { terminal, linhas } = criaTerminalFalso(["s", "s"]);

    const codigo = await instalar(opcoesDeInstalacao({ pastaApp: pasta, estado, terminal }));

    expect(codigo).toBe(0);
    expect(chamadasDo(estado, "d1", "create")[0].args).toEqual([
      "d1",
      "create",
      NOME_DO_BANCO,
      "--location",
      "enam",
    ]);
    expect(estado.migracoesAplicadas).toBe(1);
    expect(chamadasDo(estado, "deploy")).toHaveLength(1);
    expect(estado.segredos.get("MASTER_KEY")).toBe(CHAVE_MESTRA_FIXA);
    expect(estado.convites).toHaveLength(1);
    expect(estado.convites[0].kind).toBe("primeiro_acesso");
    expect(estado.convites[0].household_id).toBeNull();
    expect(estado.convites[0].token_hash).toBe(await sha256Hex(normalizeAccessCode(CODIGO_FIXO)));
    expect(linhas.join("\n")).toContain(URL_DO_WORKER);
    expect(linhas.join("\n")).toContain(CODIGO_FIXO);
    expect(leArquivo(pasta, "wrangler.jsonc")).toBe(wranglerAntes);
    expect(existsSync(join(pasta, CONFIG_DA_INSTALACAO))).toBe(true);
    expect(parse(leArquivo(pasta, CONFIG_DA_INSTALACAO)).d1_databases[0].database_name).toBe(NOME_DO_BANCO);
    const estadoGravado = JSON.parse(leArquivo(pasta, ".core-money/instalacao.json"));
    expect(estadoGravado.url).toBe(URL_DO_WORKER);
    expect(estadoGravado.marca).toBe(MARCA_DE_TESTE.id);
  });

  it("grava o estado numa pasta fixa, .core-money, e não numa pasta com o nome da marca", async () => {
    const pasta = novaPasta();
    const estado = estadoInicial();
    const { terminal } = criaTerminalFalso(["s", "s"]);

    await instalar(opcoesDeInstalacao({ pastaApp: pasta, estado, terminal }));

    expect(existsSync(join(pasta, ".core-money", "instalacao.json"))).toBe(true);
    expect(existsSync(join(pasta, `.${MARCA_DE_TESTE.id}`))).toBe(false);
  });

  it("usa o código gerado pelo gerador e não guarda o código em texto no banco", async () => {
    const pasta = novaPasta();
    const estado = estadoInicial();
    const { terminal } = criaTerminalFalso(["s", "s"]);

    await instalar(opcoesDeInstalacao({ pastaApp: pasta, estado, terminal }));

    const armazenado = JSON.stringify(estado.convites);
    expect(armazenado).not.toContain(CODIGO_FIXO);
    expect(armazenado).not.toContain(normalizeAccessCode(CODIGO_FIXO));
  });
});

describe("conta sem subdomínio (cenário 2)", () => {
  it("explica o subdomínio, sai com erro e não gera código", async () => {
    const pasta = novaPasta();
    const estado = estadoInicial({ subdominioRegistrado: false });
    const { terminal, linhas } = criaTerminalFalso(["s"]);

    const codigo = await instalar(opcoesDeInstalacao({ pastaApp: pasta, estado, terminal }));

    expect(codigo).toBe(1);
    expect(linhas).toContain(MENSAGEM_SEM_SUBDOMINIO);
    expect(linhas.join("\n")).toContain("Sua conta ainda não tem um subdomínio workers.dev");
    expect(estado.convites).toHaveLength(0);
    expect(estado.segredos.size).toBe(0);
    expect(existsSync(join(pasta, ".core-money", "instalacao.json"))).toBe(false);
  });
});

describe("endereço recusado (cenário 3)", () => {
  it("com n para o endereço, não gera código e explica como trocar o subdomínio", async () => {
    const pasta = novaPasta();
    const estado = estadoInicial();
    const { terminal, linhas } = criaTerminalFalso(["s", "n"]);

    const codigo = await instalar(opcoesDeInstalacao({ pastaApp: pasta, estado, terminal }));

    expect(codigo).toBe(1);
    expect(estado.convites).toHaveLength(0);
    expect(linhas.join("\n")).toContain("Nada foi gerado");
    expect(linhas.join("\n")).toContain("Workers e Pages › Subdomínio");
    expect(existsSync(join(pasta, ".core-money", "instalacao.json"))).toBe(false);
  });
});

describe("rodar de novo antes de configurar (cenário 4)", () => {
  it("gera um código novo, cancela o antigo e não regrava a chave mestra", async () => {
    const pasta = novaPasta();
    const estado = estadoInicial();
    await instalar(
      opcoesDeInstalacao({ pastaApp: pasta, estado, terminal: criaTerminalFalso(["s", "s"]).terminal }),
    );

    // Segunda rodada: o estado local já tem o endereço, então não há pergunta. Se houver, o runner falha.
    const { terminal, linhas, perguntas } = criaTerminalFalso(["s"]);
    const codigo = await instalar(opcoesDeInstalacao({ pastaApp: pasta, estado, terminal }));

    expect(codigo).toBe(0);
    expect(perguntas).toEqual(["Continuar? (s/n) "]);
    expect(estado.convites).toHaveLength(2);
    expect(estado.convites[0].cancelled_at).not.toBeNull();
    expect(estado.convites[1].cancelled_at).toBeNull();
    expect(chamadasDo(estado, "secret", "put")).toHaveLength(1);
    expect(linhas.join("\n")).toContain(CODIGO_FIXO);
  });
});

describe("atualização depois de configurado (cenário 5)", () => {
  it("roda migrações e deploy, não gera código e diz que a atualização está concluída", async () => {
    const pasta = novaPasta();
    const estado = estadoInicial();
    await instalar(
      opcoesDeInstalacao({ pastaApp: pasta, estado, terminal: criaTerminalFalso(["s", "s"]).terminal }),
    );
    estado.convites[0].used_at = "2026-11-07T13:00:00.000Z";
    const convitesAntes = estado.convites.length;

    // Só a confirmação da conta é perguntada: sem o endereço, sem código. Outra pergunta esgota a fila e falha.
    const { terminal, linhas, perguntas } = criaTerminalFalso(["s"]);
    const codigo = await instalar(opcoesDeInstalacao({ pastaApp: pasta, estado, terminal }));

    expect(codigo).toBe(0);
    expect(perguntas).toEqual(["Continuar? (s/n) "]);
    expect(estado.migracoesAplicadas).toBe(2);
    expect(chamadasDo(estado, "deploy")).toHaveLength(2);
    expect(estado.convites).toHaveLength(convitesAntes);
    expect(linhas.join("\n")).toContain(`Atualização concluída: versão 9.9.9 publicada em ${URL_DO_WORKER}.`);
  });
});

describe("endereço mudou depois de configurado (cenário 6)", () => {
  it("avisa em destaque, sai com código 2 e não troca o endereço guardado", async () => {
    const pasta = novaPasta();
    const antigo = "https://matrimoney-antigo.subdominio-de-teste.workers.dev";
    const estado = estadoInicial({
      convites: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          household_id: null,
          kind: "primeiro_acesso",
          token_hash: "a".repeat(64),
          member_id: null,
          created_by: null,
          created_at: "2026-11-06T10:00:00.000Z",
          expires_at: null,
          used_at: "2026-11-06T11:00:00.000Z",
          cancelled_at: null,
        },
      ],
    });
    mkdirSync(join(pasta, ".core-money"));
    writeFileSync(
      join(pasta, ".core-money", "instalacao.json"),
      JSON.stringify({
        nome: "matrimoney-teste",
        marca: "marca-teste",
        databaseName: NOME_DO_BANCO,
        databaseId: "11111111-2222-3333-4444-555555555555",
        url: antigo,
        contaId: "0123456789abcdef0123456789abcdef",
        atualizadoEm: "2026-11-06T10:00:00.000Z",
      }),
    );
    const { terminal, linhas, perguntas } = criaTerminalFalso(["s"]);

    const codigo = await instalar(opcoesDeInstalacao({ pastaApp: pasta, estado, terminal }));

    expect(codigo).toBe(2);
    expect(perguntas).toEqual(["Continuar? (s/n) "]);
    expect(linhas.join("\n")).toContain(`Atenção: o endereço mudou de ${antigo} para ${URL_DO_WORKER}.`);
    expect(JSON.parse(leArquivo(pasta, ".core-money/instalacao.json")).url).toBe(antigo);
  });
});

describe("sem autenticação (cenário 7)", () => {
  it("explica o .env e o npx wrangler login, sai com código 1 e não toca em nada da conta", async () => {
    const pasta = novaPasta();
    const estado = estadoInicial({ autenticado: false });
    const { terminal, linhas } = criaTerminalFalso([]);

    const codigo = await instalar(opcoesDeInstalacao({ pastaApp: pasta, estado, terminal }));

    expect(codigo).toBe(1);
    expect(linhas.join("\n")).toContain("Sem autenticação na Cloudflare");
    expect(linhas.join("\n")).toContain("CLOUDFLARE_API_TOKEN");
    expect(linhas.join("\n")).toContain("npx wrangler login");
    expect(estado.chamadas.map((c) => c.args[0])).toEqual(["whoami"]);
  });
});

describe("falha ao gravar o convite (passo 7)", () => {
  it("se o INSERT do código falha, sai com 1, não grava o estado e não imprime o código", async () => {
    const pasta = novaPasta();
    const estado = estadoInicial({ falhaAoInserirConvite: true });
    const { terminal, linhas } = criaTerminalFalso(["s", "s"]);

    const codigo = await instalar(opcoesDeInstalacao({ pastaApp: pasta, estado, terminal }));

    expect(codigo).toBe(1);
    expect(existsSync(join(pasta, ".core-money", "instalacao.json"))).toBe(false);
    expect(linhas.join("\n")).not.toContain(CODIGO_FIXO);
    expect(linhas.join("\n")).toContain("erro simulado ao gravar o convite");
  });
});

describe("entradas inválidas", () => {
  it("sem marca.json, diz o que fazer e sai com código 1", async () => {
    const pasta = novaPasta();
    rmSync(join(pasta, "marca.json"));
    const { terminal, linhas } = criaTerminalFalso([]);

    const codigo = await instalar(opcoesDeInstalacao({ pastaApp: pasta, estado: estadoInicial(), terminal }));

    expect(codigo).toBe(1);
    expect(linhas.join("\n")).toContain("Sem marca.json nesta pasta");
  });

  it("sem wrangler.jsonc, para antes de criar o banco na Cloudflare", async () => {
    const pasta = novaPasta();
    rmSync(join(pasta, "wrangler.jsonc"));
    const estado = estadoInicial();
    const { terminal, linhas } = criaTerminalFalso(["s"]);

    const codigo = await instalar(opcoesDeInstalacao({ pastaApp: pasta, estado, terminal }));

    expect(codigo).toBe(1);
    expect(linhas.join("\n")).toContain("Sem wrangler.jsonc nesta pasta");
    expect(estado.bancos).toHaveLength(0);
    expect(chamadasDo(estado, "d1", "create")).toHaveLength(0);
  });

  it("com Node abaixo de 22, recusa antes de mexer em qualquer coisa", async () => {
    const pasta = novaPasta();
    const estado = estadoInicial();
    const { terminal, linhas } = criaTerminalFalso([]);

    const codigo = await instalar(
      opcoesDeInstalacao({ pastaApp: pasta, estado, terminal, versaoDoNode: "20.11.0" }),
    );

    expect(codigo).toBe(1);
    expect(linhas.join("\n")).toContain("Precisa de Node 22");
    expect(estado.chamadas).toHaveLength(0);
  });

  it("um --nome inválido sai antes de chamar o wrangler", async () => {
    const pasta = novaPasta();
    const estado = estadoInicial();
    const { terminal, linhas } = criaTerminalFalso([]);

    const codigo = await instalar(
      opcoesDeInstalacao({ pastaApp: pasta, estado, terminal, argumentos: ["--nome", "Nome Com Espaco"] }),
    );

    expect(codigo).toBe(1);
    expect(linhas.join("\n")).toContain("Nome inválido");
    expect(estado.chamadas).toHaveLength(0);
  });

  it("--nome escolhe o nome do Worker e do banco, e --sim responde as confirmações", async () => {
    const pasta = novaPasta();
    const estado = estadoInicial();
    const { terminal } = criaTerminalFalso([]);

    const codigo = await instalar(
      opcoesDeInstalacao({ pastaApp: pasta, estado, terminal, argumentos: ["--nome", "outro-app", "--sim"] }),
    );

    expect(codigo).toBe(0);
    expect(estado.bancos.map((b) => b.nome)).toEqual(["outro-app-db"]);
    expect(parse(leArquivo(pasta, CONFIG_DA_INSTALACAO)).name).toBe("outro-app");
  });
});

describe("segredo fora da saída (cenário 11)", () => {
  it("a chave mestra aparece só no stdin do secret put, e em nenhuma outra chamada, linha ou arquivo", async () => {
    const pasta = novaPasta();
    const estado = estadoInicial();
    const { terminal, linhas } = criaTerminalFalso(["s", "s"]);

    const codigo = await instalar(opcoesDeInstalacao({ pastaApp: pasta, estado, terminal }));

    expect(codigo).toBe(0);
    const puts = chamadasDo(estado, "secret", "put");
    expect(puts).toHaveLength(1);
    expect(puts[0].entrada).toBe(CHAVE_MESTRA_FIXA);

    const outrasChamadas = estado.chamadas.filter((c) => c !== puts[0]);
    for (const chamada of outrasChamadas) {
      expect(JSON.stringify(chamada)).not.toContain(CHAVE_MESTRA_FIXA);
    }
    expect(linhas.join("\n")).not.toContain(CHAVE_MESTRA_FIXA);
    for (const arquivo of todosOsArquivos(pasta)) {
      expect(arquivo.conteudo, arquivo.caminho).not.toContain(CHAVE_MESTRA_FIXA);
    }
  });

  it("se o secret put falhar e ecoar o valor, a saída do erro traz a marca no lugar da chave", async () => {
    const pasta = novaPasta();
    const estado = estadoInicial({ falhaAoGravarSegredo: true });
    const { terminal, linhas } = criaTerminalFalso(["s", "s"]);

    const codigo = await instalar(opcoesDeInstalacao({ pastaApp: pasta, estado, terminal }));

    expect(codigo).toBe(1);
    expect(linhas.join("\n")).toContain("<valor-mascarado>");
    expect(linhas.join("\n")).not.toContain(CHAVE_MESTRA_FIXA);
    expect(estado.convites).toHaveLength(0);
    for (const arquivo of todosOsArquivos(pasta)) {
      expect(arquivo.conteudo, arquivo.caminho).not.toContain(CHAVE_MESTRA_FIXA);
    }
  });
});
