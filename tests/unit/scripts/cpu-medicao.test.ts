import { describe, expect, it } from "vitest";
import type { Rota } from "../../../scripts/dev/cpu-medicao.d.mts";
import {
  avaliaResultados,
  escolheLar,
  impressaoDoLar,
  mediaTail,
  ordemDeEsvaziamento,
  rotasParaRemedir,
  sohLeitura,
  TABELA_DA_MEDICAO,
} from "../../../scripts/dev/cpu-medicao.mjs";

const SETUP = [
  "INSERT INTO households (id, brand, created_at) VALUES ('cpu-lar', 'matrimoney', '2026-11-10T00:00:00.000Z')",
  "INSERT INTO members (id, household_id, name) VALUES ('cpu-membro-1', 'cpu-lar', '[TEST] Pessoa A')",
];
const MIGRACOES = [
  { nome: "0000_household.sql", conteudo: "CREATE TABLE households (id TEXT PRIMARY KEY);" },
  { nome: "0001_bank.sql", conteudo: "CREATE TABLE banks (id TEXT PRIMARY KEY);" },
];
const CODIGO = "async function esvaziaBanco() {}";

const base = { setupSql: SETUP, migracoes: MIGRACOES, esvaziarBanco: true, codigoDoEsvaziamento: CODIGO };

const GET_CARDS: Rota = { name: "GET /api/cards", method: "GET", path: "/api/cards" };
const GET_CARD: Rota = { name: "GET /api/cards/:id", method: "GET", path: "/api/cards/cpu-cartao" };
const POST_RENDA: Rota = { name: "POST /api/fixed-incomes", method: "POST", path: "/api/fixed-incomes" };
const DELETE_RENDA: Rota = {
  name: "DELETE /api/fixed-incomes/:id",
  method: "DELETE",
  path: "/api/fixed-incomes/cpu-renda-{i}",
};

// Um evento do tail, como o Cloudflare o entrega (só os campos que o script lê).
function evento(metodo: string, caminho: string, ts: number, cpu: number | undefined) {
  const objeto: Record<string, unknown> = {
    eventTimestamp: ts,
    event: { request: { method: metodo, url: `https://exemplo.test${caminho}` } },
  };
  if (cpu !== undefined) objeto.cpuTime = cpu;
  return objeto;
}

// Doze eventos de uma rota (dois de aquecimento e dez medidas), com CPU crescente de 1 a 12.
function rodadas(rota: Rota, caminhoDaRodada: (i: number) => string, inicio: number) {
  return Array.from({ length: 12 }, (_, i) => evento(rota.method, caminhoDaRodada(i + 1), inicio + i, i + 1));
}

const textoDe = (objetos: unknown[]) => objetos.map((objeto) => JSON.stringify(objeto)).join("\n");

describe("impressaoDoLar", () => {
  it("é a mesma para os mesmos insumos", () => {
    expect(impressaoDoLar(base)).toBe(impressaoDoLar({ ...base }));
  });

  it("muda quando uma linha do setupSql muda", () => {
    const trocada = [SETUP[0], SETUP[1].replace("[TEST] Pessoa A", "[TEST] Pessoa B")];
    expect(impressaoDoLar({ ...base, setupSql: trocada })).not.toBe(impressaoDoLar(base));
  });

  it("muda quando uma migração muda de conteúdo, de nome ou quando entra uma nova", () => {
    const conteudo = [
      { nome: MIGRACOES[0].nome, conteudo: "CREATE TABLE households (id TEXT);" },
      MIGRACOES[1],
    ];
    const nome = [{ nome: "0000_casa.sql", conteudo: MIGRACOES[0].conteudo }, MIGRACOES[1]];
    const nova = [...MIGRACOES, { nome: "0002_novo.sql", conteudo: "CREATE TABLE x (id TEXT);" }];
    const original = impressaoDoLar(base);
    expect(impressaoDoLar({ ...base, migracoes: conteudo })).not.toBe(original);
    expect(impressaoDoLar({ ...base, migracoes: nome })).not.toBe(original);
    expect(impressaoDoLar({ ...base, migracoes: nova })).not.toBe(original);
  });

  it("muda com o valor de esvaziarBanco e com o código que esvazia o banco", () => {
    const original = impressaoDoLar(base);
    expect(impressaoDoLar({ ...base, esvaziarBanco: false })).not.toBe(original);
    expect(impressaoDoLar({ ...base, codigoDoEsvaziamento: "async function outra() {}" })).not.toBe(original);
  });
});

