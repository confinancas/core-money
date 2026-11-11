import { env } from "cloudflare:test";
import type { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { RespostaDeCartaoSchema, RespostaDeCartoesSchema } from "../../../src/shared/api/cards";
import { createApp } from "../../../src/worker/app";
import type { AppEnv } from "../../../src/worker/env";
import { aquecerOPortao, callApi, semearPronto } from "../helpers/app";
import { AGORA, criarLar, criarOutroLar, type Lar } from "../helpers/regras";

// Cartões (TASK-0402): GET /api/cards e GET /api/cards/:cardId contra o D1 de teste. Dados [TEST]; o lar da sessão é
// dado pelo resolvedor (ou pelo cookie, no caso de 401). Hoje é 10/11/2026, no ciclo 2026-10.

beforeEach(async () => {
  await semearPronto(env.DB);
  await aquecerOPortao(createApp({}));
});

const appDoLar = (lar: { householdId: string; memberId: string }): Hono<AppEnv> =>
  createApp({ resolveSession: async () => lar, agora: () => new Date(AGORA) });

// Calendário de teste: quatro ciclos seguidos, dia 11 (o padrão do lar).
async function inserirCiclos(lar: Lar): Promise<void> {
  const ciclos: [string, string, string][] = [
    ["2026-08", "2026-08-11", "2026-09-10"],
    ["2026-09", "2026-09-11", "2026-10-10"],
    ["2026-10", "2026-10-11", "2026-11-10"],
    ["2026-11", "2026-11-11", "2026-12-10"],
  ];
  await env.DB.batch(
    ciclos.map(([chave, inicio, fim]) =>
      env.DB.prepare("INSERT INTO cycles (household_id, key, starts_on, ends_on) VALUES (?, ?, ?, ?)").bind(
        lar.householdId,
        chave,
        inicio,
        fim,
      ),
    ),
  );
}

// Cartão de outro banco no mesmo lar (com o mesmo nome, quando `mesmoBanco`, para testar o rótulo com o final).
async function cartaoExtra(lar: Lar, banco: string, final: string): Promise<string> {
  const cartaoId = crypto.randomUUID();
  const bancoId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO bank_items (id, connection_id, institution_name, institution_color, created_at) VALUES (?, (SELECT connection_id FROM bank_items WHERE id = ?), ?, '#8A05BE', ?)",
    ).bind(bancoId, lar.bankItemId, banco, AGORA),
    env.DB.prepare(
      "INSERT INTO cards (id, bank_item_id, last4, name, limit_cents, available_cents) VALUES (?, ?, ?, '[TEST] Cartão', 600000, 366000)",
    ).bind(cartaoId, bancoId, final),
  ]);
  return cartaoId;
}

async function inserirFatura(
  cartaoId: string,
  f: {
    id: string;
    fecha: string;
    vence: string | null;
    status: string;
    pago?: string | null;
    ciclo?: string | null;
  },
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO bills (id, card_id, closes_on, due_on, amount_cents, status, paid_on, cycle_key) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)",
  )
    .bind(f.id, cartaoId, f.fecha, f.vence, f.status, f.pago ?? null, f.ciclo ?? null)
    .run();
}

type Compra = {
  id: string;
  cartaoId: string;
  faturaId: string | null;
  data: string;
  valorCentavos: number;
  movimento?: string;
  descricao?: string;
  parcela?: [number, number];
  oculto?: boolean;
  removido?: boolean;
  categoriaId?: string | null;
  nomeCorrigido?: string | null;
  ciclo?: string | null;
  ocorreuEm?: string;
};

