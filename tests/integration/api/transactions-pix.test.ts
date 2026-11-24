import { env } from "cloudflare:test";
import type { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { DetalheDaCompraSchema } from "../../../src/shared/api/transactions";
import { createApp } from "../../../src/worker/app";
import { reconcileHousehold } from "../../../src/worker/bank/classify";
import { processNewTransactions } from "../../../src/worker/categorization/pipeline";
import { SPENT_IN_LIMIT_SQL } from "../../../src/worker/cycle/predicates";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import type { AppEnv } from "../../../src/worker/env";
import { aquecerOPortao, callApi, semearPronto } from "../helpers/app";
import {
  AGORA,
  categoriaDoLar,
  contar,
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

  it("passo 4 no desligar: a saída que volta recebe o tipo padrão e a origem 'padrao'", async () => {
    const lar = await criarLar();
    const pix = await pixEnviado(lar, "[TEST] NU PAGAMENTOS");
    await callApi(appDoLar(lar), "PUT", `/api/transactions/${pix}/card-payment`, { isCardPayment: true });
    const linhaLigada = await env.DB.prepare(
      "SELECT spend_type, spend_type_source FROM transactions WHERE id = ?",
    )
      .bind(pix)
      .first<{ spend_type: string | null; spend_type_source: string | null }>();
    expect(linhaLigada?.spend_type_source).toBeNull();

    const desligar = await callApi(appDoLar(lar), "PUT", `/api/transactions/${pix}/card-payment`, {
      isCardPayment: false,
    });
    expect(desligar.status).toBe(200);
    const linha = await env.DB.prepare("SELECT spend_type, spend_type_source FROM transactions WHERE id = ?")
      .bind(pix)
      .first<{ spend_type: string | null; spend_type_source: string | null }>();
    expect(linha?.spend_type).toBe("prazeres");
    expect(linha?.spend_type_source).toBe("padrao");
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

// ---------------------------------------------------------------------------------------------------------------------
// Rodada de correção (2026-11-22): cenários 16 a 18 completos, Metas, Lembrar, guardas do PUT e as mutações que
// sobreviveram na avaliação da Fable.

const pipeline = () => createDb(env.DB, newMeter());
const NU_CHAVE = "[TEST] NU PAGAMENTOS|•••.456.789-••";

type ItemDaFila = { transactionId: string };
async function fila(lar: Lar): Promise<{ todos: number; ids: string[] }> {
  const resposta = await callApi(appDoLar(lar), "GET", "/api/categorization/queue?filtro=todos");
  const corpo = (await resposta.json()) as { counts: { todos: number }; items: ItemDaFila[] };
  return { todos: corpo.counts.todos, ids: corpo.items.map((i) => i.transactionId) };
}

const gastoNoLimite = (lar: Lar): Promise<number> =>
  contar(
    `SELECT COUNT(*) AS total FROM transactions AS t WHERE t.household_id = ? AND ${SPENT_IN_LIMIT_SQL}`,
    lar.householdId,
  );

const ligarPagamento = (lar: { householdId: string; memberId: string }, id: string, isCardPayment: boolean) =>
  callApi(appDoLar(lar), "PUT", `/api/transactions/${id}/card-payment`, { isCardPayment });

async function detalhe(lar: Lar, id: string) {
  const resposta = await callApi(appDoLar(lar), "GET", `/api/transactions/${id}`);
  return DetalheDaCompraSchema.parse(await resposta.json());
}

async function regrasDoLar(lar: Lar) {
  const regras = await env.DB.prepare(
    "SELECT id, scope, match_value, set_category_id, set_movement, created_from, disabled_at FROM rules WHERE household_id = ?",
  )
    .bind(lar.householdId)
    .all<{
      id: string;
      scope: string;
      match_value: string;
      set_category_id: string | null;
      set_movement: string | null;
      created_from: string;
      disabled_at: string | null;
    }>();
  return regras.results;
}

describe("detalhe do Pix: base do movimento, rótulo da conexão e a chave", () => {
  it("devolve baseMovement, a instituição e o rótulo da conexão; ligado, isCardPayment e a base do Pix", async () => {
    const lar = await criarLar();
    const id = await pixEnviado(lar, "[TEST] NU PAGAMENTOS");
    const antes = await detalhe(lar, id);
    expect(antes.baseMovement).toBe("pix_enviado");
    expect(antes.origin).toEqual({ institution: "[TEST] Banco", connectionLabel: "[TEST] Conexão" });
    expect(antes.isCardPayment).toBe(false);

    await ligarPagamento(lar, id, true);
    const ligado = await detalhe(lar, id);
    expect(ligado.movement).toBe("pagamento_fatura");
    expect(ligado.baseMovement).toBe("pix_enviado");
    expect(ligado.isCardPayment).toBe(true);
    expect(ligado.displayName).toBe("Pix para [TEST] NU PAGAMENTOS");
  });

  it("a categorização de um Pix marcado como pagamento segue com o escopo e o rótulo do destinatário", async () => {
    const lar = await criarLar();
    const id = await pixEnviado(lar, "[TEST] NU PAGAMENTOS");
    await ligarPagamento(lar, id, true);
    const resposta = await callApi(appDoLar(lar), "GET", `/api/transactions/${id}/categorization`);
    const corpo = (await resposta.json()) as { scope: string | null; matchLabel: string | null };
    expect(corpo.scope).toBe("destinatario");
    expect(corpo.matchLabel).toBe("[TEST] NU PAGAMENTOS");
  });
});

describe("cenário 16: Pix que paga a fatura", () => {
  it("sai da fila e do gasto do limite, marca o igual, e o próximo Pix para o mesmo destino entra sozinho", async () => {
    const lar = await criarLar();
    const pix = await pixEnviado(lar, "[TEST] NU PAGAMENTOS");
    const igual = await pixEnviado(lar, "[TEST] NU PAGAMENTOS");
    const outro = await pixEnviado(lar, "[TEST] DIARISTA");
    expect((await fila(lar)).ids.sort()).toEqual([pix, igual, outro].sort());
    expect(await gastoNoLimite(lar)).toBe(3);

    const resposta = await ligarPagamento(lar, pix, true);
    expect(await resposta.json()).toEqual({ isCardPayment: true, alsoMarked: 1 });

    expect((await fila(lar)).ids).toEqual([outro]);
    expect(await gastoNoLimite(lar)).toBe(1);
    const linha = await lerTransacao(pix);
    expect(linha.movement).toBe("pagamento_fatura");
    expect(linha.movement_original).toBe("pix_enviado");
    expect(linha.movement_locked).toBe(1);
    expect(linha.categorized_at).not.toBeNull();
    expect(linha.categorized_by).toBe(lar.memberId);

    const regras = await regrasDoLar(lar);
    expect(regras).toHaveLength(1);
    expect(regras[0]).toMatchObject({
      scope: "destinatario",
      match_value: NU_CHAVE,
      set_movement: "pagamento_fatura",
      created_from: "lembrar",
      disabled_at: null,
    });

    // O próximo Pix para o mesmo destino entra como pagamento, travado, e não fica pendente.
    const proximo = await pixEnviado(lar, "[TEST] NU PAGAMENTOS");
    const resultado = await processNewTransactions(pipeline(), lar.householdId, [proximo], AGORA);
    const linhaDoProximo = await lerTransacao(proximo);
    expect(linhaDoProximo.movement).toBe("pagamento_fatura");
    expect(linhaDoProximo.movement_locked).toBe(1);
    expect(resultado.pending).toEqual([]);
  });

  it("Pix sem nome nem documento: marca só a linha, sem regra (alsoMarked 0)", async () => {
    const lar = await criarLar();
    const id = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -9000,
      descricao: "PIX ENVIADO",
      contraparte: null,
      doc: null,
    });
    const igualSemNome = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -9000,
      descricao: "PIX ENVIADO",
      contraparte: null,
      doc: null,
    });
    const resposta = await ligarPagamento(lar, id, true);
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ isCardPayment: true, alsoMarked: 0 });
    expect((await lerTransacao(id)).movement).toBe("pagamento_fatura");
    expect((await lerTransacao(igualSemNome)).movement).toBe("pix_enviado");
    expect(await regrasDoLar(lar)).toEqual([]);
  });
});

