import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/worker/app";
import { afterIngest } from "../../src/worker/bank/after-ingest";
import { applyRuleRetroactiveSliceStmts } from "../../src/worker/categorization/apply";
import { processNewTransactions } from "../../src/worker/categorization/pipeline";
import { createDb } from "../../src/worker/db/client";
import { newMeter } from "../../src/worker/db/metered-d1";
import type { AppEnv } from "../../src/worker/env";
import { aquecerOPortao, semearPronto } from "./helpers/app";
import {
  AGORA,
  categoriaDoLar,
  criarLar,
  criarOutroLar,
  criarRegra,
  inserirTransacao,
  type Lar,
  lerTransacao,
} from "./helpers/regras";

// Testes permanentes das sete mutações da avaliação da TASK-0302 (Fable, 2026-11-08). Cada teste reprova com a
// mutação correspondente aplicada no código e passa no código original. A tabela de mutações está nas Evidências.

beforeEach(async () => {
  await semearPronto(env.DB);
  await aquecerOPortao(createApp({}));
});

type App = Hono<AppEnv>;
type Resposta = { status: number; corpo: Record<string, unknown> };

async function chamar(app: App, method: string, path: string, body?: unknown): Promise<Resposta> {
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

const appDoLar = (lar: Lar): App => createApp({ resolveSession: async () => lar });

const SERVICOS = (lar: Lar): string => categoriaDoLar(lar, "servicos");
const CHAVE_JOSE = "PAG*JOSEDASILVA";
const pipeline = () => createDb(env.DB, newMeter());

// Segundo lar com conta e cartão, para a compra de outro lar. criarLar só cabe uma vez na instalação.
async function criarLarComConta(): Promise<Lar> {
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
      "INSERT INTO cards (id, bank_item_id, last4, name) VALUES (?, ?, '5678', '[TEST] Cartão')",
    ).bind(cardId, bankItemId),
  ]);
  return { householdId, memberId, bankItemId, accountId, cardId };
}

describe("mutações da TASK-0302: cada teste mata uma delas", () => {
  it("Mu1: a fatia retroativa de um lar não grava na compra de outro lar com a mesma chave", async () => {
    const a = await criarLar();
    const b = await criarLarComConta();
    const regra = await criarRegra(a, {
      scope: "estabelecimento",
      matchValue: CHAVE_JOSE,
      setCategoryId: SERVICOS(a),
    });
    const compraA = await inserirTransacao(a, {
      movement: "compra",
      amountCents: -4590,
      descricao: CHAVE_JOSE,
    });
    const compraB = await inserirTransacao(b, {
      movement: "compra",
      amountCents: -4590,
      descricao: CHAVE_JOSE,
    });

    const db = pipeline();
    await db.$client.batch(
      applyRuleRetroactiveSliceStmts(db, {
        householdId: a.householdId,
        ruleId: regra,
        excludeTransactionId: null,
        now: AGORA,
      }),
    );

    expect((await lerTransacao(compraA)).category_id).toBe(SERVICOS(a));
    expect((await lerTransacao(compraB)).category_id).toBeNull();
    expect((await lerTransacao(compraB)).categorized_by).toBeNull();
  });

  it("Mu2: 'Lembrar' não põe categoria numa transação removida (removed_at)", async () => {
    const lar = await criarLar();
    const pix = (extra: { removedAt?: string } = {}) =>
      inserirTransacao(lar, {
        movement: "pix_enviado",
        amountCents: -2000,
        descricao: "[TEST] Pix enviado",
        contraparte: "[TEST] Maria",
        doc: "***.456.789-**",
        ...extra,
      });
    const origem = await pix();
    const removida = await pix({ removedAt: AGORA });

    const resposta = await chamar(appDoLar(lar), "POST", "/api/rules", {
      transactionId: origem,
      set: { categoryId: SERVICOS(lar) },
      createdFrom: "lembrar",
    });

    expect(resposta.status).toBe(201);
    expect(resposta.corpo.alsoResolved).toEqual([]);
    expect((await lerTransacao(removida)).category_id).toBeNull();
  });

  it("Mu3: a importação aplica a regra às transações inseridas, nunca às só atualizadas", async () => {
    const lar = await criarLar();
    await criarRegra(lar, { scope: "estabelecimento", matchValue: CHAVE_JOSE, setCategoryId: SERVICOS(lar) });
    const atualizada = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -4590,
      descricao: CHAVE_JOSE,
    });
    const inserida = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -3100,
      descricao: CHAVE_JOSE,
    });

    await afterIngest(pipeline(), {
      householdId: lar.householdId,
      bankItemId: lar.bankItemId,
      insertedIds: [inserida],
      updatedIds: [atualizada],
      now: AGORA,
    });

    expect((await lerTransacao(inserida)).category_id).toBe(SERVICOS(lar));
    expect((await lerTransacao(atualizada)).category_id).toBeNull();
  });

  it("Mu4: a regra que põe movimento trava o movimento (movement_locked = 1) na importação", async () => {
    const lar = await criarLar();
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: CHAVE_JOSE,
      setMovement: "pagamento_fatura",
    });
    const id = await inserirTransacao(lar, { movement: "compra", amountCents: -4590, descricao: CHAVE_JOSE });

    await processNewTransactions(pipeline(), lar.householdId, [id], AGORA);

    const linha = await lerTransacao(id);
    expect(linha.movement).toBe("pagamento_fatura");
    expect(linha.movement_locked).toBe(1);
  });

  it("Mu5: a compra que a regra torna pagamento de fatura não fica pendente", async () => {
    const lar = await criarLar();
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: "PAG*FATURA BANCO",
      setMovement: "pagamento_fatura",
    });
    const id = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -4590,
      descricao: "PAG*FATURA BANCO",
    });

    const resultado = await processNewTransactions(pipeline(), lar.householdId, [id], AGORA);

    expect((await lerTransacao(id)).movement).toBe("pagamento_fatura");
    expect(resultado.pending).toEqual([]);
  });

  it("Mu6: sem chave de estabelecimento não há rótulo para 'Aplicar a todas'", async () => {
    const lar = await criarLar();
    const id = await inserirTransacao(lar, { movement: "compra", amountCents: -100, descricao: "   " });

    const resposta = await chamar(appDoLar(lar), "GET", `/api/transactions/${id}/categorization`);

    expect(resposta.status).toBe(200);
    expect(resposta.corpo.matchLabel).toBeNull();
  });

  it("Mu7: 'Lembrar' de um Pix enviado não põe categoria num Pix recebido com o mesmo nome e documento", async () => {
    const lar = await criarLar();
    const origem = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -2000,
      descricao: "[TEST] Pix enviado",
      contraparte: "[TEST] Maria",
      doc: "***.456.789-**",
    });
    const recebido = await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: 2000,
      descricao: "[TEST] Pix recebido",
      contraparte: "[TEST] Maria",
      doc: "***.456.789-**",
    });

    const resposta = await chamar(appDoLar(lar), "POST", "/api/rules", {
      transactionId: origem,
      set: { categoryId: SERVICOS(lar) },
      createdFrom: "lembrar",
    });

    expect(resposta.status).toBe(201);
    expect((await lerTransacao(recebido)).category_id).toBeNull();
  });
});