describe("escolheLar", () => {
  const arquivoSoGet = { requests: [GET_CARDS, GET_CARD] };

  it("só GET, sem fluxo, com a mesma impressão: reaproveita", () => {
    const escolha = escolheLar({ impressaoDoBanco: "abc", impressaoDoArquivo: "abc", ...arquivoSoGet });
    expect(escolha.modo).toBe("reaproveitar");
  });

  it.each([
    ["POST", POST_RENDA],
    ["DELETE", DELETE_RENDA],
    ["PATCH", { name: "PATCH", method: "PATCH", path: "/api/fixed-incomes/cpu-renda-12" }],
    ["PUT", { name: "PUT", method: "PUT", path: "/api/settings/keys/claude" }],
  ])("com %s, grava mesmo com a mesma impressão", (_metodo, rota) => {
    const escolha = escolheLar({
      impressaoDoBanco: "abc",
      impressaoDoArquivo: "abc",
      requests: [GET_CARDS, rota],
    });
    expect(escolha.modo).toBe("gravar");
    expect(escolha.motivo).toContain("não é GET");
  });

  it("com impressão diferente, grava mesmo só com GET", () => {
    const escolha = escolheLar({ impressaoDoBanco: "antiga", impressaoDoArquivo: "nova", ...arquivoSoGet });
    expect(escolha.modo).toBe("gravar");
    expect(escolha.motivo).toContain("mudaram");
  });

  it("sem impressão no banco, grava", () => {
    expect(escolheLar({ impressaoDoBanco: null, impressaoDoArquivo: "abc", ...arquivoSoGet }).modo).toBe(
      "gravar",
    );
  });

  it("com fluxo de navegador, grava mesmo só com GET e a mesma impressão", () => {
    const escolha = escolheLar({
      impressaoDoBanco: "abc",
      impressaoDoArquivo: "abc",
      ...arquivoSoGet,
      flows: [{ name: "login", runs: 12 }],
    });
    expect(escolha.modo).toBe("gravar");
    expect(escolha.motivo).toContain("fluxo de navegador");
  });

  it("uma rota de fluxo (via) não conta como leitura", () => {
    const comVia: Rota = { ...GET_CARD, via: "login" };
    expect(sohLeitura({ requests: [GET_CARDS, comVia] })).toBe(false);
  });

  it("sohLeitura é verdadeira só para GET sem fluxo", () => {
    expect(sohLeitura({ requests: [GET_CARDS, GET_CARD] })).toBe(true);
    expect(sohLeitura({ requests: [GET_CARDS, POST_RENDA] })).toBe(false);
    expect(sohLeitura({ requests: [GET_CARDS], flows: [{ name: "login", runs: 1 }] })).toBe(false);
  });
});