describe("cenário 17: desligar", () => {
  it("volta a pix_enviado e à fila, mantém movement_locked, desativa a regra só de movimento e a classificação não o remarca", async () => {
    const lar = await criarLar();
    // A descrição que a classificação (R1) reconhece como pagamento de fatura; a linha-controle não está travada.
    const descricao = "[TEST] PIX PAGAMENTO FATURA CARTAO";
    const pix = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -287040,
      descricao,
      contraparte: "[TEST] NU PAGAMENTOS",
      doc: "•••.456.789-••",
    });
    const controle = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -1000,
      descricao,
      contraparte: "[TEST] OUTRO BANCO",
      doc: "•••.111.222-••",
    });
    await ligarPagamento(lar, pix, true);
    expect((await fila(lar)).ids).not.toContain(pix);

    const desligar = await ligarPagamento(lar, pix, false);
    expect(desligar.status).toBe(200);

    const linha = await lerTransacao(pix);
    expect(linha.movement).toBe("pix_enviado");
    expect(linha.movement_locked).toBe(1);
    expect(linha.categorized_at).toBeNull();
    expect(linha.categorized_by).toBeNull();
    expect((await fila(lar)).ids).toContain(pix);

    // A regra só tinha o movimento: fica desativada.
    const regras = await regrasDoLar(lar);
    expect(regras).toHaveLength(1);
    expect(regras[0]?.set_movement).toBeNull();
    expect(regras[0]?.disabled_at).not.toBeNull();

    // A classificação automática remarca a linha-controle (destravada), e não a que o casal desligou.
    await reconcileHousehold(pipeline(), lar.householdId, "2026-11-10", AGORA);
    expect((await lerTransacao(controle)).movement).toBe("pagamento_fatura");
    expect((await lerTransacao(pix)).movement).toBe("pix_enviado");
  });

  it("com categoria, desligar mantém quem categorizou e a categoria", async () => {
    const lar = await criarLar();
    const servicos = categoriaDoLar(lar, "servicos");
    await criarRegra(lar, {
      scope: "destinatario",
      matchValue: "[TEST] DIARISTA|•••.456.789-••",
      setCategoryId: servicos,
      createdFrom: "lembrar",
    });
    const pix = await pixEnviado(lar, "[TEST] DIARISTA", servicos);
    await env.DB.prepare("UPDATE transactions SET categorized_at = ?, categorized_by = ? WHERE id = ?")
      .bind(AGORA, lar.memberId, pix)
      .run();
    await ligarPagamento(lar, pix, true);
    await ligarPagamento(lar, pix, false);
    const linha = await lerTransacao(pix);
    expect(linha.categorized_at).not.toBeNull();
    expect(linha.categorized_by).not.toBeNull();
    expect(linha.category_id).toBe(servicos);
  });
});

