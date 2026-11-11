import { env } from "cloudflare:test";
import type { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { DetalheDaCompraSchema } from "../../../src/shared/api/transactions";
import { createApp } from "../../../src/worker/app";
import { CYCLE_OUTFLOW_SQL } from "../../../src/worker/cycle/predicates";
import type { AppEnv } from "../../../src/worker/env";
import { aquecerOPortao, callApi, semearPronto } from "../helpers/app";
import {
  AGORA,
  categoriaDoLar,
  criarLar,
  criarOutroLar,
  inserirTransacao,
  type Lar,
} from "../helpers/regras";

// Compra (TASK-0403): GET e PATCH /api/transactions/:id contra o D1 de teste. Dados [TEST]. Hoje é 10/11/2026, no ciclo
// 2026-10 (11/10 a 10/11). Cada cenário cria a própria transação; só a sessão (lar) muda entre os testes.

beforeEach(async () => {
  await semearPronto(env.DB);
  await aquecerOPortao(createApp({}));
});

const appDoLar = (lar: { householdId: string; memberId: string }): Hono<AppEnv> =>
  createApp({ resolveSession: async () => lar, agora: () => new Date(AGORA) });

const APP_SEM_SESSAO = (): Hono<AppEnv> => createApp({});

// Ciclos de teste: anterior e atual, com dia 11 (o padrão do lar).
async function inserirCiclos(lar: Lar): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO cycles (household_id, key, starts_on, ends_on) VALUES (?, '2026-09', '2026-09-11', '2026-10-10')",
    ).bind(lar.householdId),
    env.DB.prepare(
      "INSERT INTO cycles (household_id, key, starts_on, ends_on) VALUES (?, '2026-10', '2026-10-11', '2026-11-10')",
    ).bind(lar.householdId),
  ]);
}

// Fatura aberta do cartão do lar, no ciclo 2026-10 (fecha 03/11, vence 10/11).
async function faturaAberta(lar: Lar): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO bills (id, card_id, closes_on, due_on, amount_cents, status, paid_on, cycle_key) VALUES (?, ?, '2026-11-03', '2026-11-10', NULL, 'aberta', NULL, '2026-10')",
  )
    .bind(id, lar.cardId)
    .run();
  return id;
}

async function compraNoCartao(
  lar: Lar,
  extra: Partial<{
    descricao: string;
    valor: number;
    movement: string;
    spendType: string | null;
    spendTypeSource: string | null;
    categoryId: string | null;
    aiCategoryId: string | null;
    categorizedBy: string | null;
    parcela: [number, number] | null;
    faturaId: string | null;
  }> = {},
): Promise<string> {
  const id = await inserirTransacao(lar, {
    na: "cartao",
    movement: extra.movement ?? "compra",
    amountCents: extra.valor ?? -4500,
    descricao: extra.descricao ?? "PAG*JOSEDASILVA SAO PAULO BR",
    localDate: "2026-11-05",
    spendType: extra.spendType ?? null,
    spendTypeSource: extra.spendTypeSource ?? null,
    categoryId: extra.categoryId ?? null,
    aiCategoryId: extra.aiCategoryId ?? null,
    categorizedBy: extra.categorizedBy ?? null,
  });
  await env.DB.prepare(
    "UPDATE transactions SET cycle_key = '2026-10', bill_id = ?, installment_number = ?, installment_total = ? WHERE id = ?",
  )
    .bind(extra.faturaId ?? null, extra.parcela?.[0] ?? null, extra.parcela?.[1] ?? null, id)
    .run();
  return id;
}

async function compraNaConta(lar: Lar, movement: string, descricao: string, valor: number): Promise<string> {
  const id = await inserirTransacao(lar, {
    na: "conta",
    movement,
    amountCents: valor,
    descricao,
    localDate: "2026-11-05",
  });
  await env.DB.prepare("UPDATE transactions SET cycle_key = '2026-10' WHERE id = ?").bind(id).run();
  return id;
}

