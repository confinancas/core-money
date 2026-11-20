import { env } from "cloudflare:test";
import type { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { DetalheDaCompraSchema } from "../../../src/shared/api/transactions";
import { createApp } from "../../../src/worker/app";
import type { AppEnv } from "../../../src/worker/env";
import { aquecerOPortao, callApi, semearPronto } from "../helpers/app";
import {
  AGORA,
  categoriaDoLar,
  criarLar,
  criarOutroLar,
  criarRegra,
  inserirTransacao,
  type Lar,
  lerTransacao,
} from "../helpers/regras";

// Pix enviado (TASK-0404): GET com os campos de Pix, PATCH de cardWouldAccept, PUT card-payment (ligar e desligar), e a
// regra do destinatário (decisão 2: a regra com movimento não grava categoria; desligar devolve a categoria). Dados [TEST].

beforeEach(async () => {
  await semearPronto(env.DB);
  await aquecerOPortao(createApp({}));
});

const appDoLar = (lar: { householdId: string; memberId: string }): Hono<AppEnv> =>
  createApp({ resolveSession: async () => lar, agora: () => new Date(AGORA) });

async function pixEnviado(lar: Lar, contraparte: string, categoryId: string | null = null): Promise<string> {
  return inserirTransacao(lar, {
    na: "conta",
    movement: "pix_enviado",
    amountCents: -15000,
    descricao: `PIX ENVIADO ${contraparte}`,
    localDate: "2026-11-05",
    contraparte,
    doc: "•••.456.789-••",
    categoryId,
    spendType: categoryId ? "fixos" : null,
    spendTypeSource: categoryId ? "categoria" : null,
  });
}

async function compraNoCartao(lar: Lar): Promise<string> {
  return inserirTransacao(lar, {
    na: "cartao",
    movement: "compra",
    amountCents: -4500,
    descricao: "[TEST] PADARIA",
    localDate: "2026-11-05",
  });
}

describe("GET /api/transactions/:id com Pix (TASK-0404)", () => {
  it("devolve a contraparte, o docKind pelas posições, a origem e as flags de cartão", async () => {
    const lar = await criarLar();
    const id = await pixEnviado(lar, "[TEST] JOAO P SILVA");
    const resposta = await callApi(appDoLar(lar), "GET", `/api/transactions/${id}`);
    expect(resposta.status).toBe(200);
    const corpo = DetalheDaCompraSchema.parse(await resposta.json());
    expect(corpo.counterparty?.name).toBe("[TEST] JOAO P SILVA");
    expect(corpo.counterparty?.docKind).toBe("cpf");
    expect(corpo.origin?.institution).not.toBeUndefined();
    expect(corpo.cardWouldAccept).toBe(false);
    expect(corpo.isCardPayment).toBe(false);
    expect(corpo.canMarkCardPayment).toBe(true);
  });

  it("não traz contraparte numa compra de cartão e não deixa marcar pagamento", async () => {
    const lar = await criarLar();
    const id = await compraNoCartao(lar);
    const corpo = DetalheDaCompraSchema.parse(
      await (await callApi(appDoLar(lar), "GET", `/api/transactions/${id}`)).json(),
    );
    expect(corpo.counterparty).toBeNull();
    expect(corpo.canMarkCardPayment).toBe(false);
  });

  it("isola por lar: id de outro lar responde 404", async () => {
    const lar = await criarLar();
    const outro = await criarOutroLar();
    const id = await pixEnviado(lar, "[TEST] JOAO P SILVA");
    const resposta = await callApi(appDoLar(outro), "GET", `/api/transactions/${id}`);
    expect(resposta.status).toBe(404);
  });
});

describe("PATCH cardWouldAccept (TASK-0404)", () => {
  it("grava no Pix e recusa na compra de cartão com 422 movimento_invalido", async () => {
    const lar = await criarLar();
    const pix = await pixEnviado(lar, "[TEST] JOAO P SILVA");
    const ok = await callApi(appDoLar(lar), "PATCH", `/api/transactions/${pix}`, { cardWouldAccept: true });
    expect(ok.status).toBe(200);
    const aceita = await env.DB.prepare("SELECT card_would_accept AS v FROM transactions WHERE id = ?")
      .bind(pix)
      .first<{ v: number }>();
    expect(aceita?.v).toBe(1);

    const compra = await compraNoCartao(lar);
    const recusa = await callApi(appDoLar(lar), "PATCH", `/api/transactions/${compra}`, {
      cardWouldAccept: true,
    });
    expect(recusa.status).toBe(422);
    expect(JSON.stringify(await recusa.json())).toContain("movimento_invalido");
  });
});

describe("PUT /api/transactions/:id/card-payment (TASK-0404)", () => {
  it("ligar: sai do gasto (movement pagamento_fatura), marca os iguais pendentes e volta com desligar", async () => {
    const lar = await criarLar();
    const pix = await pixEnviado(lar, "[TEST] NU PAGAMENTOS");
    const igual = await pixEnviado(lar, "[TEST] NU PAGAMENTOS");

    const ligar = await callApi(appDoLar(lar), "PUT", `/api/transactions/${pix}/card-payment`, {
      isCardPayment: true,
    });
    expect(ligar.status).toBe(200);
    expect(await ligar.json()).toEqual({ isCardPayment: true, alsoMarked: 1 });
    expect((await lerTransacao(pix)).movement).toBe("pagamento_fatura");
    expect((await lerTransacao(igual)).movement).toBe("pagamento_fatura");

    const desligar = await callApi(appDoLar(lar), "PUT", `/api/transactions/${pix}/card-payment`, {
      isCardPayment: false,
    });
    expect(desligar.status).toBe(200);
    expect((await lerTransacao(pix)).movement).toBe("pix_enviado");
  });

  it("recusa com 422 numa compra de cartão", async () => {
    const lar = await criarLar();
    const compra = await compraNoCartao(lar);
    const resposta = await callApi(appDoLar(lar), "PUT", `/api/transactions/${compra}/card-payment`, {
      isCardPayment: true,
    });
    expect(resposta.status).toBe(422);
  });

  it("decisão 2a: regra com categoria + ligar: o igual recebe só o movimento, sem categoria", async () => {
    const lar = await criarLar();
    const servicos = categoriaDoLar(lar, "servicos");
    await criarRegra(lar, {
      scope: "destinatario",
      matchValue: "[TEST] DIARISTA|•••.456.789-••",
      setCategoryId: servicos,
      createdFrom: "lembrar",
    });
    const pix = await pixEnviado(lar, "[TEST] DIARISTA", servicos);
    const igual = await pixEnviado(lar, "[TEST] DIARISTA");

    const ligar = await callApi(appDoLar(lar), "PUT", `/api/transactions/${pix}/card-payment`, {
      isCardPayment: true,
    });
    expect(ligar.status).toBe(200);
    const linhaIgual = await lerTransacao(igual);
    expect(linhaIgual.movement).toBe("pagamento_fatura");
    expect(linhaIgual.category_id).toBeNull();
  });

  it("decisão 2b: desligar devolve o pix à base e a regra fica ativa com a categoria de antes", async () => {
    const lar = await criarLar();
    const servicos = categoriaDoLar(lar, "servicos");
    await criarRegra(lar, {
      scope: "destinatario",
      matchValue: "[TEST] DIARISTA|•••.456.789-••",
      setCategoryId: servicos,
      createdFrom: "lembrar",
    });
    const pix = await pixEnviado(lar, "[TEST] DIARISTA", servicos);
    await callApi(appDoLar(lar), "PUT", `/api/transactions/${pix}/card-payment`, { isCardPayment: true });
    const desligar = await callApi(appDoLar(lar), "PUT", `/api/transactions/${pix}/card-payment`, {
      isCardPayment: false,
    });
    expect(desligar.status).toBe(200);
    expect((await lerTransacao(pix)).movement).toBe("pix_enviado");

    const regras = await env.DB.prepare(
      "SELECT set_category_id, set_movement, disabled_at FROM rules WHERE household_id = ? AND scope = 'destinatario' AND disabled_at IS NULL",
    )
      .bind(lar.householdId)
      .all<{ set_category_id: string | null; set_movement: string | null; disabled_at: string | null }>();
    expect(regras.results.length).toBe(1);
    expect(regras.results[0]?.set_category_id).toBe(servicos);
    expect(regras.results[0]?.set_movement).toBeNull();
  });
});
