import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  caminhoDoWrangler,
  criaWrangler,
  ErroDeSubdominio,
  ErroDoWrangler,
  type Execucao,
  ehErroDeSubdominio,
  extraiUrlDoDeploy,
  interpretaD1Execute,
  interpretaD1List,
  interpretaSecretList,
  interpretaWhoami,
  mascara,
} from "../../../scripts/lib/wrangler";

// Fixtures sintéticas, no formato que o wrangler 4 imprime. Nenhum e-mail, id de conta ou URL é real.
const CONTA_DE_TESTE = { id: "0123456789abcdef0123456789abcdef", name: "[TEST] Conta de teste" };

const WHOAMI_COM_CONTA = JSON.stringify({
  loggedIn: true,
  authType: "Account API Token",
  email: "exemplo@example.com",
  accounts: [CONTA_DE_TESTE],
});

const WHOAMI_SEM_AUTENTICACAO = '{"loggedIn":false}';

const D1_LIST_COM_BANCO = JSON.stringify(
  [
    { uuid: "11111111-2222-3333-4444-555555555555", name: "matrimoney-teste-db", version: "production" },
    { uuid: "66666666-7777-8888-9999-000000000000", name: "outro-banco", version: "production" },
  ],
  null,
  2,
);

const D1_LIST_SEM_BANCO = "[]";

const D1_EXECUTE_CONTAGEM = [
  "⛅️ wrangler 4.158.0",
  JSON.stringify(
    [{ results: [{ n: 0 }], success: true, meta: { duration: 0.4, rows_read: 1, rows_written: 0 } }],
    null,
    2,
  ),
].join("\n");

const SECRET_LIST_COM_CHAVE = JSON.stringify([
  { name: "MASTER_KEY", type: "secret_text" },
  { name: "OUTRO_SEGREDO", type: "secret_text" },
]);

const SECRET_LIST_VAZIO = "[]";

const DEPLOY_COM_VERSAO = [
  "Total Upload: 120.00 KiB / gzip: 30.00 KiB",
  "Uploaded matrimoney-teste (2.10 sec)",
  "Deployed matrimoney-teste triggers (0.40 sec)",
  "  https://0a1b2c3d-matrimoney-teste.subdominio-de-teste.workers.dev",
  "Current Version ID: 0a1b2c3d-0000-1111-2222-333344445555",
  "  https://matrimoney-teste.subdominio-de-teste.workers.dev",
].join("\n");

const DEPLOY_SEM_SUBDOMINIO = [
  "Uploaded matrimoney-teste (2.10 sec)",
  "▲ [WARNING] You need to register a workers.dev subdomain before publishing to workers.dev",
  "Would you like to register a workers.dev subdomain now? (y/n)",
  "🤖 Using fallback value in non-interactive context: no",
  "X [ERROR] You need to register a workers.dev subdomain before publishing to workers.dev",
].join("\n");

describe("whoami", () => {
  it("lê a conta de uma autenticação válida", () => {
    expect(interpretaWhoami(WHOAMI_COM_CONTA, "")).toEqual({
      autenticada: true,
      contas: [{ id: CONTA_DE_TESTE.id, nome: CONTA_DE_TESTE.name }],
    });
  });

  it("reconhece a falta de autenticação pelo loggedIn falso", () => {
    expect(interpretaWhoami("", WHOAMI_SEM_AUTENTICACAO)).toEqual({ autenticada: false });
  });

  it("lança erro quando a saída não traz o JSON esperado", () => {
    expect(() => interpretaWhoami("saída qualquer", "outra coisa")).toThrow(ErroDoWrangler);
  });
});

describe("d1 list --json", () => {
  it("acha o banco pelo nome e devolve o uuid", () => {
    const bancos = interpretaD1List(D1_LIST_COM_BANCO);

    expect(bancos.find((banco) => banco.nome === "matrimoney-teste-db")?.uuid).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });

  it("lista vazia não tem bancos", () => {
    expect(interpretaD1List(D1_LIST_SEM_BANCO)).toEqual([]);
  });
});