async function linhaDoBanco(id: string): Promise<Record<string, unknown>> {
  const linha = await env.DB.prepare("SELECT * FROM transactions WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!linha) throw new Error("transação de teste não encontrada");
  return linha;
}

async function obter(app: Hono<AppEnv>, id: string): Promise<Response> {
  return callApi(app, "GET", `/api/transactions/${id}`);
}

async function alterar(app: Hono<AppEnv>, id: string, corpo: unknown): Promise<Response> {
  return callApi(app, "PATCH", `/api/transactions/${id}`, corpo);
}

async function gastoDoCiclo(lar: Lar, chave: string): Promise<number> {
  const linha = await env.DB.prepare(
    `SELECT COALESCE(SUM(-t.amount_cents), 0) AS total FROM transactions AS t WHERE t.household_id = ? AND t.cycle_key = ? AND ${CYCLE_OUTFLOW_SQL}`,
  )
    .bind(lar.householdId, chave)
    .first<{ total: number }>();
  return linha?.total ?? 0;
}

describe("GET /api/transactions/:id", () => {
  it("devolve o detalhe da compra de cartão, com cartão, fatura e ciclo, no contrato", async () => {
    const lar = await criarLar();
    await inserirCiclos(lar);
    const fatura = await faturaAberta(lar);
    const id = await compraNoCartao(lar, { faturaId: fatura });

    const resposta = await obter(appDoLar(lar), id);
    expect(resposta.status).toBe(200);
    const corpo = DetalheDaCompraSchema.parse(await resposta.json());

    expect(corpo.id).toBe(id);
    expect(corpo.movement).toBe("compra");
    expect(corpo.localDate).toBe("2026-11-05");
    expect(corpo.amountCents).toBe(-4500);
    expect(corpo.originalDescription).toBe("PAG*JOSEDASILVA SAO PAULO BR");
    expect(corpo.customName).toBeNull();
    expect(corpo.displayName).toBe("PAG*JOSEDASILVA SAO PAULO BR");
    expect(corpo.card).toEqual({ id: lar.cardId, label: "[TEST] Banco", last4: "1234" });
    expect(corpo.account).toBeNull();
    expect(corpo.bill).toEqual({ closesOn: "2026-11-03", dueOn: "2026-11-10" });
    expect(corpo.cycle).toEqual({ key: "2026-10", startsOn: "2026-10-11", endsOn: "2026-11-10" });
    expect(corpo.installment).toBeNull();
    expect(corpo.hidden).toBe(false);
  });

  it("404 para uma transação de outro lar e para uma que não existe", async () => {
    const lar = await criarLar();
    const outro = await criarOutroLar();
    const id = await compraNoCartao(lar);

    const deOutroLar = await obter(appDoLar(outro), id);
    expect(deOutroLar.status).toBe(404);
    expect(await deOutroLar.json()).toEqual({ error: "not_found", message: "Transação não encontrada." });

    const inexistente = await obter(appDoLar(lar), "nao-existe");
    expect(inexistente.status).toBe(404);
  });

  it("401 sem sessão", async () => {
    const lar = await criarLar();
    const id = await compraNoCartao(lar);
    const resposta = await obter(APP_SEM_SESSAO(), id);
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toMatchObject({ error: "nao_autenticado" });
  });

  it("parcelada mostra a parcela; parcela única não", async () => {
    const lar = await criarLar();
    const parcelada = await compraNoCartao(lar, { parcela: [2, 10] });
    const unica = await compraNoCartao(lar, { parcela: [1, 1] });

    const de2de10 = (await (await obter(appDoLar(lar), parcelada)).json()) as { installment: unknown };
    expect(de2de10.installment).toEqual({ number: 2, total: 10 });
    const deUma = (await (await obter(appDoLar(lar), unica)).json()) as { installment: unknown };
    expect(deUma.installment).toBeNull();
  });

  it("quem categorizou sai como pessoa, regra ou IA, sem o id do membro; a sugestão traz a confiança", async () => {
    const lar = await criarLar();
    const categoria = categoriaDoLar(lar, "mercado");
    const deRegra = await compraNoCartao(lar, {
      categoryId: categoria,
      categorizedBy: "regra",
      aiCategoryId: categoria,
    });
    const deIa = await compraNoCartao(lar, { categoryId: categoria, categorizedBy: "ia" });
    const dePessoa = await compraNoCartao(lar, { categoryId: categoria, categorizedBy: lar.memberId });
    await env.DB.prepare("UPDATE transactions SET ai_confidence = 'pouca' WHERE id = ?").bind(deRegra).run();

    const regra = (await (await obter(appDoLar(lar), deRegra)).json()) as Record<string, unknown>;
    expect(regra.categorizedBy).toBe("regra");
    expect(regra.category).toEqual({ id: categoria, name: "Mercado", parentName: null });
    expect(regra.aiSuggestion).toEqual({ categoryId: categoria, name: "Mercado", confidence: "pouca" });

    expect(
      ((await (await obter(appDoLar(lar), deIa)).json()) as { categorizedBy: string }).categorizedBy,
    ).toBe("ia");
    const pessoa = (await (await obter(appDoLar(lar), dePessoa)).json()) as Record<string, unknown>;
    expect(pessoa.categorizedBy).toBe("pessoa");
    expect(JSON.stringify(pessoa)).not.toContain(lar.memberId);
  });

  it("subcategoria mostra a mãe; sem calendário na tabela, o ciclo sai do dia de início do lar", async () => {
    const lar = await criarLar();
    const academia = categoriaDoLar(lar, "academia");
    const id = await compraNoCartao(lar, { categoryId: academia, categorizedBy: "ia" });
    const sem = (await (await obter(appDoLar(lar), id)).json()) as { category: unknown; cycle: unknown };
    expect(sem.category).toEqual({ id: academia, name: "Academia", parentName: "Saúde" });
    // Sem linha em cycles para 2026-10: o ciclo é o do dia de início do lar (11).
    expect(sem.cycle).toEqual({ key: "2026-10", startsOn: "2026-10-11", endsOn: "2026-11-10" });
  });

  it("boleto na conta: sem cartão, sem fatura, com a conta", async () => {
    const lar = await criarLar();
    const id = await compraNaConta(lar, "boleto", "[TEST] Boleto Luz", -18990);
    const corpo = (await (await obter(appDoLar(lar), id)).json()) as Record<string, unknown>;
    expect(corpo.card).toBeNull();
    expect(corpo.bill).toBeNull();
    expect(corpo.account).toMatchObject({ id: lar.accountId });
    expect(corpo.spendTypeSource).toBe(null);
  });
});

describe("PATCH /api/transactions/:id: nome próprio", () => {
  it("renomeia: o título muda, a descrição original fica e a categoria não muda", async () => {
    const lar = await criarLar();
    const categoria = categoriaDoLar(lar, "servicos");
    const id = await compraNoCartao(lar, { categoryId: categoria, categorizedBy: "pessoa" });

    const resposta = await alterar(appDoLar(lar), id, { customName: "Conserto do portão" });
    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as {
      displayName: string;
      originalDescription: string;
      category: { id: string };
    };
    expect(corpo.displayName).toBe("Conserto do portão");
    expect(corpo.originalDescription).toBe("PAG*JOSEDASILVA SAO PAULO BR");
    expect(corpo.category?.id).toBe(categoria);

    const banco = await linhaDoBanco(id);
    expect(banco.original_description).toBe("PAG*JOSEDASILVA SAO PAULO BR");
    expect(banco.custom_name).toBe("Conserto do portão");
    expect(banco.category_id).toBe(categoria);
  });

  it("usar original: grava NULL e a linha Original some", async () => {
    const lar = await criarLar();
    const id = await compraNoCartao(lar);
    await alterar(appDoLar(lar), id, { customName: "Conserto do portão" });

    const resposta = await alterar(appDoLar(lar), id, { customName: null });
    const corpo = (await resposta.json()) as { customName: string | null; displayName: string };
    expect(corpo.customName).toBeNull();
    expect(corpo.displayName).toBe("PAG*JOSEDASILVA SAO PAULO BR");
    expect((await linhaDoBanco(id)).custom_name).toBeNull();
  });

  it("nome vazio, só espaços ou igual à descrição original grava NULL", async () => {
    const lar = await criarLar();
    const id = await compraNoCartao(lar);
    for (const nome of ["   ", "PAG*JOSEDASILVA SAO PAULO BR", "  PAG*JOSEDASILVA SAO PAULO BR  "]) {
      await alterar(appDoLar(lar), id, { customName: "Nome qualquer" });
      await alterar(appDoLar(lar), id, { customName: nome });
      expect((await linhaDoBanco(id)).custom_name).toBeNull();
    }
  });

  it("o nome vem com trim: espaços nas pontas não entram", async () => {
    const lar = await criarLar();
    const id = await compraNoCartao(lar);
    await alterar(appDoLar(lar), id, { customName: "  Conserto do portão  " });
    expect((await linhaDoBanco(id)).custom_name).toBe("Conserto do portão");
  });

  it("80 caracteres passam; 81 respondem 422 nome_longo com a mensagem da spec", async () => {
    const lar = await criarLar();
    const id = await compraNoCartao(lar);
    const oitenta = "a".repeat(80);
    expect((await alterar(appDoLar(lar), id, { customName: oitenta })).status).toBe(200);

    const resposta = await alterar(appDoLar(lar), id, { customName: "b".repeat(81) });
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual({ error: "nome_longo", message: "Use até 80 caracteres." });
    expect((await linhaDoBanco(id)).custom_name).toBe(oitenta);
  });

  it("a descrição original nunca muda, mesmo com várias gravações", async () => {
    const lar = await criarLar();
    const id = await compraNoCartao(lar);
    for (const nome of ["Um", "Dois", null, "Três"]) {
      await alterar(appDoLar(lar), id, { customName: nome });
    }
    expect((await linhaDoBanco(id)).original_description).toBe("PAG*JOSEDASILVA SAO PAULO BR");
  });
});

describe("PATCH /api/transactions/:id: tipo de gasto", () => {
  it("troca o tipo: vira escolhido e a ajuda passa a ser a de escolhido", async () => {
    const lar = await criarLar();
    const id = await compraNoCartao(lar, { spendType: "prazeres", spendTypeSource: "padrao" });

    const resposta = await alterar(appDoLar(lar), id, { spendType: "conforto" });
    const corpo = (await resposta.json()) as { spendType: string; spendTypeSource: string };
    expect(corpo).toMatchObject({ spendType: "conforto", spendTypeSource: "escolhido" });
    expect((await linhaDoBanco(id)).spend_type_source).toBe("escolhido");
  });

  it("cartão nunca é Metas nem Investimentos: 422 tipo_invalido_cartao", async () => {
    const lar = await criarLar();
    const id = await compraNoCartao(lar, { spendType: "prazeres", spendTypeSource: "padrao" });
    for (const tipo of ["metas", "investimentos"]) {
      const resposta = await alterar(appDoLar(lar), id, { spendType: tipo });
      expect(resposta.status).toBe(422);
      expect(await resposta.json()).toEqual({
        error: "tipo_invalido_cartao",
        message: "Compra no cartão nunca é Metas nem Investimentos.",
      });
    }
    expect((await linhaDoBanco(id)).spend_type).toBe("prazeres");
  });

  it("boleto na conta aceita Metas e Investimentos", async () => {
    const lar = await criarLar();
    const id = await compraNaConta(lar, "boleto", "[TEST] Boleto Plano", -25000);
    expect((await alterar(appDoLar(lar), id, { spendType: "investimentos" })).status).toBe(200);
    const corpo = (await (await alterar(appDoLar(lar), id, { spendType: "metas" })).json()) as {
      spendType: string;
    };
    expect(corpo.spendType).toBe("metas");
  });

  it("entrada não tem tipo: 422 movimento_invalido, e o tipo continua nulo", async () => {
    const lar = await criarLar();
    const id = await compraNaConta(lar, "pix_recebido", "[TEST] Pix recebido", 10000);
    const resposta = await alterar(appDoLar(lar), id, { spendType: "fixos" });
    expect(resposta.status).toBe(422);
    expect(((await resposta.json()) as { error: string }).error).toBe("movimento_invalido");
    expect((await linhaDoBanco(id)).spend_type).toBeNull();
  });
});

describe("PATCH /api/transactions/:id: ocultar", () => {
  it("ocultar tira a compra do gasto do ciclo; desligar devolve; o motivo fica gasto_terceiros", async () => {
    const lar = await criarLar();
    await inserirCiclos(lar);
    const id = await compraNoCartao(lar, { valor: -31250, faturaId: await faturaAberta(lar) });
    const antes = await gastoDoCiclo(lar, "2026-10");
    expect(antes).toBe(31250);

    const oculta = await alterar(appDoLar(lar), id, { hidden: true });
    expect(oculta.status).toBe(200);
    expect(await oculta.json()).toMatchObject({ hidden: true, hiddenReason: "gasto_terceiros" });
    expect(await gastoDoCiclo(lar, "2026-10")).toBe(0);

    const volta = await alterar(appDoLar(lar), id, { hidden: false });
    expect(await volta.json()).toMatchObject({ hidden: false, hiddenReason: null });
    expect(await gastoDoCiclo(lar, "2026-10")).toBe(31250);
  });

  it("entrada não pode ser ocultada: 422 movimento_invalido", async () => {
    const lar = await criarLar();
    const id = await compraNaConta(lar, "pix_recebido", "[TEST] Pix de Ana", 5000);
    const resposta = await alterar(appDoLar(lar), id, { hidden: true });
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual({
      error: "movimento_invalido",
      message: "Esta transação não pode ser ocultada aqui.",
    });
    expect((await linhaDoBanco(id)).hidden).toBe(0);
  });
});

describe("PATCH /api/transactions/:id: validação e escrita", () => {
  it("corpo vazio, campo desconhecido, tipo desconhecido ou JSON inválido respondem 400 dados_invalidos", async () => {
    const lar = await criarLar();
    const id = await compraNoCartao(lar);
    const app = appDoLar(lar);
    expect((await alterar(app, id, {})).status).toBe(400);
    expect((await alterar(app, id, { categoryId: "seed:x" })).status).toBe(400);
    // Campo desconhecido junto de um válido: também 400, e nada é gravado.
    expect((await alterar(app, id, { hidden: true, categoryId: "seed:x" })).status).toBe(400);
    expect((await linhaDoBanco(id)).hidden).toBe(0);
    expect((await alterar(app, id, { spendType: "luxo" })).status).toBe(400);
    const invalido = await callApi(app, "PATCH", `/api/transactions/${id}`, undefined, {
      "content-type": "application/json",
    });
    expect(invalido.status).toBe(400);
  });

  it("cada campo grava só a sua coluna: dois campos em dois pedidos não se sobrescrevem", async () => {
    const lar = await criarLar();
    const id = await compraNoCartao(lar, { spendType: "prazeres", spendTypeSource: "padrao" });
    const app = appDoLar(lar);

    await Promise.all([
      alterar(app, id, { spendType: "conforto" }),
      alterar(app, id, { customName: "Presente da mãe" }),
    ]);

    const banco = await linhaDoBanco(id);
    expect(banco.spend_type).toBe("conforto");
    expect(banco.spend_type_source).toBe("escolhido");
    expect(banco.custom_name).toBe("Presente da mãe");
    expect(banco.hidden).toBe(0);
  });

  it("no mesmo campo vale a última gravação", async () => {
    const lar = await criarLar();
    const id = await compraNoCartao(lar);
    await alterar(appDoLar(lar), id, { spendType: "conforto" });
    await alterar(appDoLar(lar), id, { spendType: "educacao" });
    expect((await linhaDoBanco(id)).spend_type).toBe("educacao");
  });

  it("o isolamento vale na escrita: PATCH de outro lar responde 404 e não muda nada", async () => {
    const lar = await criarLar();
    const outro = await criarOutroLar();
    const id = await compraNoCartao(lar, { spendType: "prazeres", spendTypeSource: "padrao" });

    const resposta = await alterar(appDoLar(outro), id, {
      spendType: "conforto",
      hidden: true,
      customName: "Invadido",
    });
    expect(resposta.status).toBe(404);
    const banco = await linhaDoBanco(id);
    expect(banco.spend_type).toBe("prazeres");
    expect(banco.hidden).toBe(0);
    expect(banco.custom_name).toBeNull();
  });

  it("sem sessão, PATCH responde 401 e não grava", async () => {
    const lar = await criarLar();
    const id = await compraNoCartao(lar);
    const resposta = await alterar(APP_SEM_SESSAO(), id, { hidden: true });
    expect(resposta.status).toBe(401);
    expect((await linhaDoBanco(id)).hidden).toBe(0);
  });
});

describe("nome nas próximas (regras)", () => {
  it("só esta compra (sem a chave): nenhuma regra é criada", async () => {
    const lar = await criarLar();
    const id = await compraNoCartao(lar, { descricao: "AMAZON" });
    await alterar(appDoLar(lar), id, { customName: "Presente da mãe" });
    const regras = await env.DB.prepare("SELECT COUNT(*) AS total FROM rules WHERE household_id = ?")
      .bind(lar.householdId)
      .first<{ total: number }>();
    expect(regras?.total).toBe(0);
  });

  it("a regra da chave guarda o nome; as compras que já existem não mudam", async () => {
    const lar = await criarLar();
    const ja = await compraNoCartao(lar, { descricao: "ASAAS12MAT" });
    const outra = await compraNoCartao(lar, { descricao: "ASAAS12MAT" });
    await alterar(appDoLar(lar), ja, { customName: "Muay Thai" });

    const criada = await callApi(appDoLar(lar), "POST", "/api/rules", {
      transactionId: ja,
      set: { customName: "Muay Thai" },
      createdFrom: "lembrar",
    });
    expect(criada.status).toBe(201);

    const regra = await env.DB.prepare(
      "SELECT set_custom_name, set_category_id FROM rules WHERE household_id = ? AND scope = 'estabelecimento' AND disabled_at IS NULL",
    )
      .bind(lar.householdId)
      .first<{ set_custom_name: string; set_category_id: string | null }>();
    expect(regra).toEqual({ set_custom_name: "Muay Thai", set_category_id: null });
    expect((await linhaDoBanco(outra)).custom_name).toBeNull();
  });

  it("nome e categoria juntos: a regra ativa tem os dois", async () => {
    const lar = await criarLar();
    const academia = categoriaDoLar(lar, "academia");
    const id = await compraNoCartao(lar, { descricao: "ASAAS12MAT" });
    await callApi(appDoLar(lar), "POST", "/api/rules", {
      transactionId: id,
      set: { categoryId: academia },
      createdFrom: "lembrar",
    });
    const resposta = await callApi(appDoLar(lar), "POST", "/api/rules", {
      transactionId: id,
      set: { customName: "Muay Thai" },
      createdFrom: "lembrar",
    });
    expect(resposta.status).toBe(201);
    const regra = await env.DB.prepare(
      "SELECT set_custom_name, set_category_id FROM rules WHERE household_id = ? AND scope = 'estabelecimento' AND disabled_at IS NULL",
    )
      .bind(lar.householdId)
      .first<{ set_custom_name: string; set_category_id: string }>();
    expect(regra).toEqual({ set_custom_name: "Muay Thai", set_category_id: academia });
  });

  it("a tela lê a regra pelo GET de categorização: o nome que as próximas usam", async () => {
    const lar = await criarLar();
    const id = await compraNoCartao(lar, { descricao: "ASAAS12MAT" });
    await callApi(appDoLar(lar), "POST", "/api/rules", {
      transactionId: id,
      set: { customName: "Muay Thai" },
      createdFrom: "lembrar",
    });
    const categorizacao = (await (
      await callApi(appDoLar(lar), "GET", `/api/transactions/${id}/categorization`)
    ).json()) as { scope: string; matchLabel: string; rule: { setCustomName: string } | null };
    expect(categorizacao.scope).toBe("estabelecimento");
    expect(categorizacao.matchLabel).toBe("ASAAS12MAT");
    expect(categorizacao.rule?.setCustomName).toBe("Muay Thai");

    // Renomear só esta compra, sem a chave, não mexe na regra.
    await alterar(appDoLar(lar), id, { customName: "Outro nome" });
    const depois = (await (
      await callApi(appDoLar(lar), "GET", `/api/transactions/${id}/categorization`)
    ).json()) as { rule: { setCustomName: string } | null };
    expect(depois.rule?.setCustomName).toBe("Muay Thai");
  });
});

describe("boleto e outras saídas da conta", () => {
  it("boleto: renomeia, categoriza e oculta; o tipo aceita os sete", async () => {
    const lar = await criarLar();
    const id = await compraNaConta(lar, "boleto", "[TEST] Boleto Condomínio", -58000);
    const app = appDoLar(lar);
    expect((await alterar(app, id, { customName: "Condomínio" })).status).toBe(200);
    expect((await alterar(app, id, { hidden: true })).status).toBe(200);
    const corpo = (await (await alterar(app, id, { spendType: "extras" })).json()) as {
      spendType: string;
      hiddenReason: string;
    };
    expect(corpo.spendType).toBe("extras");
    expect(corpo.hiddenReason).toBe("gasto_terceiros");
  });
});

describe("casos de borda do detalhe", () => {
  it("transação removida não aparece: 404 no GET e no PATCH, e nada muda", async () => {
    const lar = await criarLar();
    const id = await compraNoCartao(lar);
    await env.DB.prepare("UPDATE transactions SET removed_at = ? WHERE id = ?").bind(AGORA, id).run();
    expect((await obter(appDoLar(lar), id)).status).toBe(404);
    expect((await alterar(appDoLar(lar), id, { hidden: true })).status).toBe(404);
    expect((await linhaDoBanco(id)).hidden).toBe(0);
  });

  it("a confiança da IA: media vira média, alta fica, e um texto fora da lista não tem grau", async () => {
    const lar = await criarLar();
    const id = await compraNoCartao(lar, { aiCategoryId: categoriaDoLar(lar, "mercado") });
    const confianca = async (valor: string) => {
      await env.DB.prepare("UPDATE transactions SET ai_confidence = ? WHERE id = ?").bind(valor, id).run();
      const corpo = (await (await obter(appDoLar(lar), id)).json()) as {
        aiSuggestion: { confidence: string | null };
      };
      return corpo.aiSuggestion.confidence;
    };
    expect(await confianca("media")).toBe("média");
    expect(await confianca("alta")).toBe("alta");
    expect(await confianca("certa")).toBeNull();
  });

  it("o ciclo vem da tabela cycles quando a chave está lá (vale sobre o dia de início do lar)", async () => {
    const lar = await criarLar();
    await env.DB.prepare(
      "INSERT INTO cycles (household_id, key, starts_on, ends_on) VALUES (?, '2026-10', '2026-10-15', '2026-11-14')",
    )
      .bind(lar.householdId)
      .run();
    const id = await compraNoCartao(lar);
    const corpo = (await (await obter(appDoLar(lar), id)).json()) as { cycle: unknown };
    expect(corpo.cycle).toEqual({ key: "2026-10", startsOn: "2026-10-15", endsOn: "2026-11-14" });
  });
});