describe("junção dos eventos e nova tentativa (evento perdido)", () => {
  const ROTAS: Rota[] = [GET_CARDS, DELETE_RENDA];

  it("uma rota com evento descartado é medida de novo uma vez, e depois a medição fecha", () => {
    const tailDaRodada = [
      ...rodadas(GET_CARDS, () => "/api/cards", 1000),
      ...rodadas(DELETE_RENDA, (i) => `/api/fixed-incomes/cpu-renda-${i}`, 2000),
    ];
    // O tail "perde" o quinto evento da primeira rota.
    const lido = tailDaRodada.filter((_, indice) => indice !== 6);
    const primeira = mediaTail(ROTAS, textoDe(lido));
    expect(primeira[0].faltou).toBe(true);
    expect(primeira[1].faltou).toBe(false);

    const jaRemedidas = new Set<Rota>();
    const aRemedir = rotasParaRemedir(ROTAS, primeira, jaRemedidas);
    expect(aRemedir).toEqual([GET_CARDS]);

    // A nova tentativa da rota, com o mesmo tail aberto: os eventos novos se somam aos que já chegaram.
    jaRemedidas.add(GET_CARDS);
    const novos = rodadas(GET_CARDS, () => "/api/cards", 5000);
    const depois = mediaTail(ROTAS, textoDe([...lido, ...novos]));
    expect(depois[0].faltou).toBe(false);
    expect(depois[0].medianaMs).toBeGreaterThan(0);
    expect(rotasParaRemedir(ROTAS, depois, jaRemedidas)).toEqual([]);
    expect(avaliaResultados(depois).ok).toBe(true);
  });

  it("se a nova tentativa também perde evento, não tenta de novo e falha com faltou evento", () => {
    const lido = rodadas(GET_CARDS, () => "/api/cards", 1000).slice(0, 7);
    const primeira = mediaTail([GET_CARDS], textoDe(lido));
    const jaRemedidas = new Set<Rota>([GET_CARDS]);
    expect(rotasParaRemedir([GET_CARDS], primeira, jaRemedidas)).toEqual([]);
    const veredito = avaliaResultados(primeira);
    expect(veredito.ok).toBe(false);
    expect(veredito.faltaram).toEqual(["GET /api/cards"]);
  });

  it("o evento sem CPU conta como perdido, e a rota é medida de novo", () => {
    const semCpu = rodadas(GET_CARDS, () => "/api/cards", 1000).map((objeto, indice) =>
      indice === 4 ? evento("GET", "/api/cards", 1004, undefined) : objeto,
    );
    const resultado = mediaTail([GET_CARDS], textoDe(semCpu));
    expect(resultado[0].faltou).toBe(true);
    expect(rotasParaRemedir([GET_CARDS], resultado, new Set())).toEqual([GET_CARDS]);
  });

  it("uma mediana acima do limite falha, mesmo com todos os eventos", () => {
    const pesados = Array.from({ length: 12 }, (_, i) => evento("GET", "/api/cards", 1000 + i, 15));
    const veredito = avaliaResultados(mediaTail([GET_CARDS], textoDe(pesados)));
    expect(veredito.ok).toBe(false);
    expect(veredito.acima).toEqual(["GET /api/cards"]);
  });

  it("a rota com {i} casa com qualquer número, e os eventos de outro método não entram", () => {
    const objetos = [
      ...rodadas(DELETE_RENDA, (i) => `/api/fixed-incomes/cpu-renda-${i}`, 1000),
      // Um GET com CPU de 99 ms no mesmo caminho: não é DELETE, então não pode subir a máxima.
      evento("GET", "/api/fixed-incomes/cpu-renda-3", 3000, 99),
    ];
    const resultado = mediaTail([DELETE_RENDA], textoDe(objetos));
    expect(resultado[0].faltou).toBe(false);
    expect(resultado[0].n).toBe(10);
    expect(resultado[0].maximaMs).toBe(12);
  });
});

describe("eventosDoTail", () => {
  it("lê objetos concatenados, com ou sem quebra de linha, e deixa de fora o ilegível", () => {
    const texto = `${JSON.stringify(evento("GET", "/api/cards", 1, 2))}{nao e json}\n${JSON.stringify(evento("GET", "/api/cards", 2, 3))}`;
    const eventos = mediaTail([GET_CARDS], texto);
    expect(eventos[0].n).toBe(0);
    expect(eventos[0].faltou).toBe(true);
  });
});

describe("ordemDeEsvaziamento", () => {
  it("põe os filhos antes dos pais e deixa a tabela da medição de fora", () => {
    const ordem = ordemDeEsvaziamento([
      { name: "households", sql: "CREATE TABLE households (id TEXT PRIMARY KEY)" },
      { name: "members", sql: "CREATE TABLE members (id TEXT, household_id TEXT REFERENCES households(id))" },
      { name: "sessions", sql: "CREATE TABLE sessions (id TEXT, member_id TEXT REFERENCES members(id))" },
      { name: TABELA_DA_MEDICAO, sql: "CREATE TABLE _medicao_cpu (chave TEXT PRIMARY KEY)" },
    ]);
    expect(ordem).toEqual(["sessions", "members", "households"]);
    expect(ordem).not.toContain(TABELA_DA_MEDICAO);
  });
});