async function inserirCompra(c: Compra): Promise<void> {
  const descricao = c.descricao ?? `[TEST] Compra ${c.id}`;
  await env.DB.prepare(
    `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, bill_id, movement,
       occurred_at, local_date, amount_cents, original_description, establishment_key, installment_number,
       installment_total, cycle_key, category_id, custom_name, hidden, removed_at, last_seen_at)
     VALUES (?, (SELECT pc.household_id FROM cards AS cd JOIN bank_items AS bi ON bi.id = cd.bank_item_id JOIN pluggy_connections AS pc ON pc.id = bi.connection_id WHERE cd.id = ?),
       ?, (SELECT bank_item_id FROM cards WHERE id = ?), NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      c.id,
      c.cartaoId,
      `[TEST] ext-${c.id}`,
      c.cartaoId,
      c.cartaoId,
      c.faturaId,
      c.movimento ?? "compra",
      c.ocorreuEm ?? `${c.data}T12:00:00.000Z`,
      c.data,
      c.valorCentavos,
      descricao,
      `TEST ${c.id}`,
      c.parcela?.[0] ?? null,
      c.parcela?.[1] ?? null,
      c.ciclo ?? null,
      c.categoriaId ?? null,
      c.nomeCorrigido ?? null,
      c.oculto ? 1 : 0,
      c.removido ? AGORA : null,
      AGORA,
    )
    .run();
}

async function categoria(lar: Lar, id: string, nome: string): Promise<string> {
  await env.DB.prepare(
    "INSERT INTO categories (id, household_id, name, color, parent_id, default_spend_type, ai_hint, sort, archived_at) VALUES (?, ?, ?, '#7C4DFF', NULL, NULL, NULL, 0, NULL)",
  )
    .bind(id, lar.householdId, nome)
    .run();
  return id;
}

async function chamar(app: Hono<AppEnv>, caminho: string, headers: Record<string, string> = {}) {
  const resposta = await callApi(app, "GET", caminho, undefined, headers);
  const corpo = (await resposta.json()) as Record<string, unknown>;
  return { status: resposta.status, corpo };
}

// Lar do cenário 1: Nubank com aberta de 2.340,00 (fecha 03/11, vence 10/11) e setembro paga; Itaú com fechada de
// 1.980,00 (vence 14/11) e a nova aberta de 410,00.
async function cenarioDoisCartoes() {
  const lar = await criarLar();
  await inserirCiclos(lar);
  const nubank = lar.cardId;
  await env.DB.prepare(
    "UPDATE bank_items SET institution_name = '[TEST] Nubank', institution_color = '#8A05BE' WHERE id = ?",
  )
    .bind(lar.bankItemId)
    .run();
  const itau = await cartaoExtra(lar, "[TEST] Itaú", "9921");
  await inserirFatura(nubank, {
    id: "b-nu-set",
    fecha: "2026-09-03",
    vence: "2026-09-10",
    status: "paga",
    pago: "2026-09-10",
    ciclo: "2026-09",
  });
  await inserirFatura(nubank, {
    id: "b-nu-nov",
    fecha: "2026-11-03",
    vence: "2026-11-10",
    status: "aberta",
    ciclo: "2026-10",
  });
  await inserirFatura(itau, {
    id: "b-it-out",
    fecha: "2026-10-06",
    vence: "2026-11-14",
    status: "fechada",
    ciclo: "2026-10",
  });
  await inserirFatura(itau, {
    id: "b-it-nov",
    fecha: "2026-11-06",
    vence: "2026-12-14",
    status: "aberta",
    ciclo: "2026-10",
  });
  await inserirCompra({
    id: "t-nu-1",
    cartaoId: nubank,
    faturaId: "b-nu-nov",
    data: "2026-11-05",
    valorCentavos: -200_000,
    descricao: "[TEST] Mercado",
    ciclo: "2026-10",
  });
  await inserirCompra({
    id: "t-nu-2",
    cartaoId: nubank,
    faturaId: "b-nu-nov",
    data: "2026-11-04",
    valorCentavos: -34_000,
    ciclo: "2026-10",
  });
  await inserirCompra({
    id: "t-it-1",
    cartaoId: itau,
    faturaId: "b-it-out",
    data: "2026-10-20",
    valorCentavos: -198_000,
    ciclo: "2026-10",
  });
  await inserirCompra({
    id: "t-it-2",
    cartaoId: itau,
    faturaId: "b-it-nov",
    data: "2026-11-07",
    valorCentavos: -41_000,
    ciclo: "2026-10",
  });
  return { lar, nubank, itau };
}

describe("GET /api/cards (cenário 1: a lista)", () => {
  it("traz os cartões do lar com a fatura aberta, a fechada a pagar e as faturas abertas somadas", async () => {
    const { lar, nubank, itau } = await cenarioDoisCartoes();
    const { status, corpo } = await chamar(appDoLar(lar), "/api/cards");

    expect(status).toBe(200);
    const resposta = RespostaDeCartoesSchema.parse(corpo);
    expect(resposta.openBillsCents).toBe(234_000 + 41_000);
    expect(resposta.futureInstallmentsCents).toBe(0);

    const porId = new Map(resposta.cards.map((cartao) => [cartao.id, cartao]));
    const cartaoNubank = porId.get(nubank);
    expect(cartaoNubank).toMatchObject({
      bankName: "[TEST] Nubank",
      label: "[TEST] Nubank",
      last4: "1234",
      limitCents: null,
      badge: { kind: "paga", cycleKey: "2026-09" },
      current: {
        state: "aberta",
        billId: "b-nu-nov",
        cycleKey: "2026-10",
        closesOn: "2026-11-03",
        dueOn: "2026-11-10",
        totalCents: 234_000,
      },
      openTotalCents: null,
    });

    const cartaoItau = porId.get(itau);
    expect(cartaoItau).toMatchObject({
      bankName: "[TEST] Itaú",
      badge: { kind: "vence", dueOn: "2026-11-14" },
      current: { state: "fechada", billId: "b-it-out", totalCents: 198_000, dueOn: "2026-11-14" },
      openTotalCents: 41_000,
      availableCents: 366_000,
      limitCents: 600_000,
    });
  });

  it("cenário 2: o item oculto não entra no total da fatura nem em Faturas abertas, mas aparece nas compras", async () => {
    const { lar, nubank } = await cenarioDoisCartoes();
    await inserirCompra({
      id: "t-oculto",
      cartaoId: nubank,
      faturaId: "b-nu-nov",
      data: "2026-11-02",
      valorCentavos: -31_250,
      oculto: true,
      descricao: "[TEST] Terceiros",
      ciclo: "2026-10",
    });

    const resposta = RespostaDeCartoesSchema.parse((await chamar(appDoLar(lar), "/api/cards")).corpo);
    expect(resposta.openBillsCents).toBe(234_000 + 41_000);
    const cartao = resposta.cards.find((c) => c.id === nubank);
    expect(cartao?.current?.totalCents).toBe(234_000);
    expect(resposta.recent.find((r) => r.name === "[TEST] Terceiros")).toMatchObject({
      hidden: true,
      amountCents: -31_250,
    });
  });

  it("cenário 8: estorno abate o total da fatura aberta", async () => {
    const { lar, nubank } = await cenarioDoisCartoes();
    await inserirCompra({
      id: "t-estorno",
      cartaoId: nubank,
      faturaId: "b-nu-nov",
      data: "2026-11-06",
      valorCentavos: 5_000,
      movimento: "estorno",
      descricao: "[TEST] Estorno",
      ciclo: "2026-10",
    });

    const resposta = RespostaDeCartoesSchema.parse((await chamar(appDoLar(lar), "/api/cards")).corpo);
    const cartao = resposta.cards.find((c) => c.id === nubank);
    expect(cartao?.current?.totalCents).toBe(229_000);
    expect(resposta.recent.find((r) => r.name === "[TEST] Estorno")).toMatchObject({
      movement: "estorno",
      amountCents: 5_000,
    });
  });

  it("cenário 6: cartão sem fatura fechada não tem selo e mostra só a aberta", async () => {
    const lar = await criarLar();
    await inserirCiclos(lar);
    await inserirFatura(lar.cardId, {
      id: "b-novo",
      fecha: "2026-11-03",
      vence: "2026-11-10",
      status: "aberta",
      ciclo: "2026-10",
    });
    const resposta = RespostaDeCartoesSchema.parse((await chamar(appDoLar(lar), "/api/cards")).corpo);
    expect(resposta.cards[0]).toMatchObject({
      badge: null,
      openTotalCents: null,
      current: { state: "aberta" },
    });
  });

  it("cenário 3: parcelas futuras projetadas da fatura aberta, sem dobrar as que o banco já mandou", async () => {
    const lar = await criarLar();
    await inserirCiclos(lar);
    const cartao = lar.cardId;
    await inserirFatura(cartao, {
      id: "b-aberta",
      fecha: "2026-11-03",
      vence: "2026-11-10",
      status: "aberta",
      ciclo: "2026-10",
    });
    await inserirCompra({
      id: "p-amazon",
      cartaoId: cartao,
      faturaId: "b-aberta",
      data: "2026-11-02",
      valorCentavos: -14_990,
      parcela: [2, 6],
      descricao: "[TEST] Amazon",
    });
    await inserirCompra({
      id: "p-decathlon",
      cartaoId: cartao,
      faturaId: "b-aberta",
      data: "2026-11-02",
      valorCentavos: -26_630,
      parcela: [1, 3],
      descricao: "[TEST] Decathlon",
    });
    // O banco já manda a parcela 3/6 numa fatura futura: não pode contar de novo.
    await inserirFatura(cartao, {
      id: "b-futura-banco",
      fecha: "2026-12-03",
      vence: "2026-12-10",
      status: "futura",
    });
    await inserirCompra({
      id: "p-amazon-banco",
      cartaoId: cartao,
      faturaId: "b-futura-banco",
      data: "2026-12-02",
      valorCentavos: -14_990,
      parcela: [3, 6],
      descricao: "[TEST] Amazon",
    });

    // Parcela oculta (gasto de terceiros) na mesma fatura: não projeta nem soma.
    await inserirCompra({
      id: "p-oculto",
      cartaoId: cartao,
      faturaId: "b-aberta",
      data: "2026-11-02",
      valorCentavos: -10_000,
      parcela: [1, 4],
      oculto: true,
      descricao: "[TEST] Terceiros parcela",
    });
    // Parcela removida (apagada no banco): também não projeta.
    await inserirCompra({
      id: "p-removido",
      cartaoId: cartao,
      faturaId: "b-aberta",
      data: "2026-11-02",
      valorCentavos: -10_000,
      parcela: [1, 4],
      removido: true,
      descricao: "[TEST] Removida parcela",
    });
    const resposta = RespostaDeCartoesSchema.parse((await chamar(appDoLar(lar), "/api/cards")).corpo);
    expect(resposta.futureInstallmentsCents).toBe(113_220);
    expect(resposta.openBillsCents).toBe(14_990 + 26_630);
  });

  it("cenário 10: os dois membros do lar veem os mesmos cartões", async () => {
    const lar = await criarLar();
    const outro = await criarOutroLar();
    await inserirCiclos(lar);
    await inserirFatura(lar.cardId, {
      id: "b-x",
      fecha: "2026-11-03",
      vence: "2026-11-10",
      status: "aberta",
      ciclo: "2026-10",
    });
    const porTitular = await chamar(appDoLar(lar), "/api/cards");
    const porOutroLar = await chamar(appDoLar(outro), "/api/cards");
    expect(porTitular.corpo).not.toEqual(porOutroLar.corpo);
    const porMembro = await chamar(
      appDoLar({ householdId: lar.householdId, memberId: lar.memberId }),
      "/api/cards",
    );
    expect(porMembro.corpo).toEqual(porTitular.corpo);
  });

  it("cenário 7: lar sem cartões responde lista vazia", async () => {
    const lar = await criarLar();
    await env.DB.prepare("DELETE FROM cards WHERE id = ?").bind(lar.cardId).run();
    const resposta = RespostaDeCartoesSchema.parse((await chamar(appDoLar(lar), "/api/cards")).corpo);
    expect(resposta).toEqual({ openBillsCents: 0, futureInstallmentsCents: 0, cards: [], recent: [] });
  });

  it("rótulo com o final quando o lar tem dois cartões do mesmo banco", async () => {
    const lar = await criarLar();
    await cartaoExtra(lar, "[TEST] Banco", "9921");
    const resposta = RespostaDeCartoesSchema.parse((await chamar(appDoLar(lar), "/api/cards")).corpo);
    const rotulos = resposta.cards.map((c) => c.label).sort();
    expect(rotulos).toEqual(["[TEST] Banco · final 1234", "[TEST] Banco · final 9921"]);
  });

  it("recent: no máximo 10 compras, só dos dois últimos ciclos, mais recentes primeiro", async () => {
    const lar = await criarLar();
    await inserirCiclos(lar);
    const cartao = lar.cardId;
    await inserirFatura(cartao, {
      id: "b-r",
      fecha: "2026-11-03",
      vence: "2026-11-10",
      status: "aberta",
      ciclo: "2026-10",
    });
    for (let i = 1; i <= 12; i++) {
      await inserirCompra({
        id: `r-atual-${i}`,
        cartaoId: cartao,
        faturaId: "b-r",
        data: "2026-10-20",
        valorCentavos: -1000 * i,
        ciclo: "2026-10",
        ocorreuEm: `2026-10-20T${String(i).padStart(2, "0")}:00:00.000Z`,
      });
    }
    await inserirCompra({
      id: "r-antigo",
      cartaoId: cartao,
      faturaId: null,
      data: "2026-08-15",
      valorCentavos: -999,
      ciclo: "2026-08",
      ocorreuEm: "2026-08-15T12:00:00.000Z",
    });
    const resposta = RespostaDeCartoesSchema.parse((await chamar(appDoLar(lar), "/api/cards")).corpo);
    expect(resposta.recent).toHaveLength(10);
    expect(resposta.recent.map((r) => r.id)[0]).toBe("r-atual-12");
    expect(resposta.recent.some((r) => r.id === "r-antigo")).toBe(false);
  });

  it("recent: inclui o ciclo anterior ao atual, e deixa de fora o que é mais antigo", async () => {
    const lar = await criarLar();
    await inserirCiclos(lar);
    const cartao = lar.cardId;
    await inserirFatura(cartao, {
      id: "b-ant",
      fecha: "2026-11-03",
      vence: "2026-11-10",
      status: "aberta",
      ciclo: "2026-10",
    });
    await inserirCompra({
      id: "anterior-1",
      cartaoId: cartao,
      faturaId: "b-ant",
      data: "2026-09-20",
      valorCentavos: -4_000,
      ciclo: "2026-09",
      ocorreuEm: "2026-09-20T12:00:00.000Z",
    });
    await inserirCompra({
      id: "antigo-1",
      cartaoId: cartao,
      faturaId: null,
      data: "2026-08-20",
      valorCentavos: -5_000,
      ciclo: "2026-08",
      ocorreuEm: "2026-08-20T12:00:00.000Z",
    });
    const resposta = RespostaDeCartoesSchema.parse((await chamar(appDoLar(lar), "/api/cards")).corpo);
    expect(resposta.recent.map((r) => r.id)).toEqual(["anterior-1"]);
  });

  it("compra sem categoria é marcada e a parcelada traz o número da parcela", async () => {
    const lar = await criarLar();
    await inserirCiclos(lar);
    const cat = await categoria(lar, "cat-mercado", "[TEST] Mercado");
    await inserirFatura(lar.cardId, {
      id: "b-c",
      fecha: "2026-11-03",
      vence: "2026-11-10",
      status: "aberta",
      ciclo: "2026-10",
    });
    await inserirCompra({
      id: "c-sem",
      cartaoId: lar.cardId,
      faturaId: "b-c",
      data: "2026-11-05",
      valorCentavos: -100,
      ocorreuEm: "2026-11-05T10:00:00.000Z",
      ciclo: "2026-10",
    });
    await inserirCompra({
      id: "c-com",
      cartaoId: lar.cardId,
      faturaId: "b-c",
      data: "2026-11-05",
      valorCentavos: -200,
      categoriaId: cat,
      parcela: [2, 4],
      ocorreuEm: "2026-11-05T11:00:00.000Z",
      ciclo: "2026-10",
    });
    const resposta = RespostaDeCartoesSchema.parse((await chamar(appDoLar(lar), "/api/cards")).corpo);
    expect(resposta.recent.find((r) => r.id === "c-sem")).toMatchObject({
      uncategorized: true,
      categoryName: null,
    });
    expect(resposta.recent.find((r) => r.id === "c-com")).toMatchObject({
      uncategorized: false,
      categoryName: "[TEST] Mercado",
      installmentNumber: 2,
      installmentTotal: 4,
    });
  });

  it("sem sessão, 401 antes da rota", async () => {
    const app = createApp({});
    const { status, corpo } = await chamar(app, "/api/cards");
    expect(status).toBe(401);
    expect(corpo).toMatchObject({ error: "nao_autenticado" });
  });
});

describe("GET /api/cards/:cardId (detalhe)", () => {
  it("traz a série de faturas, o selo, a média dos seis últimos meses e a aberta com ocultos à parte", async () => {
    const { lar, nubank } = await cenarioDoisCartoes();
    await inserirCompra({
      id: "t-oculto-d",
      cartaoId: nubank,
      faturaId: "b-nu-nov",
      data: "2026-11-02",
      valorCentavos: -31_250,
      oculto: true,
      ciclo: "2026-10",
    });
    const { status, corpo } = await chamar(appDoLar(lar), `/api/cards/${nubank}`);
    expect(status).toBe(200);
    const detalhe = RespostaDeCartaoSchema.parse(corpo);

    expect(detalhe.card).toMatchObject({ bankName: "[TEST] Nubank", last4: "1234", bestDayOn: "2026-11-04" });
    expect(detalhe.open).toEqual({
      billId: "b-nu-nov",
      cycleKey: "2026-10",
      closesOn: "2026-11-03",
      dueOn: "2026-11-10",
      totalCents: 234_000,
    });
    expect(detalhe.badge).toEqual({ kind: "paga", cycleKey: "2026-09" });
    expect(detalhe.bills.map((b) => [b.billId, b.status, b.totalCents])).toEqual([
      ["b-nu-set", "paga", 0],
      ["b-nu-nov", "aberta", 234_000],
    ]);
    expect(detalhe.avgMonths).toBe(1);
    expect(detalhe.openCount).toBe(2);
    expect(detalhe.openHiddenCount).toBe(1);
    expect(detalhe.openItems.map((i) => i.id)).toEqual(
      expect.arrayContaining(["t-nu-1", "t-nu-2", "t-oculto-d"]),
    );
    expect(detalhe.openItems.some((i) => "cardLabel" in i)).toBe(false);
  });

  it("média dos meses paga e fechada: arredonda e conta quantas entraram", async () => {
    const lar = await criarLar();
    await inserirCiclos(lar);
    const cartao = lar.cardId;
    await inserirFatura(cartao, {
      id: "m1",
      fecha: "2026-08-03",
      vence: "2026-08-10",
      status: "paga",
      pago: "2026-08-10",
      ciclo: "2026-08",
    });
    await inserirFatura(cartao, {
      id: "m2",
      fecha: "2026-09-03",
      vence: "2026-09-10",
      status: "paga",
      pago: "2026-09-10",
      ciclo: "2026-09",
    });
    await inserirFatura(cartao, {
      id: "m3",
      fecha: "2026-10-03",
      vence: "2026-10-10",
      status: "fechada",
      ciclo: "2026-09",
    });
    await inserirCompra({
      id: "m-1",
      cartaoId: cartao,
      faturaId: "m1",
      data: "2026-08-02",
      valorCentavos: -100_001,
    });
    await inserirCompra({
      id: "m-2",
      cartaoId: cartao,
      faturaId: "m2",
      data: "2026-09-02",
      valorCentavos: -100_002,
    });
    const detalhe = RespostaDeCartaoSchema.parse((await chamar(appDoLar(lar), `/api/cards/${cartao}`)).corpo);
    expect(detalhe.avgMonths).toBe(3);
    expect(detalhe.avg6Cents).toBe(Math.round(100_001 / 3 + 100_002 / 3));
    expect(detalhe.open).toBeNull();
    expect(detalhe.card.bestDayOn).toBeNull();
  });

  it("melhor dia: sem o best_day do banco, o dia seguinte ao fechamento da aberta", async () => {
    const { lar, nubank } = await cenarioDoisCartoes();
    const detalhe = RespostaDeCartaoSchema.parse((await chamar(appDoLar(lar), `/api/cards/${nubank}`)).corpo);
    expect(detalhe.card.bestDayOn).toBe("2026-11-04");
  });

  it("melhor dia: best_day igual ao dia do fechamento vai para o mês seguinte", async () => {
    const { lar, nubank } = await cenarioDoisCartoes();
    await env.DB.prepare("UPDATE cards SET best_day = 3 WHERE id = ?").bind(nubank).run();
    const detalhe = RespostaDeCartaoSchema.parse((await chamar(appDoLar(lar), `/api/cards/${nubank}`)).corpo);
    expect(detalhe.card.bestDayOn).toBe("2026-12-03");
  });

  it("melhor dia: com best_day, usa o dia no mês do fechamento, ou no seguinte quando não passa do dia do fechamento", async () => {
    const { lar, nubank } = await cenarioDoisCartoes();
    await env.DB.prepare("UPDATE cards SET best_day = 20 WHERE id = ?").bind(nubank).run();
    const depois = RespostaDeCartaoSchema.parse((await chamar(appDoLar(lar), `/api/cards/${nubank}`)).corpo);
    expect(depois.card.bestDayOn).toBe("2026-11-20");
    await env.DB.prepare("UPDATE cards SET best_day = 1 WHERE id = ?").bind(nubank).run();
    const antes = RespostaDeCartaoSchema.parse((await chamar(appDoLar(lar), `/api/cards/${nubank}`)).corpo);
    expect(antes.card.bestDayOn).toBe("2026-12-01");
  });

  it("média: só as seis últimas faturas paga ou fechada entram, e a conta é a dessas seis", async () => {
    const lar = await criarLar();
    await inserirCiclos(lar);
    const cartao = lar.cardId;
    for (let mes = 1; mes <= 7; mes++) {
      const chave = `2026-${String(mes).padStart(2, "0")}`;
      await inserirFatura(cartao, {
        id: `s${mes}`,
        fecha: `${chave}-03`,
        vence: `${chave}-10`,
        status: "paga",
        pago: `${chave}-10`,
      });
      await inserirCompra({
        id: `s-c${mes}`,
        cartaoId: cartao,
        faturaId: `s${mes}`,
        data: `${chave}-02`,
        valorCentavos: -mes * 100_000,
      });
    }
    const detalhe = RespostaDeCartaoSchema.parse((await chamar(appDoLar(lar), `/api/cards/${cartao}`)).corpo);
    // Meses 2 a 7: (2+3+4+5+6+7) × 100.000 / 6 = 450.000.
    expect(detalhe.avgMonths).toBe(6);
    expect(detalhe.avg6Cents).toBe(450_000);
  });

  it("cenário 3 no detalhe: a futura 1 traz as parcelas da Amazon e da Decathlon", async () => {
    const lar = await criarLar();
    await inserirCiclos(lar);
    const cartao = lar.cardId;
    await inserirFatura(cartao, {
      id: "d-aberta",
      fecha: "2026-11-03",
      vence: "2026-11-10",
      status: "aberta",
      ciclo: "2026-10",
    });
    await inserirCompra({
      id: "d-amazon",
      cartaoId: cartao,
      faturaId: "d-aberta",
      data: "2026-11-02",
      valorCentavos: -14_990,
      parcela: [2, 6],
      descricao: "[TEST] Amazon",
    });
    await inserirCompra({
      id: "d-decathlon",
      cartaoId: cartao,
      faturaId: "d-aberta",
      data: "2026-11-02",
      valorCentavos: -26_630,
      parcela: [1, 3],
      descricao: "[TEST] Decathlon",
    });
    const detalhe = RespostaDeCartaoSchema.parse((await chamar(appDoLar(lar), `/api/cards/${cartao}`)).corpo);
    const futuras = detalhe.bills.filter((b) => b.status === "futura");
    expect(futuras.map((f) => f.totalCents)).toEqual([41_620, 41_620, 14_990, 14_990]);
    expect(futuras[0]?.futureItems).toEqual([
      { name: "[TEST] Amazon", installment: 3, of: 6 },
      { name: "[TEST] Decathlon", installment: 2, of: 3 },
    ]);
    expect(detalhe.futureInstallmentsCents).toBe(113_220);
    expect(futuras.every((f) => f.billId === null)).toBe(true);
  });

  it("isolamento: cartão de outro lar é 404 como um cartão que não existe", async () => {
    const { nubank } = await cenarioDoisCartoes();
    const outro = await criarOutroLar();
    const { status, corpo } = await chamar(appDoLar(outro), `/api/cards/${nubank}`);
    expect(status).toBe(404);
    expect(corpo).toMatchObject({ error: "not_found", message: "Cartão não encontrado." });
  });

  it("cartão inexistente é 404", async () => {
    const lar = await criarLar();
    const { status } = await chamar(appDoLar(lar), "/api/cards/nao-existe");
    expect(status).toBe(404);
  });

  it("sem sessão, 401", async () => {
    const lar = await criarLar();
    const { status, corpo } = await chamar(createApp({}), `/api/cards/${lar.cardId}`);
    expect(status).toBe(401);
    expect(corpo).toMatchObject({ error: "nao_autenticado" });
  });
});

// Correções da rodada 1 (TASK-0402): a base de "Últimas compras" (F4), a projeção sem aberta (F7) e as mutações que
// sobreviveram (F9). Cada teste prova uma regra que uma mutação quebraria; a tabela está nas Evidências.
describe("rodada 1: regras que as mutações provaram", () => {
  const appEm = (lar: { householdId: string; memberId: string }, agora: string): Hono<AppEnv> =>
    createApp({ resolveSession: async () => lar, agora: () => new Date(agora) });

  it("F4 (sonda 05/11): a fatura aberta que fecha em 03/12 entra inteira em 'Últimas compras', da mais nova para a mais velha", async () => {
    const lar = await criarLar();
    await inserirCiclos(lar);
    const cartao = lar.cardId;
    await inserirFatura(cartao, {
      id: "f4-fechada",
      fecha: "2026-11-03",
      vence: "2026-11-10",
      status: "fechada",
      ciclo: "2026-10",
    });
    await inserirFatura(cartao, {
      id: "f4-aberta",
      fecha: "2026-12-03",
      vence: "2026-12-10",
      status: "aberta",
      ciclo: "2026-11",
    });
    await inserirCompra({
      id: "f4-20-10",
      cartaoId: cartao,
      faturaId: "f4-fechada",
      data: "2026-10-20",
      valorCentavos: -1_000,
      ciclo: "2026-10",
    });
    await inserirCompra({
      id: "f4-04-11",
      cartaoId: cartao,
      faturaId: "f4-aberta",
      data: "2026-11-04",
      valorCentavos: -2_000,
      ciclo: "2026-11",
    });
    await inserirCompra({
      id: "f4-05-11",
      cartaoId: cartao,
      faturaId: "f4-aberta",
      data: "2026-11-05",
      valorCentavos: -3_000,
      ciclo: "2026-11",
    });
    await inserirCompra({
      id: "f4-antiga",
      cartaoId: cartao,
      faturaId: null,
      data: "2026-08-20",
      valorCentavos: -9_000,
      ciclo: "2026-08",
    });

    const resposta = RespostaDeCartoesSchema.parse(
      (await chamar(appEm(lar, "2026-11-05T12:00:00.000Z"), "/api/cards")).corpo,
    );
    expect(resposta.recent.map((r) => r.id)).toEqual(["f4-05-11", "f4-04-11", "f4-20-10"]);
  });

  it("F7 (sonda 60,00): sem fatura aberta, a projeção sai da última paga", async () => {
    const lar = await criarLar();
    await inserirCiclos(lar);
    const cartao = lar.cardId;
    await inserirFatura(cartao, {
      id: "f7-paga",
      fecha: "2026-10-03",
      vence: "2026-10-10",
      status: "paga",
      pago: "2026-10-10",
      ciclo: "2026-09",
    });
    await inserirCompra({
      id: "f7-parcela",
      cartaoId: cartao,
      faturaId: "f7-paga",
      data: "2026-10-02",
      valorCentavos: -3_000,
      parcela: [1, 3],
      ciclo: "2026-09",
      descricao: "[TEST] Parcelada sem aberta",
    });

    const resposta = RespostaDeCartoesSchema.parse((await chamar(appDoLar(lar), "/api/cards")).corpo);
    expect(resposta.futureInstallmentsCents).toBe(6_000);
    expect(resposta.openBillsCents).toBe(0);
  });

  it("K2: um pagamento de fatura na aberta não entra no total", async () => {
    const { lar, nubank } = await cenarioDoisCartoes();
    await inserirCompra({
      id: "k2-pagamento",
      cartaoId: nubank,
      faturaId: "b-nu-nov",
      data: "2026-11-06",
      valorCentavos: -50_000,
      movimento: "pagamento_fatura",
      ciclo: "2026-10",
    });
    const resposta = RespostaDeCartoesSchema.parse((await chamar(appDoLar(lar), "/api/cards")).corpo);
    expect(resposta.cards.find((c) => c.id === nubank)?.current?.totalCents).toBe(234_000);
  });

  it("K3: uma fatura fechada não projeta parcelas quando há aberta", async () => {
    const lar = await criarLar();
    await inserirCiclos(lar);
    const cartao = lar.cardId;
    await inserirFatura(cartao, {
      id: "k3-fechada",
      fecha: "2026-10-03",
      vence: "2026-10-10",
      status: "fechada",
      ciclo: "2026-09",
    });
    await inserirFatura(cartao, {
      id: "k3-aberta",
      fecha: "2026-11-03",
      vence: "2026-11-10",
      status: "aberta",
      ciclo: "2026-10",
    });
    await inserirCompra({
      id: "k3-parcela",
      cartaoId: cartao,
      faturaId: "k3-fechada",
      data: "2026-10-02",
      valorCentavos: -3_000,
      parcela: [1, 3],
      ciclo: "2026-09",
    });
    const resposta = RespostaDeCartoesSchema.parse((await chamar(appDoLar(lar), "/api/cards")).corpo);
    expect(resposta.futureInstallmentsCents).toBe(0);
  });

  it("K5: uma compra removida não aparece em 'Últimas compras'", async () => {
    const { lar, nubank } = await cenarioDoisCartoes();
    await inserirCompra({
      id: "k5-removida",
      cartaoId: nubank,
      faturaId: "b-nu-nov",
      data: "2026-11-06",
      valorCentavos: -4_100,
      removido: true,
      ciclo: "2026-10",
    });
    const resposta = RespostaDeCartoesSchema.parse((await chamar(appDoLar(lar), "/api/cards")).corpo);
    expect(resposta.recent.some((r) => r.id === "k5-removida")).toBe(false);
  });

  it("K6: uma compra removida não aparece nos gastos da fatura aberta", async () => {
    const { lar, nubank } = await cenarioDoisCartoes();
    await inserirCompra({
      id: "k6-removida",
      cartaoId: nubank,
      faturaId: "b-nu-nov",
      data: "2026-11-06",
      valorCentavos: -4_100,
      removido: true,
      ciclo: "2026-10",
    });
    const detalhe = RespostaDeCartaoSchema.parse((await chamar(appDoLar(lar), `/api/cards/${nubank}`)).corpo);
    expect(detalhe.openItems.some((i) => i.id === "k6-removida")).toBe(false);
    expect(detalhe.openCount).toBe(2);
  });

  it("K7a: as compras de um banco desconectado não entram em 'Últimas compras'", async () => {
    const lar = await criarLar();
    await inserirCiclos(lar);
    const desconectado = await cartaoExtra(lar, "[TEST] Banco desconectado", "5555");
    await env.DB.prepare(
      "UPDATE bank_items SET disconnected_at = ? WHERE id = (SELECT bank_item_id FROM cards WHERE id = ?)",
    )
      .bind(AGORA, desconectado)
      .run();
    await inserirFatura(desconectado, {
      id: "k7-fatura",
      fecha: "2026-11-03",
      vence: "2026-11-10",
      status: "aberta",
      ciclo: "2026-10",
    });
    await inserirCompra({
      id: "k7-compra",
      cartaoId: desconectado,
      faturaId: "k7-fatura",
      data: "2026-11-05",
      valorCentavos: -7_000,
      ciclo: "2026-10",
    });
    const resposta = RespostaDeCartoesSchema.parse((await chamar(appDoLar(lar), "/api/cards")).corpo);
    expect(resposta.recent.some((r) => r.id === "k7-compra")).toBe(false);
  });

  it("K7b: um cartão de banco desconectado não aparece na lista e dá 404 no detalhe", async () => {
    const lar = await criarLar();
    await inserirCiclos(lar);
    const desconectado = await cartaoExtra(lar, "[TEST] Banco desconectado", "5555");
    await env.DB.prepare(
      "UPDATE bank_items SET disconnected_at = ? WHERE id = (SELECT bank_item_id FROM cards WHERE id = ?)",
    )
      .bind(AGORA, desconectado)
      .run();
    const resposta = RespostaDeCartoesSchema.parse((await chamar(appDoLar(lar), "/api/cards")).corpo);
    expect(resposta.cards.map((c) => c.id)).not.toContain(desconectado);
    const detalhe = await chamar(appDoLar(lar), `/api/cards/${desconectado}`);
    expect(detalhe.status).toBe(404);
  });

  it("K10: uma compra que o banco mandou numa fatura futura não entra nos gastos da fatura aberta", async () => {
    const { lar, nubank } = await cenarioDoisCartoes();
    await inserirFatura(nubank, {
      id: "k10-futura",
      fecha: "2026-12-03",
      vence: "2026-12-10",
      status: "futura",
    });
    await inserirCompra({
      id: "k10-compra-futura",
      cartaoId: nubank,
      faturaId: "k10-futura",
      data: "2026-11-06",
      valorCentavos: -8_800,
      ciclo: "2026-11",
    });
    const detalhe = RespostaDeCartaoSchema.parse((await chamar(appDoLar(lar), `/api/cards/${nubank}`)).corpo);
    expect(detalhe.openItems.some((i) => i.id === "k10-compra-futura")).toBe(false);
  });

  it("K17: um estorno parcelado não projeta parcelas", async () => {
    const lar = await criarLar();
    await inserirCiclos(lar);
    const cartao = lar.cardId;
    await inserirFatura(cartao, {
      id: "k17-aberta",
      fecha: "2026-11-03",
      vence: "2026-11-10",
      status: "aberta",
      ciclo: "2026-10",
    });
    await inserirCompra({
      id: "k17-estorno",
      cartaoId: cartao,
      faturaId: "k17-aberta",
      data: "2026-11-02",
      valorCentavos: 3_000,
      movimento: "estorno",
      parcela: [1, 3],
      ciclo: "2026-10",
    });
    const resposta = RespostaDeCartoesSchema.parse((await chamar(appDoLar(lar), "/api/cards")).corpo);
    expect(resposta.futureInstallmentsCents).toBe(0);
  });

  it("K18: um pagamento de fatura não entra em 'Últimas compras'", async () => {
    const { lar, nubank } = await cenarioDoisCartoes();
    await inserirCompra({
      id: "k18-pagamento",
      cartaoId: nubank,
      faturaId: "b-nu-nov",
      data: "2026-11-06",
      valorCentavos: -50_000,
      movimento: "pagamento_fatura",
      ciclo: "2026-10",
    });
    const resposta = RespostaDeCartoesSchema.parse((await chamar(appDoLar(lar), "/api/cards")).corpo);
    expect(resposta.recent.some((r) => r.id === "k18-pagamento")).toBe(false);
  });
});

// Rodada 2 (TASK-0402, F10): "Últimas compras" não mostra lançamento com data futura. As parcelas que o banco manda
// adiantadas numa fatura futura ficam fora da lista, mas continuam fora dos totais e da projeção (a projeção é a fonte
// das futuras). Duas sondas da reconferência da Fable.
describe("rodada 2: teto de data em 'Últimas compras' (F10)", () => {
  const appEm = (lar: { householdId: string; memberId: string }, agora: string): Hono<AppEnv> =>
    createApp({ resolveSession: async () => lar, agora: () => new Date(agora) });

  it("F10 (sonda 02/11): a parcela 3 e a 4 adiantadas no banco não entram em 'Últimas compras'", async () => {
    const lar = await criarLar();
    await inserirCiclos(lar);
    const cartao = lar.cardId;
    await inserirFatura(cartao, {
      id: "f10a-aberta",
      fecha: "2026-11-03",
      vence: "2026-11-10",
      status: "aberta",
      ciclo: "2026-10",
    });
    await inserirFatura(cartao, {
      id: "f10a-dez",
      fecha: "2026-12-03",
      vence: "2026-12-10",
      status: "futura",
    });
    await inserirFatura(cartao, {
      id: "f10a-jan",
      fecha: "2027-01-03",
      vence: "2027-01-10",
      status: "futura",
    });
    await inserirCompra({
      id: "f10a-loja2",
      cartaoId: cartao,
      faturaId: "f10a-aberta",
      data: "2026-11-02",
      valorCentavos: -10_000,
      parcela: [2, 6],
      ciclo: "2026-10",
      descricao: "[TEST] Loja 2 de 6",
    });
    await inserirCompra({
      id: "f10a-loja3",
      cartaoId: cartao,
      faturaId: "f10a-dez",
      data: "2026-12-02",
      valorCentavos: -10_000,
      parcela: [3, 6],
      descricao: "[TEST] Loja 3 de 6",
    });
    await inserirCompra({
      id: "f10a-loja4",
      cartaoId: cartao,
      faturaId: "f10a-jan",
      data: "2027-01-02",
      valorCentavos: -10_000,
      parcela: [4, 6],
      descricao: "[TEST] Loja 4 de 6",
    });

    const resposta = RespostaDeCartoesSchema.parse(
      (await chamar(appEm(lar, "2026-11-02T12:00:00.000Z"), "/api/cards")).corpo,
    );
    expect(resposta.recent.map((r) => r.id)).toEqual(["f10a-loja2"]);
    // Os totais e a projeção não mudam: a aberta soma a 2 de 6; as parcelas 3 a 6 vêm da projeção, sem dobrar.
    expect(resposta.openBillsCents).toBe(10_000);
    expect(resposta.futureInstallmentsCents).toBe(40_000);
  });

  it("F10 (sonda 05/11): duas compras em 10× adiantadas não tiram as cinco compras de 01/11 a 05/11 da lista", async () => {
    const lar = await criarLar();
    await inserirCiclos(lar);
    const cartao = lar.cardId;
    await inserirFatura(cartao, {
      id: "f10b-aberta",
      fecha: "2026-12-03",
      vence: "2026-12-10",
      status: "aberta",
      ciclo: "2026-11",
    });
    for (const dia of [1, 2, 3, 4, 5]) {
      const data = "2026-11-0" + dia;
      await inserirCompra({
        id: "f10b-0" + dia,
        cartaoId: cartao,
        faturaId: "f10b-aberta",
        data,
        valorCentavos: -1_000 * dia,
        ciclo: "2026-11",
        descricao: "[TEST] Compra " + data,
      });
    }
    for (const compra of ["A", "B"]) {
      for (let parcela = 2; parcela <= 10; parcela++) {
        const mes = parcela + 2;
        const mm = String(mes).padStart(2, "0");
        const fatura = "f10b-fut-" + mm;
        if (compra === "A")
          await inserirFatura(cartao, {
            id: fatura,
            fecha: "2027-" + mm + "-03",
            vence: "2027-" + mm + "-10",
            status: "futura",
          });
        await inserirCompra({
          id: "f10b-" + compra + "-" + parcela,
          cartaoId: cartao,
          faturaId: fatura,
          data: "2027-" + mm + "-02",
          valorCentavos: -5_000,
          parcela: [parcela, 10],
          descricao: "[TEST] Parcelada " + compra + " " + parcela + " de 10",
        });
      }
    }

    const resposta = RespostaDeCartoesSchema.parse(
      (await chamar(appEm(lar, "2026-11-05T12:00:00.000Z"), "/api/cards")).corpo,
    );
    expect(resposta.recent.map((r) => r.id)).toEqual(["f10b-05", "f10b-04", "f10b-03", "f10b-02", "f10b-01"]);
    expect(resposta.recent.every((r) => r.localDate <= "2026-11-05")).toBe(true);
    // As parcelas adiantadas do banco não entram em nenhum total desta tela.
    expect(resposta.futureInstallmentsCents).toBe(0);
  });
});