describe("cenário 18: boleto que paga a fatura", () => {
  it("ligar tira o boleto do gasto e vira regra do estabelecimento; o próximo boleto igual entra sozinho", async () => {
    const lar = await criarLar();
    const descricao = "[TEST] COBRANCA EMISSOR XPTO";
    const boleto = await inserirTransacao(lar, { movement: "boleto", amountCents: -50000, descricao });
    expect(await gastoNoLimite(lar)).toBe(1);
    const corpo = await detalhe(lar, boleto);
    expect(corpo.canMarkCardPayment).toBe(true);

    const resposta = await ligarPagamento(lar, boleto, true);
    expect(resposta.status).toBe(200);
    expect(await gastoNoLimite(lar)).toBe(0);
    const linha = await lerTransacao(boleto);
    expect(linha.movement).toBe("pagamento_fatura");
    expect(linha.movement_original).toBe("boleto");
    expect(linha.movement_locked).toBe(1);
    expect((await detalhe(lar, boleto)).baseMovement).toBe("boleto");

    const regras = await regrasDoLar(lar);
    expect(regras).toHaveLength(1);
    expect(regras[0]).toMatchObject({ scope: "estabelecimento", set_movement: "pagamento_fatura" });

    const proximo = await inserirTransacao(lar, { movement: "boleto", amountCents: -50000, descricao });
    await processNewTransactions(pipeline(), lar.householdId, [proximo], AGORA);
    expect((await lerTransacao(proximo)).movement).toBe("pagamento_fatura");

    const desligar = await ligarPagamento(lar, boleto, false);
    expect(desligar.status).toBe(200);
    expect((await lerTransacao(boleto)).movement).toBe("boleto");
    expect(await gastoNoLimite(lar)).toBe(1);
  });

  it("na compra de cartão a chave não aparece e o PUT recusa com 422 movimento_invalido", async () => {
    const lar = await criarLar();
    const compra = await compraNoCartao(lar);
    expect((await detalhe(lar, compra)).canMarkCardPayment).toBe(false);
    const resposta = await ligarPagamento(lar, compra, true);
    expect(resposta.status).toBe(422);
    expect(JSON.stringify(await resposta.json())).toContain("movimento_invalido");
  });
});

