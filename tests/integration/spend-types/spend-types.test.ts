import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { establishmentKey } from "../../../src/shared/establishment-key";
import { createApp } from "../../../src/worker/app";
import { ingestTransactions } from "../../../src/worker/bank/repository";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import type { AppEnv } from "../../../src/worker/env";
import { applySpendTypesOnImport } from "../../../src/worker/spend-types/derive";
import {
  assertSpendTypeAllowed,
  resolveSpendType,
  tipoDaCategoriaSql,
} from "../../../src/worker/spend-types/resolve";
import { aquecerOPortao, semearPronto } from "../helpers/app";
import {
  AGORA,
  categoriaDoLar,
  criarLar,
  criarOutroLar,
  criarRegra,
  inserirComprasEmLote,
  inserirTransacao,
  type Lar,
  lerTransacao,
} from "../helpers/regras";

// Tipos de gasto (TASK-0802): herança, precedência, cartão, regras automáticas, rederivação, a carga inicial da
// migração e a leitura por id. Dados [TEST]; a API é chamada pelo app com resolveSession fixo (o lar da sessão).

beforeEach(async () => {
  await semearPronto(env.DB);
  await aquecerOPortao(createApp({}));
});

type Resposta = { status: number; corpo: Record<string, unknown> };

async function chamar(app: Hono<AppEnv>, method: string, path: string, body?: unknown): Promise<Resposta> {
  const ctx = createExecutionContext();
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const resposta = await app.fetch(new Request(`http://matrimoney.test${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  const texto = await resposta.text();
  return { status: resposta.status, corpo: texto ? (JSON.parse(texto) as Record<string, unknown>) : {} };
}

const appDoLar = (lar: { householdId: string; memberId: string }): Hono<AppEnv> =>
  createApp({ resolveSession: async () => lar, agora: () => new Date(AGORA) });

// Categoria direta no banco, com tipo próprio (ou sem) e mãe opcional.
async function criarCategoria(
  lar: Lar,
  dados: { id: string; nome: string; parentId?: string | null; tipo?: string | null },
): Promise<string> {
  await env.DB.prepare(
    "INSERT INTO categories (id, household_id, name, color, parent_id, default_spend_type, ai_hint, sort, archived_at) VALUES (?, ?, ?, '#7C4DFF', ?, ?, NULL, 0, NULL)",
  )
    .bind(dados.id, lar.householdId, dados.nome, dados.parentId ?? null, dados.tipo ?? null)
    .run();
  return dados.id;
}

async function categorizar(app: Hono<AppEnv>, transacaoId: string, categoriaId: string): Promise<Resposta> {
  return chamar(app, "PUT", `/api/transactions/${transacaoId}/category`, {
    categoryId: categoriaId,
    applyToAll: false,
  });
}

// Um lar extra, com conta e cartão, direto no banco: criarLar só monta um lar por teste (createHousehold).
async function criarLarExtra(): Promise<Lar> {
  const { householdId, memberId } = await criarOutroLar();
  const connectionId = crypto.randomUUID();
  const bankItemId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const cardId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO pluggy_connections (id, household_id, label, created_at) VALUES (?, ?, '[TEST] Conexão', ?)",
    ).bind(connectionId, householdId, AGORA),
    env.DB.prepare(
      "INSERT INTO bank_items (id, connection_id, institution_name, created_at) VALUES (?, ?, '[TEST] Banco', ?)",
    ).bind(bankItemId, connectionId, AGORA),
    env.DB.prepare(
      "INSERT INTO accounts (id, bank_item_id, kind, name, balance_cents, overdraft_used_cents, balance_at) VALUES (?, ?, 'corrente', '[TEST] Conta', 0, 0, ?)",
    ).bind(accountId, bankItemId, AGORA),
    env.DB.prepare(
      "INSERT INTO cards (id, bank_item_id, last4, name) VALUES (?, ?, '1234', '[TEST] Cartão')",
    ).bind(cardId, bankItemId),
  ]);
  return { householdId, memberId, bankItemId, accountId, cardId };
}

// Repete o passo 4 da importação para uma linha (zera o tipo antes, como a gravação nova).
async function aplicarDeNovoNaImportacao(lar: Lar, id: string): Promise<void> {
  await env.DB.prepare("UPDATE transactions SET spend_type = NULL, spend_type_source = NULL WHERE id = ?")
    .bind(id)
    .run();
  await applySpendTypesOnImport(createDb(env.DB, newMeter()), lar.householdId, [id]);
}

describe("herança do tipo pela categoria (apply.ts)", () => {
  it("cenário 1: compra com Mercado (fixos) fica fixos/categoria; subcategoria sem tipo dentro dela também", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const compra = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -4500,
      descricao: "[TEST] Mercado A",
    });
    const sub = await criarCategoria(lar, {
      id: `[TEST]-sub-${lar.householdId}`,
      nome: "[TEST] Sub",
      parentId: categoriaDoLar(lar, "mercado"),
    });
    expect((await categorizar(app, compra, categoriaDoLar(lar, "mercado"))).status).toBe(200);
    expect(await lerTransacao(compra)).toMatchObject({ spend_type: "fixos", spend_type_source: "categoria" });

    const outra = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -800,
      descricao: "[TEST] Sub B",
    });
    expect((await categorizar(app, outra, sub)).status).toBe(200);
    expect(await lerTransacao(outra)).toMatchObject({ spend_type: "fixos", spend_type_source: "categoria" });
  });

  it("cenário 2: escolhido e regra não mudam com a categoria nem com o tipo padrão dela", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const categoria = await criarCategoria(lar, {
      id: `[TEST]-cat-${lar.householdId}`,
      nome: "[TEST] Assinaturas",
    });
    const escolhida = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -2990,
      descricao: "[TEST] Streaming",
      spendType: "conforto",
      spendTypeSource: "escolhido",
    });
    const pelaRegra = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -1500,
      descricao: "[TEST] Regra Tipo",
      spendType: "educacao",
      spendTypeSource: "regra",
    });
    await categorizar(app, escolhida, categoria);
    await categorizar(app, pelaRegra, categoria);
    expect(await lerTransacao(escolhida)).toMatchObject({
      spend_type: "conforto",
      spend_type_source: "escolhido",
    });
    expect((await lerTransacao(pelaRegra)).spend_type).toBe("educacao");

    const patch = await chamar(app, "PATCH", `/api/categories/${categoria}`, { defaultSpendType: "extras" });
    expect(patch.status).toBe(200);
    expect((await lerTransacao(escolhida)).spend_type).toBe("conforto");
    expect((await lerTransacao(pelaRegra)).spend_type).toBe("educacao");
  });

  it("cenário 3: saída nova sem categoria nem regra entra como prazeres/padrao (importação)", async () => {
    const lar = await criarLar();
    const { insertedIds } = await ingestTransactions(createDb(env.DB, newMeter()), {
      householdId: lar.householdId,
      bankItemId: lar.bankItemId,
      now: AGORA,
      rows: [
        {
          external_id: `[TEST] ext-padrao-${lar.householdId}`,
          account_id: lar.accountId,
          card_id: null,
          bill_id: null,
          futura: null,
          movement: "pix_enviado",
          occurred_at: "2026-11-09T14:00:00.000Z",
          local_date: "2026-11-09",
          amount_cents: -2500,
          original_description: "[TEST] Pix Padrao",
          establishment_key: null,
          counterparty_name: "[TEST] Pessoa Padrao",
          counterparty_doc_masked: null,
          counterparty_bank: null,
          installment_number: null,
          installment_total: null,
          provider_category: null,
          provider_operation_type: null,
        },
      ],
    });
    expect(await lerTransacao(insertedIds[0] ?? "")).toMatchObject({
      spend_type: "prazeres",
      spend_type_source: "padrao",
    });
  });

  it("regra só de categoria: a compra da importação herda o tipo da categoria (categoria), sem tipo na regra", async () => {
    const lar = await criarLar();
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: "PADARIA TIPO",
      setCategoryId: categoriaDoLar(lar, "mercado"),
    });
    const { insertedIds } = await ingestTransactions(createDb(env.DB, newMeter()), {
      householdId: lar.householdId,
      bankItemId: lar.bankItemId,
      now: AGORA,
      rows: [
        {
          external_id: `[TEST] ext-regra-tipo-${lar.householdId}`,
          account_id: null,
          card_id: lar.cardId,
          bill_id: null,
          futura: null,
          movement: "compra",
          occurred_at: "2026-11-09T14:00:00.000Z",
          local_date: "2026-11-09",
          amount_cents: -1800,
          original_description: "PADARIA TIPO",
          establishment_key: establishmentKey("PADARIA TIPO"),
          counterparty_name: null,
          counterparty_doc_masked: null,
          counterparty_bank: null,
          installment_number: null,
          installment_total: null,
          provider_category: null,
          provider_operation_type: null,
        },
      ],
    });
    expect(await lerTransacao(insertedIds[0] ?? "")).toMatchObject({
      category_id: categoriaDoLar(lar, "mercado"),
      spend_type: "fixos",
      spend_type_source: "categoria",
    });
  });

  it("cenário 4: no cartão, Metas da categoria cai para prazeres/padrao; o Pix nela fica metas/categoria", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const viagem = await criarCategoria(lar, {
      id: `[TEST]-viagem-${lar.householdId}`,
      nome: "[TEST] Viagem",
      tipo: "metas",
    });
    const compraCartao = await inserirTransacao(lar, {
      na: "cartao",
      movement: "compra",
      amountCents: -9000,
      descricao: "[TEST] Passagem",
    });
    const pixNela = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -9000,
      descricao: "[TEST] Pix Viagem",
      contraparte: "[TEST] Agência",
    });
    expect((await categorizar(app, compraCartao, viagem)).status).toBe(200);
    expect((await categorizar(app, pixNela, viagem)).status).toBe(200);
    expect(await lerTransacao(compraCartao)).toMatchObject({
      spend_type: "prazeres",
      spend_type_source: "padrao",
    });
    expect(await lerTransacao(pixNela)).toMatchObject({
      spend_type: "metas",
      spend_type_source: "categoria",
    });
  });

  it("cenário 4 (mãe): subcategoria sem tipo de uma mãe Investimentos, no cartão, cai para o padrão", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const mae = await criarCategoria(lar, {
      id: `[TEST]-mae-${lar.householdId}`,
      nome: "[TEST] Mãe",
      tipo: "investimentos",
    });
    const filha = await criarCategoria(lar, {
      id: `[TEST]-filha-${lar.householdId}`,
      nome: "[TEST] Filha",
      parentId: mae,
    });
    const compra = await inserirTransacao(lar, {
      na: "cartao",
      movement: "compra",
      amountCents: -700,
      descricao: "[TEST] Filha Cartao",
    });
    expect((await categorizar(app, compra, filha)).status).toBe(200);
    expect(await lerTransacao(compra)).toMatchObject({ spend_type: "prazeres", spend_type_source: "padrao" });
  });

  it("'Aplicar a todas': a compra antiga herda o tipo da categoria; a escolhida mantém o seu tipo", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const servicos = await criarCategoria(lar, {
      id: `[TEST]-servicos-${lar.householdId}`,
      nome: "[TEST] Serviços",
      tipo: "conforto",
    });
    const antiga = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -1000,
      descricao: "PAG*RETRO TEST",
    });
    const escolhida = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -1000,
      descricao: "PAG*RETRO TEST",
      spendType: "extras",
      spendTypeSource: "escolhido",
    });
    const origem = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -1000,
      descricao: "PAG*RETRO TEST",
    });
    const r = await chamar(app, "PUT", `/api/transactions/${origem}/category`, {
      categoryId: servicos,
      applyToAll: true,
    });
    expect(r.status).toBe(200);
    expect(await lerTransacao(antiga)).toMatchObject({
      spend_type: "conforto",
      spend_type_source: "categoria",
    });
    expect(await lerTransacao(escolhida)).toMatchObject({
      spend_type: "extras",
      spend_type_source: "escolhido",
    });
    expect((await lerTransacao(origem)).spend_type).toBe("conforto");
  });
});

describe("regras automáticas (corretora e caixinha)", () => {
  it("cenário 5: 'CORRETORA X' vira investimentos/regra nos Pix (histórico e novos); cartão não; apagar devolve", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const pixAntigo = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -50000,
      descricao: "[TEST] Pix Corretora",
      contraparte: "CORRETORA X LTDA",
    });
    const compraCartao = await inserirTransacao(lar, {
      na: "cartao",
      movement: "compra",
      amountCents: -4000,
      descricao: "CORRETORA X LOJA",
      spendType: "prazeres",
      spendTypeSource: "padrao",
    });
    const criada = await chamar(app, "POST", "/api/automatic-rules", {
      kind: "corretora",
      matchValue: "corretora x",
    });
    expect(criada.status).toBe(201);
    expect(criada.corpo.rule).toMatchObject({ kind: "corretora", matchValue: "CORRETORA X" });
    expect(criada.corpo.applied).toBe(1);
    expect(await lerTransacao(pixAntigo)).toMatchObject({
      spend_type: "investimentos",
      spend_type_source: "regra",
    });
    expect(await lerTransacao(compraCartao)).toMatchObject({
      spend_type: "prazeres",
      spend_type_source: "padrao",
    });

    const pixNovo = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -20000,
      descricao: "[TEST] Pix Novo",
      contraparte: "Corretora X",
    });
    await aplicarDeNovoNaImportacao(lar, pixNovo);
    expect((await lerTransacao(pixNovo)).spend_type).toBe("investimentos");

    const regraId = (criada.corpo.rule as { id: string }).id;
    const apagada = await chamar(app, "DELETE", `/api/automatic-rules/${regraId}`);
    expect(apagada.status).toBe(200);
    expect(apagada.corpo.reverted).toBe(2);
    expect(await lerTransacao(pixAntigo)).toMatchObject({
      spend_type: "prazeres",
      spend_type_source: "padrao",
    });
  });

  it("cenário 6: 'APLICACAO CAIXINHA' vira metas/regra", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const caixinha = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -10000,
      descricao: "[TEST] Caixinha",
      contraparte: "APLICACAO CAIXINHA",
    });
    const r = await chamar(app, "POST", "/api/automatic-rules", {
      kind: "caixinha",
      matchValue: "APLICACAO CAIXINHA",
    });
    expect(r.status).toBe(201);
    expect(await lerTransacao(caixinha)).toMatchObject({ spend_type: "metas", spend_type_source: "regra" });
  });

  it("'Lembrar' em um Pix pendente (origem padrao): o tipo da categoria vem com a regra, na mesma gravação", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const origem = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -3000,
      descricao: "[TEST] Pix Lembrar Origem",
      contraparte: "[TEST] Maria Lembrar",
      spendType: "prazeres",
      spendTypeSource: "padrao",
    });
    const pendente = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -2000,
      descricao: "[TEST] Pix Lembrar Pendente",
      contraparte: "[TEST] Maria Lembrar",
      spendType: "prazeres",
      spendTypeSource: "padrao",
    });
    const r = await chamar(app, "POST", "/api/rules", {
      transactionId: origem,
      set: { categoryId: categoriaDoLar(lar, "mercado") },
      createdFrom: "lembrar",
    });
    expect(r.status).toBe(201);
    expect(r.corpo.alsoResolved).toEqual([pendente]);
    expect(await lerTransacao(pendente)).toMatchObject({
      category_id: categoriaDoLar(lar, "mercado"),
      spend_type: "fixos",
      spend_type_source: "categoria",
    });
  });

  it("apagar uma regra não tira da regra a linha que outra regra do mesmo tipo ainda cobre", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const pix = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -100,
      descricao: "[TEST] Pix Dupla",
      contraparte: "CORRETORA DUPLA X",
    });
    const primeira = await chamar(app, "POST", "/api/automatic-rules", {
      kind: "corretora",
      matchValue: "CORRETORA DUPLA",
    });
    await chamar(app, "POST", "/api/automatic-rules", { kind: "corretora", matchValue: "DUPLA X" });
    const id = (primeira.corpo.rule as { id: string }).id;
    const apagou = await chamar(app, "DELETE", `/api/automatic-rules/${id}`);
    expect(apagou.corpo.reverted).toBe(0);
    expect(await lerTransacao(pix)).toMatchObject({
      spend_type: "investimentos",
      spend_type_source: "regra",
    });
  });

  it("'Lembrar' com tipo Investimentos num boleto: a compra de cartão com a mesma chave vai para a categoria e herda o tipo dela", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const boleto = await inserirTransacao(lar, {
      movement: "boleto",
      amountCents: -5000,
      descricao: "[TEST] ACME",
    });
    const compraCartao = await inserirTransacao(lar, {
      na: "cartao",
      movement: "compra",
      amountCents: -3000,
      descricao: "[TEST] ACME",
      categoryId: categoriaDoLar(lar, "mercado"),
      categorizedBy: "ia",
      spendType: "fixos",
      spendTypeSource: "categoria",
    });
    const r = await chamar(app, "POST", "/api/rules", {
      transactionId: boleto,
      set: { categoryId: categoriaDoLar(lar, "lazer"), spendType: "investimentos" },
      createdFrom: "lembrar",
    });
    expect(r.status).toBe(201);
    expect(r.corpo.alsoResolved).toEqual([compraCartao]);
    expect(await lerTransacao(compraCartao)).toMatchObject({
      category_id: categoriaDoLar(lar, "lazer"),
      spend_type: "prazeres",
      spend_type_source: "categoria",
    });
  });

  it("apagar a regra automática não desfaz o tipo que uma regra do casal deu ('Lembrar' com tipo, com rule_id)", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const origem = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -3000,
      descricao: "[TEST] Pix Zeta Origem",
      contraparte: "CORRETORA ZETA",
      spendType: "prazeres",
      spendTypeSource: "padrao",
    });
    const igual = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -2000,
      descricao: "[TEST] Pix Zeta Igual",
      contraparte: "CORRETORA ZETA",
      spendType: "prazeres",
      spendTypeSource: "padrao",
    });
    // "Lembrar" com categoria e tipo: os iguais pendentes recebem os dois (uma regra só de tipo não alcança os iguais).
    const lembrar = await chamar(app, "POST", "/api/rules", {
      transactionId: origem,
      set: { categoryId: categoriaDoLar(lar, "lazer"), spendType: "investimentos" },
      createdFrom: "lembrar",
    });
    expect(lembrar.status).toBe(201);
    expect(await lerTransacao(igual)).toMatchObject({
      spend_type: "investimentos",
      spend_type_source: "regra",
    });

    const criada = await chamar(app, "POST", "/api/automatic-rules", {
      kind: "corretora",
      matchValue: "corretora zeta",
    });
    expect(criada.corpo.applied).toBe(1);
    const apagada = await chamar(
      app,
      "DELETE",
      `/api/automatic-rules/${(criada.corpo.rule as { id: string }).id}`,
    );
    expect(apagada.corpo.reverted).toBe(1);
    expect(await lerTransacao(igual)).toMatchObject({
      spend_type: "investimentos",
      spend_type_source: "regra",
    });
    expect(await lerTransacao(origem)).toMatchObject({ spend_type: "prazeres", spend_type_source: "padrao" });
  });

  it("regra automática casa a contraparte com acento minúsculo (POST): 'Corretora Ação S.A.', 'João Árvore Investimentos' e 'joão investe'", async () => {
    const casos = [
      { contraparte: "Corretora Ação S.A.", texto: "corretora acao" },
      { contraparte: "João Árvore Investimentos", texto: "joao arvore" },
      { contraparte: "joão investe", texto: "joão investe" },
    ];
    for (const [i, caso] of casos.entries()) {
      const lar = await criarLarExtra();
      const pix = await inserirTransacao(lar, {
        movement: "pix_enviado",
        amountCents: -1000 - i,
        descricao: `[TEST] Pix investimento ${i}`,
        contraparte: caso.contraparte,
      });
      const r = await chamar(appDoLar(lar), "POST", "/api/automatic-rules", {
        kind: "corretora",
        matchValue: caso.texto,
      });
      expect(r.status, caso.contraparte).toBe(201);
      expect(r.corpo.applied, caso.contraparte).toBe(1);
      expect(await lerTransacao(pix), caso.contraparte).toMatchObject({
        spend_type: "investimentos",
        spend_type_source: "regra",
      });
    }
  });

  it("passo 4 (por ids): as mesmas três contrapartes com acento minúsculo viram investimentos/regra", async () => {
    const lar = await criarLar();
    for (const texto of ["CORRETORA ACAO", "JOAO ARVORE", "JOAO INVESTE"]) {
      await env.DB.prepare(
        "INSERT INTO automatic_rules (id, household_id, kind, match_value, created_by, created_at) VALUES (?, ?, 'corretora', ?, ?, ?)",
      )
        .bind(crypto.randomUUID(), lar.householdId, texto, lar.memberId, AGORA)
        .run();
    }
    const ids: string[] = [];
    for (const [i, contraparte] of [
      "Corretora Ação S.A.",
      "João Árvore Investimentos",
      "joão investe",
    ].entries()) {
      ids.push(
        await inserirTransacao(lar, {
          movement: "pix_enviado",
          amountCents: -2000 - i,
          descricao: `[TEST] Pix passo ${i}`,
          contraparte,
        }),
      );
    }
    await applySpendTypesOnImport(createDb(env.DB, newMeter()), lar.householdId, ids);
    for (const id of ids) {
      expect(await lerTransacao(id)).toMatchObject({
        spend_type: "investimentos",
        spend_type_source: "regra",
      });
    }
  });

  it("entrada e pagamento de fatura não ganham tipo: PUT de categoria e rederivação do PATCH deixam spend_type nulo", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const mercado = categoriaDoLar(lar, "mercado");
    const entrada = await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: 9000,
      descricao: "[TEST] Entrada Categoria",
    });
    const fatura = await inserirTransacao(lar, {
      movement: "pagamento_fatura",
      amountCents: -8000,
      descricao: "[TEST] Fatura Categoria",
    });
    expect((await categorizar(app, entrada, mercado)).status).toBe(200);
    expect((await categorizar(app, fatura, mercado)).status).toBe(200);
    expect(await lerTransacao(entrada)).toMatchObject({
      category_id: mercado,
      spend_type: null,
      spend_type_source: null,
    });
    expect(await lerTransacao(fatura)).toMatchObject({ spend_type: null, spend_type_source: null });

    const entradaRederivada = await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: 500,
      descricao: "[TEST] Entrada Rederiva",
      categoryId: mercado,
      categorizedBy: "member",
    });
    const patch = await chamar(app, "PATCH", `/api/categories/${mercado}`, { defaultSpendType: "extras" });
    expect(patch.status).toBe(200);
    expect(await lerTransacao(entradaRederivada)).toMatchObject({
      spend_type: null,
      spend_type_source: null,
    });
  });

  it("passo 4: uma entrada que chega (pix_recebido) não ganha tipo, nem o padrão", async () => {
    const lar = await criarLar();
    const entrada = await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: 9000,
      descricao: "[TEST] Entrada Passo 4",
      contraparte: "[TEST] Pessoa Entrada",
    });
    await aplicarDeNovoNaImportacao(lar, entrada);
    expect(await lerTransacao(entrada)).toMatchObject({ spend_type: null, spend_type_source: null });
  });

  it("a regra automática de um lar não toca a linha de outro lar com o mesmo texto (criar: POST)", async () => {
    const a = await criarLar();
    const b = await criarLarExtra();
    const pixA = await inserirTransacao(a, {
      movement: "pix_enviado",
      amountCents: -1000,
      descricao: "[TEST] Pix Beta A",
      contraparte: "CORRETORA BETA",
    });
    const doB = await chamar(appDoLar(b), "POST", "/api/automatic-rules", {
      kind: "corretora",
      matchValue: "corretora beta",
    });
    expect(doB.corpo.applied).toBe(0);
    const doA = await chamar(appDoLar(a), "POST", "/api/automatic-rules", {
      kind: "corretora",
      matchValue: "outro texto",
    });
    expect(doA.corpo.applied).toBe(0);
    expect(await lerTransacao(pixA)).toMatchObject({ spend_type: null, spend_type_source: null });
  });

  it("passo 4 chamado com o lar A e um id do lar B não toca a linha do lar B, mesmo com regra igual nele", async () => {
    const a = await criarLar();
    const b = await criarLarExtra();
    await env.DB.prepare(
      "INSERT INTO automatic_rules (id, household_id, kind, match_value, created_by, created_at) VALUES (?, ?, 'corretora', 'CORRETORA GAMA', ?, ?)",
    )
      .bind(crypto.randomUUID(), b.householdId, b.memberId, AGORA)
      .run();
    const pixB = await inserirTransacao(b, {
      movement: "pix_enviado",
      amountCents: -1000,
      descricao: "[TEST] Pix Gama B",
      contraparte: "CORRETORA GAMA",
    });
    await applySpendTypesOnImport(createDb(env.DB, newMeter()), a.householdId, [pixB]);
    expect(await lerTransacao(pixB)).toMatchObject({ spend_type: null, spend_type_source: null });
  });

  it("apagar a regra do lar A não reverte a linha de regra do lar B com o mesmo texto", async () => {
    const a = await criarLar();
    const b = await criarLarExtra();
    const pixB = await inserirTransacao(b, {
      movement: "pix_enviado",
      amountCents: -500,
      descricao: "[TEST] Pix Epsilon B",
      contraparte: "CORRETORA EPSILON",
      spendType: "investimentos",
      spendTypeSource: "regra",
    });
    const app = appDoLar(a);
    const criada = await chamar(app, "POST", "/api/automatic-rules", {
      kind: "corretora",
      matchValue: "corretora epsilon",
    });
    expect(criada.corpo.applied).toBe(0);
    const apagada = await chamar(
      app,
      "DELETE",
      `/api/automatic-rules/${(criada.corpo.rule as { id: string }).id}`,
    );
    expect(apagada.status).toBe(200);
    expect(apagada.corpo.reverted).toBe(0);
    expect(await lerTransacao(pixB)).toMatchObject({
      spend_type: "investimentos",
      spend_type_source: "regra",
    });
  });

  it("'Lembrar' com tipo não sobrescreve o igual que a pessoa escolheu (escolhido)", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const origem = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -3000,
      descricao: "[TEST] Lembrar Escolhido Origem",
      contraparte: "[TEST] Ana Escolhida",
      spendType: "prazeres",
      spendTypeSource: "padrao",
    });
    const escolhido = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -2000,
      descricao: "[TEST] Lembrar Escolhido Igual",
      contraparte: "[TEST] Ana Escolhida",
      spendType: "conforto",
      spendTypeSource: "escolhido",
    });
    // Com categoria, o igual pendente entra na regra (uma regra só de tipo não alcança os iguais pendentes). O tipo é
    // livre no cartão (extras), para cair no ramo que grava o tipo da regra.
    const r = await chamar(app, "POST", "/api/rules", {
      transactionId: origem,
      set: { categoryId: categoriaDoLar(lar, "lazer"), spendType: "extras" },
      createdFrom: "lembrar",
    });
    expect(r.status).toBe(201);
    expect(r.corpo.alsoResolved).toEqual([escolhido]);
    expect(await lerTransacao(escolhido)).toMatchObject({
      spend_type: "conforto",
      spend_type_source: "escolhido",
    });
  });

  it("apagar a regra automática não reverte o Pix que a pessoa escolheu como Investimentos (mesmo texto)", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const escolhido = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -4000,
      descricao: "[TEST] Escolhido Omega",
      contraparte: "CORRETORA OMEGA",
      spendType: "investimentos",
      spendTypeSource: "escolhido",
    });
    const criada = await chamar(app, "POST", "/api/automatic-rules", {
      kind: "corretora",
      matchValue: "corretora omega",
    });
    expect(criada.corpo.applied).toBe(0);
    const apagada = await chamar(
      app,
      "DELETE",
      `/api/automatic-rules/${(criada.corpo.rule as { id: string }).id}`,
    );
    expect(apagada.corpo.reverted).toBe(0);
    expect(await lerTransacao(escolhido)).toMatchObject({
      spend_type: "investimentos",
      spend_type_source: "escolhido",
    });
  });

  it("a regra automática não sobrescreve escolhido", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const escolhido = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -3000,
      descricao: "[TEST] Escolhido Corretora",
      contraparte: "CORRETORA ESCOLHIDA",
      spendType: "conforto",
      spendTypeSource: "escolhido",
    });
    await chamar(app, "POST", "/api/automatic-rules", {
      kind: "corretora",
      matchValue: "CORRETORA ESCOLHIDA",
    });
    expect(await lerTransacao(escolhido)).toMatchObject({
      spend_type: "conforto",
      spend_type_source: "escolhido",
    });
  });

  it("passo 4 (por ids): a regra automática não sobrescreve um Pix que a pessoa já escolheu", async () => {
    const lar = await criarLar();
    const escolhido = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -4000,
      descricao: "[TEST] Pix Escolhido Importação",
      contraparte: "CORRETORA IMPORTAÇÃO",
      spendType: "conforto",
      spendTypeSource: "escolhido",
    });
    await env.DB.prepare(
      "INSERT INTO automatic_rules (id, household_id, kind, match_value, created_by, created_at) VALUES (?, ?, 'corretora', 'CORRETORA IMPORTACAO', ?, ?)",
    )
      .bind(crypto.randomUUID(), lar.householdId, lar.memberId, AGORA)
      .run();
    await applySpendTypesOnImport(createDb(env.DB, newMeter()), lar.householdId, [escolhido]);
    expect(await lerTransacao(escolhido)).toMatchObject({
      spend_type: "conforto",
      spend_type_source: "escolhido",
    });
  });

  it("a regra automática só vale para conta: a compra de cartão com o mesmo texto fica como está", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const compra = await inserirTransacao(lar, {
      na: "cartao",
      movement: "compra",
      amountCents: -2000,
      descricao: "[TEST] Loja Caixinha Compra",
      spendType: "prazeres",
      spendTypeSource: "padrao",
    });
    const r = await chamar(app, "POST", "/api/automatic-rules", {
      kind: "caixinha",
      matchValue: "LOJA CAIXINHA COMPRA",
    });
    expect(r.corpo.applied).toBe(0);
    expect((await lerTransacao(compra)).spend_type).toBe("prazeres");
  });

  it("matchValue fora de 3 a 60 caracteres: 400 validacao com a mensagem da spec", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const curta = await chamar(app, "POST", "/api/automatic-rules", { kind: "corretora", matchValue: "xy" });
    expect(curta.status).toBe(400);
    expect(curta.corpo).toMatchObject({ error: "validacao", message: "Use de 3 a 60 letras do extrato." });
    const longa = await chamar(app, "POST", "/api/automatic-rules", {
      kind: "corretora",
      matchValue: "A".repeat(61),
    });
    expect(longa.status).toBe(400);
  });

  it("apagar uma regra de outro lar ou inexistente: 404; sem sessão: 401", async () => {
    const lar = await criarLar();
    const outro = await criarOutroLar();
    const app = appDoLar(lar);
    const criada = await chamar(app, "POST", "/api/automatic-rules", {
      kind: "corretora",
      matchValue: "CORRETORA DO LAR A",
    });
    const id = (criada.corpo.rule as { id: string }).id;
    const deOutro = await chamar(appDoLar(outro), "DELETE", `/api/automatic-rules/${id}`);
    expect(deOutro.status).toBe(404);
    expect((await chamar(app, "DELETE", "/api/automatic-rules/nao-existe")).status).toBe(404);
    const semSessao = await chamar(createApp({}), "POST", "/api/automatic-rules", {
      kind: "corretora",
      matchValue: "ABC",
    });
    expect(semSessao.status).toBe(401);
  });
});

describe("GET /api/spend-types", () => {
  it("sem sessão: 401; de outro lar: só o que é dele", async () => {
    const lar = await criarLar();
    expect((await chamar(createApp({}), "GET", "/api/spend-types")).status).toBe(401);

    await chamar(appDoLar(lar), "POST", "/api/automatic-rules", {
      kind: "corretora",
      matchValue: "SO DO LAR A",
    });
    const outro = await criarOutroLar();
    const deB = await chamar(appDoLar(outro), "GET", "/api/spend-types");
    expect(deB.status).toBe(200);
    expect(deB.corpo.automaticRules).toEqual([]);
  });

  it("devolve percentuais, investimentos, limite, categorias com origem, regras e destinos recentes", async () => {
    const lar = await criarLar();
    await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -5000,
      descricao: "[TEST] Pix Destino",
      contraparte: "[TEST] Fulana",
    });
    const r = await chamar(appDoLar(lar), "GET", "/api/spend-types");
    expect(r.status).toBe(200);
    expect(r.corpo.percentages).toEqual({
      fixos: 35,
      conforto: 10,
      educacao: 5,
      extras: 5,
      metas: 10,
      prazeres: 10,
    });
    expect(r.corpo.investmentsPct).toBe(25);
    expect(r.corpo.limitPct).toBe(65);
    expect(r.corpo.base).toBeNull();
    expect(r.corpo.currentLimit).toBeNull();
    const categorias = r.corpo.categories as { name: string; origin: string; effectiveSpendType: string }[];
    expect(categorias.find((c) => c.name === "Mercado")).toMatchObject({
      origin: "categoria",
      effectiveSpendType: "fixos",
    });
    expect(categorias.find((c) => c.name === "Outros")).toMatchObject({
      origin: "padrao",
      effectiveSpendType: "prazeres",
    });
    expect(categorias.find((c) => c.name === "Academia")).toMatchObject({
      origin: "categoria",
      effectiveSpendType: "fixos",
    });
    expect(categorias.find((c) => c.name === "Farmácia")).toMatchObject({
      origin: "categoria",
      effectiveSpendType: "extras",
    });
    expect(categorias.find((c) => c.name === "Cuidados pessoais")).toMatchObject({ origin: "padrao" });
    expect(r.corpo.recentDestinations).toEqual([{ name: "[TEST] Fulana", bank: null }]);
  });

  it("com a fotografia do ciclo preenchida: base e limite do ciclo atual", async () => {
    const lar = await criarLar();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO cycles (household_id, key, starts_on, ends_on) VALUES (?, '2026-09', '2026-09-11', '2026-10-10')",
      ).bind(lar.householdId),
      env.DB.prepare(
        "INSERT INTO cycles (household_id, key, starts_on, ends_on, prev_income_cents, spend_limit_cents, pct_fixed, pct_comfort, pct_education, pct_extras, pct_pleasures) VALUES (?, '2026-10', '2026-10-11', '2026-11-10', 1656870, 1076966, 35, 10, 5, 5, 10)",
      ).bind(lar.householdId),
    ]);
    const r = await chamar(appDoLar(lar), "GET", "/api/spend-types");
    expect(r.corpo.base).toEqual({ cycleKey: "2026-09", label: "setembro", prevIncomeCents: 1656870 });
    expect(r.corpo.currentLimit).toEqual({ cycleKey: "2026-10", spendLimitCents: 1076966, pct: 65 });
  });
});

describe("rederivação ao mudar o tipo padrão da categoria (PATCH /api/categories)", () => {
  it("cenário 8: a categoria e a subcategoria sem tipo recebem o tipo novo; subcategoria com tipo próprio não", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const mae = await criarCategoria(lar, {
      id: `[TEST]-m-${lar.householdId}`,
      nome: "[TEST] Mãe Tipo",
      tipo: "fixos",
    });
    const filhaSem = await criarCategoria(lar, {
      id: `[TEST]-fs-${lar.householdId}`,
      nome: "[TEST] Filha sem",
      parentId: mae,
    });
    const filhaCom = await criarCategoria(lar, {
      id: `[TEST]-fc-${lar.householdId}`,
      nome: "[TEST] Filha com",
      parentId: mae,
      tipo: "extras",
    });
    const a = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -100,
      descricao: "[TEST] A Tipo",
      categoryId: mae,
      categorizedBy: "member",
      spendType: "fixos",
      spendTypeSource: "categoria",
    });
    const b = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -100,
      descricao: "[TEST] B Tipo",
      categoryId: filhaSem,
      categorizedBy: "member",
      spendType: "fixos",
      spendTypeSource: "categoria",
    });
    const c = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -100,
      descricao: "[TEST] C Tipo",
      categoryId: filhaCom,
      categorizedBy: "member",
      spendType: "extras",
      spendTypeSource: "categoria",
    });
    expect(
      (await chamar(app, "PATCH", `/api/categories/${mae}`, { defaultSpendType: "conforto" })).status,
    ).toBe(200);
    expect(await lerTransacao(a)).toMatchObject({ spend_type: "conforto", spend_type_source: "categoria" });
    expect((await lerTransacao(b)).spend_type).toBe("conforto");
    expect((await lerTransacao(c)).spend_type).toBe("extras");
  });
});

describe("carga inicial da migração 0008 (UPDATE em SQL)", () => {
  it("num banco com dados [TEST]: herda a categoria, senão prazeres/padrao; entradas e fatura ficam sem tipo", async () => {
    const lar = await criarLar();
    const mercado = categoriaDoLar(lar, "mercado");
    const viagem = await criarCategoria(lar, {
      id: `[TEST]-mig-viagem-${lar.householdId}`,
      nome: "[TEST] Viagem mig",
      tipo: "metas",
    });
    const semCategoria = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -100,
      descricao: "[TEST] Sem Cat",
    });
    const comMercado = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -200,
      descricao: "[TEST] Com Mercado",
      categoryId: mercado,
      categorizedBy: "member",
    });
    const cartaoMetas = await inserirTransacao(lar, {
      na: "cartao",
      movement: "compra",
      amountCents: -300,
      descricao: "[TEST] Cartao Metas",
      categoryId: viagem,
      categorizedBy: "member",
    });
    const pixMetas = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -400,
      descricao: "[TEST] Pix Metas",
      categoryId: viagem,
      categorizedBy: "member",
      contraparte: "[TEST] Pix Migração",
    });
    const estorno = await inserirTransacao(lar, {
      movement: "estorno",
      amountCents: 500,
      descricao: "[TEST] Estorno",
    });
    const entrada = await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: 9000,
      descricao: "[TEST] Entrada",
    });
    const fatura = await inserirTransacao(lar, {
      movement: "pagamento_fatura",
      amountCents: -8000,
      descricao: "[TEST] Fatura",
    });
    for (const id of [semCategoria, comMercado, cartaoMetas, pixMetas, estorno, entrada, fatura]) {
      await env.DB.prepare("UPDATE transactions SET spend_type = NULL, spend_type_source = NULL WHERE id = ?")
        .bind(id)
        .run();
    }

    // A carga é o último trecho da migração 0008 (depois do CREATE TABLE gerado pelo drizzle-kit).
    const migracao = env.TEST_MIGRATIONS.find((m) => m.name.startsWith("0008_"));
    const carga = migracao?.queries.at(-1) ?? "";
    expect(carga).toContain("UPDATE transactions AS t SET spend_type");
    await env.DB.prepare(carga).run();

    expect(await lerTransacao(semCategoria)).toMatchObject({
      spend_type: "prazeres",
      spend_type_source: "padrao",
    });
    expect(await lerTransacao(comMercado)).toMatchObject({
      spend_type: "fixos",
      spend_type_source: "categoria",
    });
    expect(await lerTransacao(cartaoMetas)).toMatchObject({
      spend_type: "prazeres",
      spend_type_source: "padrao",
    });
    expect(await lerTransacao(pixMetas)).toMatchObject({
      spend_type: "metas",
      spend_type_source: "categoria",
    });
    expect(await lerTransacao(estorno)).toMatchObject({
      spend_type: "prazeres",
      spend_type_source: "padrao",
    });
    expect((await lerTransacao(entrada)).spend_type).toBeNull();
    expect((await lerTransacao(fatura)).spend_type).toBeNull();
  });
});

// Roda a carga da migração 0008 (a última consulta do arquivo) no banco de teste.
async function rodarCargaDaMigracao(): Promise<void> {
  const migracao = env.TEST_MIGRATIONS.find((m) => m.name.startsWith("0008_"));
  const carga = migracao?.queries.at(-1) ?? "";
  expect(carga).toContain("UPDATE transactions AS t SET spend_type");
  await env.DB.prepare(carga).run();
}

describe("carga da migração 0008: a trava e a linha que já tem tipo", () => {
  it("cartão em subcategoria sem tipo próprio cuja mãe é Metas cai para prazeres/padrao (a trava vale na mãe)", async () => {
    const lar = await criarLar();
    const mae = await criarCategoria(lar, {
      id: `[TEST]-mig-mae-${lar.householdId}`,
      nome: "[TEST] Mãe Metas mig",
      tipo: "metas",
    });
    const sub = await criarCategoria(lar, {
      id: `[TEST]-mig-sub-m-${lar.householdId}`,
      nome: "[TEST] Sub Metas mig",
      parentId: mae,
    });
    const cartao = await inserirTransacao(lar, {
      na: "cartao",
      movement: "compra",
      amountCents: -700,
      descricao: "[TEST] Cartao Sub Metas",
      categoryId: sub,
      categorizedBy: "member",
    });
    const pix = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -800,
      descricao: "[TEST] Pix Sub Metas",
      contraparte: "[TEST] Pix Sub Metas",
      categoryId: sub,
      categorizedBy: "member",
    });
    for (const id of [cartao, pix]) {
      await env.DB.prepare("UPDATE transactions SET spend_type = NULL, spend_type_source = NULL WHERE id = ?")
        .bind(id)
        .run();
    }
    await rodarCargaDaMigracao();
    expect(await lerTransacao(cartao)).toMatchObject({ spend_type: "prazeres", spend_type_source: "padrao" });
    expect(await lerTransacao(pix)).toMatchObject({ spend_type: "metas", spend_type_source: "categoria" });
  });

  it("a linha que já tem tipo (regra ou escolhido) não muda; a carga só dá tipo a quem não tem", async () => {
    const lar = await criarLar();
    const comRegra = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -900,
      descricao: "[TEST] Ja Regra",
      spendType: "extras",
      spendTypeSource: "regra",
    });
    const escolhida = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -950,
      descricao: "[TEST] Ja Escolhida",
      contraparte: "[TEST] Ja Escolhida",
      spendType: "conforto",
      spendTypeSource: "escolhido",
    });
    await rodarCargaDaMigracao();
    expect(await lerTransacao(comRegra)).toMatchObject({ spend_type: "extras", spend_type_source: "regra" });
    expect(await lerTransacao(escolhida)).toMatchObject({
      spend_type: "conforto",
      spend_type_source: "escolhido",
    });
  });
});

describe("espelho em TypeScript e SQL dão o mesmo tipo", () => {
  it("categoria com tipo, mãe, cartão e padrão: o mesmo tipo e origem nas duas pontas", async () => {
    const lar = await criarLar();
    const mae = await criarCategoria(lar, {
      id: `[TEST]-sm-m-${lar.householdId}`,
      nome: "[TEST] SM Mãe",
      tipo: "educacao",
    });
    const filha = await criarCategoria(lar, {
      id: `[TEST]-sm-f-${lar.householdId}`,
      nome: "[TEST] SM Filha",
      parentId: mae,
    });
    const metasCat = await criarCategoria(lar, {
      id: `[TEST]-sm-g-${lar.householdId}`,
      nome: "[TEST] SM Metas",
      tipo: "metas",
    });
    const casos = [
      { cat: filha, cartao: false, tipoCategoria: null, tipoMae: "educacao" },
      { cat: filha, cartao: true, tipoCategoria: null, tipoMae: "educacao" },
      { cat: metasCat, cartao: true, tipoCategoria: "metas", tipoMae: null },
      { cat: metasCat, cartao: false, tipoCategoria: "metas", tipoMae: null },
      { cat: null, cartao: true, tipoCategoria: null, tipoMae: null },
    ];
    const sql = tipoDaCategoriaSql("t.category_id");
    for (const caso of casos) {
      const id = await inserirTransacao(lar, {
        na: caso.cartao ? "cartao" : "conta",
        movement: "compra",
        amountCents: -100,
        descricao: `[TEST] SM ${caso.cat ?? "nula"}`,
      });
      await env.DB.prepare(
        `UPDATE transactions SET category_id = ?, spend_type = NULL, spend_type_source = NULL WHERE id = ?`,
      )
        .bind(caso.cat, id)
        .run();
      await env.DB.prepare(
        `UPDATE transactions AS t SET spend_type = ${sql.tipo}, spend_type_source = ${sql.origem} WHERE t.id = ?`,
      )
        .bind(id)
        .run();
      const espelho = resolveSpendType({
        atual: { spendType: null, source: null },
        cartao: caso.cartao,
        tipoCategoria: caso.tipoCategoria,
        tipoMae: caso.tipoMae,
      });
      expect(await lerTransacao(id)).toMatchObject({
        spend_type: espelho.spendType,
        spend_type_source: espelho.source,
      });
    }
  });
});

describe("leitura por id da importação não cresce com o lar (json_each com CROSS JOIN)", () => {
  it("passo 4 com 100 ids: rowsRead igual num lar de 200 e num de 5.000 transações", async () => {
    const lar = await criarLar();
    await inserirComprasEmLote(lar, 200, "[TEST] Lote Tipo");
    const ids = (
      await env.DB.prepare("SELECT id FROM transactions WHERE household_id = ? ORDER BY id LIMIT 100")
        .bind(lar.householdId)
        .all<{ id: string }>()
    ).results.map((linha) => linha.id);
    expect(ids).toHaveLength(100);

    async function medir(): Promise<number> {
      // Estado igual nas duas medidas: as 100 linhas sem origem (como na gravação nova).
      await env.DB.prepare(
        "UPDATE transactions SET spend_type = NULL, spend_type_source = NULL WHERE id IN (SELECT value FROM json_each(?))",
      )
        .bind(JSON.stringify(ids))
        .run();
      const medidor = newMeter();
      await applySpendTypesOnImport(createDb(env.DB, medidor), lar.householdId, ids);
      console.info(
        `[medicao] passo 4, 100 ids: calls=${medidor.calls} statements=${medidor.statements} rowsRead=${medidor.rowsRead} rowsWritten=${medidor.rowsWritten}`,
      );
      expect(medidor.calls).toBeLessThanOrEqual(1);
      expect(medidor.rowsWritten).toBe(100);
      return medidor.rowsRead;
    }
    const pequeno = await medir();
    // Mais 4.800 compras no mesmo lar (ids novos); a lista de 100 é a mesma.
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 4800)
       INSERT INTO transactions (id, household_id, external_id, bank_item_id, card_id, movement, occurred_at, local_date,
         amount_cents, original_description, establishment_key, last_seen_at)
       SELECT 'lote5k-' || i, ?, 'lote5k-ext-' || i, ?, ?, 'compra', '2026-11-05T12:00:00.000Z', '2026-11-05',
         -1000, '[TEST] Lote Tipo', 'TEST LOTE TIPO', ? FROM n`,
    )
      .bind(lar.householdId, lar.bankItemId, lar.cardId, AGORA)
      .run();
    const grande = await medir();
    expect(Math.abs(grande - pequeno) / pequeno).toBeLessThanOrEqual(0.05);
  });
});

describe("compra no cartão nunca é Metas nem Investimentos", () => {
  it("assertSpendTypeAllowed recusa Metas e Investimentos num cartão; a conta aceita", () => {
    expect(() => assertSpendTypeAllowed({ cardId: "c" }, "metas")).toThrow(
      "Compra no cartão nunca é Metas nem Investimentos.",
    );
    expect(() => assertSpendTypeAllowed({ cardId: "c" }, "investimentos")).toThrow();
    expect(() => assertSpendTypeAllowed({ cardId: null }, "investimentos")).not.toThrow();
    expect(() => assertSpendTypeAllowed({ cardId: "c" }, "conforto")).not.toThrow();
  });
});