describe("d1 execute --json", () => {
  it("devolve as linhas do primeiro comando, mesmo com uma linha de banner antes", () => {
    expect(interpretaD1Execute(D1_EXECUTE_CONTAGEM)).toEqual([{ n: 0 }]);
  });

  it("lança erro quando a saída não tem linhas", () => {
    expect(() => interpretaD1Execute('[{"success": true}]')).toThrow(ErroDoWrangler);
  });
});

describe("secret list --format json", () => {
  it("acha o nome de MASTER_KEY quando existe", () => {
    expect(interpretaSecretList(SECRET_LIST_COM_CHAVE)).toContain("MASTER_KEY");
  });

  it("sem segredos, a lista volta vazia", () => {
    expect(interpretaSecretList(SECRET_LIST_VAZIO)).toEqual([]);
  });
});

describe("URL do deploy", () => {
  it("pega a URL do Worker, e não a de uma versão", () => {
    expect(extraiUrlDoDeploy(DEPLOY_COM_VERSAO, "matrimoney-teste")).toBe(
      "https://matrimoney-teste.subdominio-de-teste.workers.dev",
    );
  });

  it("sem nenhuma URL, devolve undefined", () => {
    expect(extraiUrlDoDeploy("Deployed sem endereço", "matrimoney-teste")).toBeUndefined();
  });

  it("reconhece o erro de conta sem subdomínio workers.dev", () => {
    expect(ehErroDeSubdominio(DEPLOY_SEM_SUBDOMINIO)).toBe(true);
    expect(ehErroDeSubdominio(DEPLOY_COM_VERSAO)).toBe(false);
  });
});

describe("criaWrangler", () => {
  it("deploy sem subdomínio vira ErroDeSubdominio, sem URL", async () => {
    const execucao: Execucao = async () => ({ codigo: 1, stdout: "", stderr: DEPLOY_SEM_SUBDOMINIO });
    const wrangler = criaWrangler(execucao);

    await expect(wrangler.deploy("wrangler.instalacao.jsonc", "matrimoney-teste")).rejects.toBeInstanceOf(
      ErroDeSubdominio,
    );
  });

  it("a chave do secret put vai só pelo stdin, e a falha a mascara na mensagem", async () => {
    const chave = "Q2hhdmVTZWNyZXRhRGVUZXN0ZUFxdWk=";
    const chamadas: { args: string[]; entrada?: string }[] = [];
    const execucao: Execucao = async (args, opcoes) => {
      chamadas.push({ args, entrada: opcoes?.entrada });
      // Um erro hostil que ecoa o valor: a mensagem não pode trazê-lo.
      return { codigo: 1, stdout: "", stderr: `falhou ao gravar ${chave}` };
    };
    const wrangler = criaWrangler(execucao);

    const erro = await wrangler
      .gravaSegredo("MASTER_KEY", chave, "wrangler.instalacao.jsonc")
      .catch((e) => e);

    expect(erro).toBeInstanceOf(ErroDoWrangler);
    expect(erro.message).not.toContain(chave);
    expect(erro.message).toContain("<valor-mascarado>");
    expect(chamadas[0].entrada).toBe(chave);
    expect(chamadas[0].args).not.toContain(chave);
  });

  it("o caminho do wrangler sai do pacote instalado, dentro de bin", () => {
    expect(caminhoDoWrangler()).toMatch(/wrangler[\\/]bin[\\/]wrangler\.js$/);
    expect(existsSync(caminhoDoWrangler())).toBe(true);
  });
});

describe("mascara", () => {
  it("troca cada segredo pelo marcador e não mexe no resto", () => {
    expect(mascara("a=segredo-1 b=segredo-2", ["segredo-1", "segredo-2"])).toBe(
      "a=<valor-mascarado> b=<valor-mascarado>",
    );
  });
});