describe("guardas do PUT card-payment", () => {
  it("recusa Pix oculto, de valor positivo e de movimento-base que não é saída (422), e não grava nada", async () => {
    const lar = await criarLar();
    const oculto = await pixEnviado(lar, "[TEST] NU PAGAMENTOS");
    await env.DB.prepare("UPDATE transactions SET hidden = 1, hidden_reason = 'gasto_terceiros' WHERE id = ?")
      .bind(oculto)
      .run();
    const positivo = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: 15000,
      descricao: "PIX ENVIADO [TEST] NU PAGAMENTOS",
      contraparte: "[TEST] NU PAGAMENTOS",
      doc: "•••.456.789-••",
    });
    // Escopo de remetente existe para pix_recebido: só a guarda do movimento-base recusa.
    const recebido = await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: -15000,
      descricao: "PIX RECEBIDO [TEST] NU PAGAMENTOS",
      contraparte: "[TEST] NU PAGAMENTOS",
      doc: "•••.456.789-••",
    });

    for (const id of [oculto, positivo, recebido]) {
      const resposta = await ligarPagamento(lar, id, true);
      expect(resposta.status, id).toBe(422);
      expect((await lerTransacao(id)).movement).not.toBe("pagamento_fatura");
    }
    expect(await regrasDoLar(lar)).toEqual([]);
    expect((await detalhe(lar, oculto)).canMarkCardPayment).toBe(false);
  });

  it("isola por lar: o PUT e o PATCH de outro lar dão 404 e não gravam", async () => {
    const lar = await criarLar();
    const outro = await criarOutroLar();
    const id = await pixEnviado(lar, "[TEST] NU PAGAMENTOS");
    expect((await ligarPagamento(outro, id, true)).status).toBe(404);
    const patch = await callApi(appDoLar(outro), "PATCH", `/api/transactions/${id}`, {
      cardWouldAccept: true,
    });
    expect(patch.status).toBe(404);
    expect((await lerTransacao(id)).movement).toBe("pix_enviado");
    expect(await regrasDoLar(lar)).toEqual([]);
  });
});

describe("cenário 2: Metas e Investimentos no Pix", () => {
  it("o tipo Metas é aceito no Pix e tira o gasto do limite; Investimentos também; no cartão é 422", async () => {
    const lar = await criarLar();
    const pix = await pixEnviado(lar, "[TEST] JOAO P SILVA");
    expect(await gastoNoLimite(lar)).toBe(1);

    const metas = await callApi(appDoLar(lar), "PATCH", `/api/transactions/${pix}`, { spendType: "metas" });
    expect(metas.status).toBe(200);
    expect((await lerTransacao(pix)).spend_type).toBe("metas");
    expect((await lerTransacao(pix)).spend_type_source).toBe("escolhido");
    expect(await gastoNoLimite(lar)).toBe(0);

    const investimentos = await callApi(appDoLar(lar), "PATCH", `/api/transactions/${pix}`, {
      spendType: "investimentos",
    });
    expect(investimentos.status).toBe(200);
    expect((await lerTransacao(pix)).spend_type).toBe("investimentos");

    const compra = await compraNoCartao(lar);
    const recusa = await callApi(appDoLar(lar), "PATCH", `/api/transactions/${compra}`, {
      spendType: "metas",
    });
    expect(recusa.status).toBe(422);
  });
});

describe("Lembrar (cenário 3): a categoria pelo PUT e a regra pelo POST /api/rules", () => {
  it("grava a origem pelo PUT, cria a regra 'lembrar', categoriza o igual que esperava e o próximo Pix", async () => {
    const lar = await criarLar();
    const servicos = categoriaDoLar(lar, "servicos");
    const origem = await pixEnviado(lar, "[TEST] DIARISTA");
    const igual = await pixEnviado(lar, "[TEST] DIARISTA");

    const put = await callApi(appDoLar(lar), "PUT", `/api/transactions/${origem}/category`, {
      categoryId: servicos,
      applyToAll: false,
    });
    expect(put.status).toBe(200);
    expect((await lerTransacao(origem)).category_id).toBe(servicos);
    expect(await regrasDoLar(lar)).toEqual([]);

    const post = await callApi(appDoLar(lar), "POST", "/api/rules", {
      transactionId: origem,
      set: { categoryId: servicos, spendType: "fixos" },
      createdFrom: "lembrar",
    });
    expect(post.status).toBeLessThan(300);
    const regras = await regrasDoLar(lar);
    expect(regras).toHaveLength(1);
    expect(regras[0]).toMatchObject({
      scope: "destinatario",
      match_value: "[TEST] DIARISTA|•••.456.789-••",
      set_category_id: servicos,
      created_from: "lembrar",
      disabled_at: null,
    });
    // A origem fica com o que o PUT gravou (a regra não a regrava) e o igual que esperava recebe a categoria.
    expect((await lerTransacao(origem)).category_id).toBe(servicos);
    expect((await lerTransacao(igual)).category_id).toBe(servicos);
    expect((await fila(lar)).ids).toEqual([]);

    const proximo = await pixEnviado(lar, "[TEST] DIARISTA");
    await processNewTransactions(pipeline(), lar.householdId, [proximo], AGORA);
    expect((await lerTransacao(proximo)).category_id).toBe(servicos);
  });
});
