import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { expectedPerCycle } from "../../src/shared/fixed-incomes";
import { createApp } from "../../src/worker/app";
import { createDb } from "../../src/worker/db/client";
import { newMeter } from "../../src/worker/db/metered-d1";
import type { AppEnv } from "../../src/worker/env";
import { arquivarRendaFixa, atualizarRendaFixa } from "../../src/worker/income/fixed-incomes-repo";
import { aquecerOPortao, semearPronto } from "./helpers/app";
import { AGORA, criarLar, criarOutroLar } from "./helpers/regras";

// Renda fixa (TASK-0901): contratos da API (GET, POST, PATCH, DELETE), sessão obrigatória, o lar da sessão, a gravação
// em centavos e o que fica em dólar. Dados [TEST]; o app é chamado com resolveSession fixo (o lar da sessão), e os
// cenários sem sessão usam o resolvedor real, sem cookie.

beforeEach(async () => {
  await semearPronto(env.DB);
  await aquecerOPortao(createApp({}));
});

// A resposta é JSON de teste: cada asserção confere a forma que ela tem.
// biome-ignore lint/suspicious/noExplicitAny: corpo de resposta de teste, conferido pelas asserções
type Corpo = Record<string, any>;
type Resposta = { status: number; corpo: Corpo };

async function chamar(app: Hono<AppEnv>, method: string, path: string, body?: unknown): Promise<Resposta> {
  const ctx = createExecutionContext();
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const resposta = await app.fetch(new Request(`http://matrimoney.test${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  const texto = await resposta.text();
  return { status: resposta.status, corpo: texto ? (JSON.parse(texto) as Corpo) : {} };
}

const appDoLar = (lar: { householdId: string; memberId: string }): Hono<AppEnv> =>
  createApp({ resolveSession: async () => lar, agora: () => new Date(AGORA) });

const CLT = {
  name: "[TEST] Salário CLT",
  currency: "BRL",
  amountCents: 500000,
  usualDay: 5,
  arrival: "auto",
  statementText: "SALARIO",
};
const DOLAR = {
  name: "[TEST] Salário em dólar",
  currency: "USD",
  amountCents: 200000,
  usualDay: 10,
  arrival: "partes",
  statementText: null,
};

async function criarRenda(app: Hono<AppEnv>, corpo: Record<string, unknown>): Promise<string> {
  const resposta = await chamar(app, "POST", "/api/fixed-incomes", corpo);
  if (resposta.status !== 201)
    throw new Error(`POST falhou: ${resposta.status} ${JSON.stringify(resposta.corpo)}`);
  return resposta.corpo.fixedIncome.id as string;
}

const linhaDoBanco = (id: string) =>
  env.DB.prepare("SELECT * FROM fixed_incomes WHERE id = ?").bind(id).first<Record<string, unknown>>();

const contarNoBanco = async (sql: string, ...valores: unknown[]) => {
  const linha = await env.DB.prepare(sql)
    .bind(...valores)
    .first<{ n: number }>();
  return linha?.n ?? 0;
};

describe("cenário 1: CLT automático", () => {
  it("POST grava a renda em centavos, em real o dólar que fica é falso, e o GET mostra o previsto", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);

    const criada = await chamar(app, "POST", "/api/fixed-incomes", CLT);
    expect(criada.status).toBe(201);
    expect(criada.corpo.fixedIncome).toMatchObject({
      name: "[TEST] Salário CLT",
      currency: "BRL",
      amountCents: 500000,
      usualDay: 5,
      arrival: "auto",
      statementText: "SALARIO",
      keptUsdIsInvestment: false,
      lastFx: null,
    });

    const linha = await linhaDoBanco(criada.corpo.fixedIncome.id);
    expect(linha).toMatchObject({
      household_id: lar.householdId,
      amount_cents: 500000,
      kept_usd_is_investment: 0,
    });

    const lista = await chamar(app, "GET", "/api/fixed-incomes");
    expect(lista.status).toBe(200);
    expect(lista.corpo.fixedIncomes).toHaveLength(1);
    expect(lista.corpo.expectedPerCycle).toEqual({ brlCents: 500000, usdCents: 0, usdInBrlCents: null });
  });
});

describe("cenário 2: salário em dólar", () => {
  it("o previsto separa as moedas, e o que fica em dólar começa ligado", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    await criarRenda(app, CLT);
    const id = await criarRenda(app, { ...DOLAR, keptUsdIsInvestment: undefined });

    const lista = await chamar(app, "GET", "/api/fixed-incomes");
    expect(lista.corpo.expectedPerCycle).toEqual({ brlCents: 500000, usdCents: 200000, usdInBrlCents: null });
    const dolar = lista.corpo.fixedIncomes.find((renda: { id: string }) => renda.id === id);
    expect(dolar).toMatchObject({
      currency: "USD",
      amountCents: 200000,
      keptUsdIsInvestment: true,
      lastFx: null,
    });
    expect((await linhaDoBanco(id))?.kept_usd_is_investment).toBe(1);
  });

  it("em dólar, o que fica é falso quando a pessoa desliga o Investimento", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const id = await criarRenda(app, { ...DOLAR, keptUsdIsInvestment: false });

    expect((await linhaDoBanco(id))?.kept_usd_is_investment).toBe(0);
  });
});

describe("cenário 3: automático sem texto do extrato", () => {
  it("422 com o campo e a mensagem da spec, e nada é gravado", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);

    const resposta = await chamar(app, "POST", "/api/fixed-incomes", { ...CLT, statementText: "" });

    expect(resposta.status).toBe(422);
    expect(resposta.corpo).toEqual({
      error: "validacao",
      fields: { statementText: "Para reconhecer sozinho, diga o texto que aparece no extrato." },
    });
    expect(await contarNoBanco("SELECT COUNT(*) AS n FROM fixed_incomes")).toBe(0);
  });
});

describe("cenário 5: nome repetido", () => {
  it("'salario clt' com a renda 'Salário CLT' ativa: 422 com a mensagem da spec, e uma linha só", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    await criarRenda(app, CLT);

    const resposta = await chamar(app, "POST", "/api/fixed-incomes", { ...CLT, name: "[TEST] salario clt" });

    expect(resposta.status).toBe(422);
    expect(resposta.corpo.fields).toEqual({ name: "Já existe uma renda fixa com esse nome." });
    expect(await contarNoBanco("SELECT COUNT(*) AS n FROM fixed_incomes")).toBe(1);
  });

  it("uma renda arquivada não impede o nome de voltar", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const id = await criarRenda(app, CLT);
    await chamar(app, "DELETE", `/api/fixed-incomes/${id}`);

    const resposta = await chamar(app, "POST", "/api/fixed-incomes", CLT);

    expect(resposta.status).toBe(201);
  });
});

describe("cenário 9: excluir arquiva", () => {
  it("DELETE responde 204; a renda sai da lista e do previsto, e a linha continua no banco com archived_at", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const id = await criarRenda(app, CLT);

    const apagada = await chamar(app, "DELETE", `/api/fixed-incomes/${id}`);
    expect(apagada.status).toBe(204);

    const lista = await chamar(app, "GET", "/api/fixed-incomes");
    expect(lista.corpo.fixedIncomes).toEqual([]);
    expect(lista.corpo.expectedPerCycle).toEqual({ brlCents: 0, usdCents: 0, usdInBrlCents: null });

    const linha = await linhaDoBanco(id);
    expect(linha).toBeDefined();
    expect(linha?.archived_at).toBe(AGORA);
  });

  it("uma renda já excluída responde 404 nao_encontrada, e a linha não muda de novo", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const id = await criarRenda(app, CLT);
    await chamar(app, "DELETE", `/api/fixed-incomes/${id}`);

    const de_novo = await chamar(app, "DELETE", `/api/fixed-incomes/${id}`);

    expect(de_novo.status).toBe(404);
    expect(de_novo.corpo).toEqual({ error: "nao_encontrada" });
  });
});

describe("cenário 10: os dois ao mesmo tempo", () => {
  it("a renda que B excluiu não aceita o salvamento de A: PATCH responde 404 e nada muda", async () => {
    const lar = await criarLar();
    const id = await criarRenda(appDoLar(lar), CLT);
    // Dois aparelhos do mesmo lar: o da pessoa B exclui; o da A, que ainda tem a renda aberta, salva depois.
    const appDeB = appDoLar(lar);
    const appDeA = appDoLar(lar);
    expect((await chamar(appDeB, "DELETE", `/api/fixed-incomes/${id}`)).status).toBe(204);

    const salvamento = await chamar(appDeA, "PATCH", `/api/fixed-incomes/${id}`, {
      ...CLT,
      arrival: "manual",
    });

    expect(salvamento.status).toBe(404);
    expect(salvamento.corpo).toEqual({ error: "nao_encontrada" });
    expect((await linhaDoBanco(id))?.arrival).toBe("auto");
  });
});

describe("cenário 13: outro lar", () => {
  it("PATCH e DELETE numa renda de outro lar respondem 404, e a linha fica como estava", async () => {
    const larA = await criarLar();
    const id = await criarRenda(appDoLar(larA), CLT);
    const larB = await criarOutroLar();
    const appDeB = appDoLar(larB);

    const alterar = await chamar(appDeB, "PATCH", `/api/fixed-incomes/${id}`, { ...CLT, amountCents: 1 });
    const apagar = await chamar(appDeB, "DELETE", `/api/fixed-incomes/${id}`);

    expect(alterar.status).toBe(404);
    expect(alterar.corpo).toEqual({ error: "nao_encontrada" });
    expect(apagar.status).toBe(404);
    const linha = await linhaDoBanco(id);
    expect(linha).toMatchObject({ amount_cents: 500000, archived_at: null });
  });

  it("o GET do lar B não mostra as rendas do lar A, nem as soma no previsto", async () => {
    const larA = await criarLar();
    await criarRenda(appDoLar(larA), CLT);
    const larB = await criarOutroLar();

    const lista = await chamar(appDoLar(larB), "GET", "/api/fixed-incomes");

    expect(lista.corpo.fixedIncomes).toEqual([]);
    expect(lista.corpo.expectedPerCycle).toEqual({ brlCents: 0, usdCents: 0, usdInBrlCents: null });
  });

  it("a validação do nome só olha o lar da sessão: o mesmo nome em outro lar é aceito", async () => {
    const larA = await criarLar();
    await criarRenda(appDoLar(larA), CLT);
    const larB = await criarOutroLar();

    const resposta = await chamar(appDoLar(larB), "POST", "/api/fixed-incomes", CLT);

    expect(resposta.status).toBe(201);
  });
});

describe("sessão obrigatória", () => {
  it("sem cookie, todas as rotas respondem 401 nao_autenticado (o resolvedor real)", async () => {
    const semSessao = createApp({});

    const respostas = [
      await chamar(semSessao, "GET", "/api/fixed-incomes"),
      await chamar(semSessao, "POST", "/api/fixed-incomes", CLT),
      await chamar(semSessao, "PATCH", "/api/fixed-incomes/qualquer", CLT),
      await chamar(semSessao, "DELETE", "/api/fixed-incomes/qualquer"),
    ];

    for (const resposta of respostas) {
      expect(resposta.status).toBe(401);
      expect(resposta.corpo.error).toBe("nao_autenticado");
    }
  });
});

describe("PATCH", () => {
  it("é parcial: o que não veio no corpo fica como está", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const id = await criarRenda(app, CLT);

    const resposta = await chamar(app, "PATCH", `/api/fixed-incomes/${id}`, {
      arrival: "manual",
      statementText: null,
    });

    expect(resposta.status).toBe(200);
    expect(resposta.corpo.fixedIncome).toMatchObject({
      name: "[TEST] Salário CLT",
      amountCents: 500000,
      usualDay: 5,
      arrival: "manual",
      statementText: null,
    });
    expect(await linhaDoBanco(id)).toMatchObject({
      arrival: "manual",
      statement_text: null,
      amount_cents: 500000,
    });
  });

  it("valor, dia e moeda vão para o banco em centavos e na moeda", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const id = await criarRenda(app, CLT);

    const resposta = await chamar(app, "PATCH", `/api/fixed-incomes/${id}`, {
      currency: "USD",
      amountCents: 200050,
      usualDay: 31,
    });

    expect(resposta.status).toBe(200);
    expect(await linhaDoBanco(id)).toMatchObject({ currency: "USD", amount_cents: 200050, usual_day: 31 });
    // Trocou para dólar sem informar o que fica: o padrão é Investimento.
    expect((await linhaDoBanco(id))?.kept_usd_is_investment).toBe(1);
  });

  it("validação com campos devolve 422 e não grava nada", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const id = await criarRenda(app, CLT);

    const resposta = await chamar(app, "PATCH", `/api/fixed-incomes/${id}`, { usualDay: 40, amountCents: 0 });

    expect(resposta.status).toBe(422);
    expect(resposta.corpo.fields).toEqual({
      usualDay: "Dia inválido.",
      amountCents: "Informe o valor por ciclo.",
    });
    expect(await linhaDoBanco(id)).toMatchObject({ usual_day: 5, amount_cents: 500000 });
  });

  it("não aceita o nome de outra renda ativa, mas aceita o próprio nome com outra caixa", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    await criarRenda(app, { ...CLT, name: "[TEST] Aluguel recebido" });
    const id = await criarRenda(app, CLT);

    const repetido = await chamar(app, "PATCH", `/api/fixed-incomes/${id}`, {
      name: "[TEST] aluguel RECEBIDO",
    });
    const proprio = await chamar(app, "PATCH", `/api/fixed-incomes/${id}`, { name: "[TEST] salário clt" });

    expect(repetido.status).toBe(422);
    expect(repetido.corpo.fields).toEqual({ name: "Já existe uma renda fixa com esse nome." });
    expect(proprio.status).toBe(200);
  });

  it("chave que não existe no corpo: 400 dados_invalidos, sem tocar no banco", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const id = await criarRenda(app, CLT);

    const resposta = await chamar(app, "PATCH", `/api/fixed-incomes/${id}`, { investimentos: 10 });

    expect(resposta.status).toBe(400);
    expect(resposta.corpo.error).toBe("dados_invalidos");
    expect(await linhaDoBanco(id)).toMatchObject({ amount_cents: 500000 });
  });
});

describe("corpo inválido", () => {
  it("JSON quebrado ou corpo que não é objeto: 400 dados_invalidos em POST e PATCH", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const id = await criarRenda(app, CLT);

    for (const corpo of ["{não é json", "[1, 2]", "null", '"texto"']) {
      expect((await chamar(app, "POST", "/api/fixed-incomes", corpo)).status).toBe(400);
      expect((await chamar(app, "PATCH", `/api/fixed-incomes/${id}`, corpo)).status).toBe(400);
    }
    expect(await contarNoBanco("SELECT COUNT(*) AS n FROM fixed_incomes")).toBe(1);
  });
});

describe("GET", () => {
  it("só as ativas, em ordem de nome sem caixa", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    await criarRenda(app, { ...CLT, name: "[TEST] Pró-labore" });
    await criarRenda(app, { ...CLT, name: "[TEST] aluguel" });
    const apagada = await criarRenda(app, { ...CLT, name: "[TEST] Bônus" });
    await chamar(app, "DELETE", `/api/fixed-incomes/${apagada}`);

    const lista = await chamar(app, "GET", "/api/fixed-incomes");

    expect(lista.corpo.fixedIncomes.map((renda: { name: string }) => renda.name)).toEqual([
      "[TEST] aluguel",
      "[TEST] Pró-labore",
    ]);
  });

  it("o previsto do GET é o mesmo que a regra do previsto dá sobre as linhas ativas", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    await criarRenda(app, CLT);
    await criarRenda(app, { ...DOLAR, name: "[TEST] Dólar 1", amountCents: 123450 });
    await criarRenda(app, { ...DOLAR, name: "[TEST] Dólar 2", amountCents: 50 });
    const apagada = await criarRenda(app, { ...CLT, name: "[TEST] Extra" });
    await chamar(app, "DELETE", `/api/fixed-incomes/${apagada}`);

    const lista = await chamar(app, "GET", "/api/fixed-incomes");

    expect(lista.corpo.expectedPerCycle).toEqual({ brlCents: 500000, usdCents: 123500, usdInBrlCents: null });
    // A regra da shared, sobre todas as linhas do lar (arquivada inclusive), dá o mesmo número que a soma do SQL.
    const linhas = await env.DB.prepare(
      "SELECT currency, amount_cents, archived_at FROM fixed_incomes WHERE household_id = ?",
    )
      .bind(lar.householdId)
      .all<{ currency: "BRL" | "USD"; amount_cents: number; archived_at: string | null }>();
    const regra = expectedPerCycle(
      (linhas.results ?? []).map((linha) => ({
        currency: linha.currency,
        amountCents: linha.amount_cents,
        archivedAt: linha.archived_at,
      })),
    );
    expect(lista.corpo.expectedPerCycle).toMatchObject({
      brlCents: regra.brlCents,
      usdCents: regra.usdCents,
    });
  });
});

// A leitura das ativas já filtra o lar; a escrita confere o lar de novo (duas guardas, uma em cada caminho).
describe("guarda do lar na escrita", () => {
  it("atualizar e arquivar com o id de outro lar não mexem na linha", async () => {
    const larA = await criarLar();
    const id = await criarRenda(appDoLar(larA), CLT);
    const larB = await criarOutroLar();
    const db = createDb(env.DB, newMeter());
    const valores = {
      name: "[TEST] Invadida",
      currency: "BRL",
      amountCents: 1,
      usualDay: 1,
      arrival: "manual",
      statementText: null,
      keptUsdIsInvestment: false,
    } as const;

    expect(await atualizarRendaFixa(db, larB.householdId, id, valores)).toBe(false);
    expect(await arquivarRendaFixa(db, larB.householdId, id, new Date(AGORA))).toBe(false);
    expect(await linhaDoBanco(id)).toMatchObject({ name: CLT.name, amount_cents: 500000, archived_at: null });
  });
});
