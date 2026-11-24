import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/worker/app";
import { classifyMovements } from "../../src/worker/bank/classify";
import { ingestTransactions } from "../../src/worker/bank/repository";
import { processNewTransactions } from "../../src/worker/categorization/pipeline";
import { createDb } from "../../src/worker/db/client";
import { type Meter, newMeter } from "../../src/worker/db/metered-d1";
import { computeCycleIncome } from "../../src/worker/income/cycle-income";
import { aquecerOPortao, semearPronto } from "./helpers/app";
import {
  appDoLar,
  CHAVE_FULANA,
  chamar,
  criarPix,
  criarRegraDeRemetente,
  criarRenda,
  dbDeTeste,
  linhaDa,
  prepararCiclos,
  recebimentosDa,
  sugerir,
} from "./helpers/pix-recebido";
import { AGORA, contar, criarLar, inserirTransacao } from "./helpers/regras";

// Cobertura que faltava na TASK-0903 (rodada de correção): cenários 2, 8 e 16, precedência do extrato, a regra pela
// gravação da TASK-0202, a marca da TASK-0902 com a conciliação da TASK-0207, a contagem de chamadas ao D1 por rota e os
// casos das mutações que sobreviveram. Dados [TEST].

beforeEach(async () => {
  await semearPronto(env.DB);
  await aquecerOPortao(createApp({}));
});

const url = (id: string) => `/api/transactions/${id}/income-classification`;

describe("cenário 2: parte do salário em dólar", () => {
  it("trazido sobe de 6.000,00 para 7.500,00, ficou em dólar cai para 3.500,00 e a prévia não muda a renda total", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const renda = crypto.randomUUID();
    await env.DB.batch([
      // US$ 2.000,00 a 5,50: previsto de 11.000,00; o que sobra do previsto fica em dólar (investimento).
      env.DB.prepare(
        `INSERT INTO fixed_incomes (id, household_id, name, currency, amount_cents, usual_day, arrival, statement_text,
           kept_usd_is_investment, archived_at) VALUES (?, ?, '[TEST] Salário em dólar', 'USD', 200000, 5, 'partes', NULL, 1, NULL)`,
      ).bind(renda, lar.householdId),
      env.DB.prepare(
        `INSERT INTO fixed_income_receipts (id, fixed_income_id, cycle_key, transaction_id, amount_cents, received_on,
           fx_rate, fx_date, confirmed_by) VALUES (?, ?, '2026-10', NULL, 600000, '2026-10-15', 55000, '2026-10-15', ?)`,
      ).bind(crypto.randomUUID(), renda, lar.memberId),
    ]);
    const pix = await criarPix(lar, 150_000);
    const app = appDoLar(lar);

    const antes = await computeCycleIncome(dbDeTeste(), lar.householdId, "2026-10");
    expect(antes?.fixedIncomes[0]).toMatchObject({ broughtCents: 600_000, keptCents: 500_000 });

    const previa = await chamar(app, "POST", `${url(pix)}/preview`, {
      option: "salario",
      fixedIncomeId: renda,
    });
    expect(previa.status).toBe(200);
    expect(previa.corpo.afterCents).toBe(previa.corpo.beforeCents);
    expect(previa.corpo.beforeCents).toBe(1_100_000);

    const gravado = await chamar(app, "PUT", url(pix), {
      option: "salario",
      fixedIncomeId: renda,
      remember: false,
    });
    expect(gravado.status).toBe(200);
    expect(gravado.corpo.cycleIncomeCents).toBe(1_100_000);

    const depois = await computeCycleIncome(dbDeTeste(), lar.householdId, "2026-10");
    expect(depois?.fixedIncomes[0]).toMatchObject({ broughtCents: 750_000, keptCents: 350_000 });
    expect(depois?.totalCents).toBe(1_100_000);
  });
});

describe("cenário 8: renda arquivada na regra", () => {
  it("o Pix novo com a regra ligada a uma renda excluída fica para classificar, sem recebimento", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const arquivada = await criarRenda(lar, "[TEST] Salário antigo", 1_000_000, { arquivada: true });
    await criarRegraDeRemetente(lar, CHAVE_FULANA, { kind: "parte_salario", rendaId: arquivada });
    const pix = await criarPix(lar, 80_000);

    const resultado = await processNewTransactions(dbDeTeste(), lar.householdId, [pix], AGORA);

    expect(resultado.pending).toContain(pix);
    expect((await linhaDa(pix))?.income_kind).toBeNull();
    expect(await recebimentosDa(pix)).toHaveLength(0);
  });
});

describe("cenário 16: sugestão da IA na leitura", () => {
  it("a leitura traz a sugestão com a certeza, e nada é gravado até salvar", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const renda = await criarRenda(lar, "[TEST] Salário em dólar");
    const pix = await criarPix(lar, 150_000);
    await sugerir(pix, { kind: "parte_salario", rendaId: renda, certeza: "media" });

    const leitura = await chamar(appDoLar(lar), "GET", url(pix));

    expect(leitura.status).toBe(200);
    expect(leitura.corpo.classification).toBeNull();
    expect(leitura.corpo.aiSuggestion).toMatchObject({
      option: "salario",
      fixedIncomeId: renda,
      confidence: "media",
    });
    expect((await linhaDa(pix))?.income_kind).toBeNull();
    expect(await recebimentosDa(pix)).toHaveLength(0);
  });
});

describe("precedência do extrato sobre a regra de remetente", () => {
  it("regra de parte do salário para a renda Y e extrato casando a renda X: fica a X, sem regra, e um recebimento só", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const x = await criarRenda(lar, "[TEST] Renda X", 1_000_000, {
      arrival: "auto",
      texto: "PAGADORA EXTERIOR",
    });
    const y = await criarRenda(lar, "[TEST] Renda Y");
    await criarRegraDeRemetente(lar, CHAVE_FULANA, { kind: "parte_salario", rendaId: y });
    const pix = await criarPix(lar, 300_000, "[TEST] Fulana", { descricao: "[TEST] PAGADORA EXTERIOR Pix" });

    await processNewTransactions(dbDeTeste(), lar.householdId, [pix], AGORA);

    const linha = await linhaDa(pix);
    expect(linha?.income_kind).toBe("parte_salario");
    expect(linha?.fixed_income_id).toBe(x);
    expect(linha?.rule_id).toBeNull();
    expect(await recebimentosDa(pix)).toEqual([{ fixed_income_id: x, confirmed_by: "extrato" }]);
  });
});

describe("entrada oculta no pipeline", () => {
  it("a regra de remetente não classifica uma entrada oculta", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    await criarRegraDeRemetente(lar, CHAVE_FULANA, { kind: "variavel", subtipo: "venda" });
    const pix = await criarPix(lar, 80_000);
    await env.DB.prepare("UPDATE transactions SET hidden = 1, hidden_reason = 'gasto_terceiros' WHERE id = ?")
      .bind(pix)
      .run();

    await processNewTransactions(dbDeTeste(), lar.householdId, [pix], AGORA);

    expect((await linhaDa(pix))?.income_kind).toBeNull();
  });
});

describe("a regra de remetente pela gravação da TASK-0202", () => {
  it("ingestTransactions classifica o Pix novo pela regra, com recebimento 'regra' e rule_id", async () => {
    const lar = await criarLar();
    const renda = await criarRenda(lar, "[TEST] Salário em dólar");
    const regra = await criarRegraDeRemetente(lar, CHAVE_FULANA, { kind: "parte_salario", rendaId: renda });
    const db = dbDeTeste();

    const resultado = await ingestTransactions(db, {
      householdId: lar.householdId,
      bankItemId: lar.bankItemId,
      now: AGORA,
      rows: [
        {
          external_id: "[TEST] ext-remetente",
          account_id: lar.accountId,
          card_id: null,
          bill_id: null,
          futura: null,
          movement: "pix_recebido",
          occurred_at: "2026-11-05T15:00:00.000Z",
          local_date: "2026-11-05",
          amount_cents: 150_000,
          original_description: "[TEST] PIX RECEBIDO FULANA",
          establishment_key: null,
          counterparty_name: "[TEST] Fulana",
          counterparty_doc_masked: "***.123.456-**",
          counterparty_bank: null,
          installment_number: null,
          installment_total: null,
          provider_category: null,
          provider_operation_type: null,
        },
      ],
    });

    const [id] = resultado.insertedIds;
    expect(id).toBeDefined();
    const linha = await linhaDa(id as string);
    expect(linha?.income_kind).toBe("parte_salario");
    expect(linha?.fixed_income_id).toBe(renda);
    expect(linha?.categorized_by).toBe("regra");
    expect(linha?.rule_id).toBe(regra);
    expect(await recebimentosDa(id as string)).toEqual([{ fixed_income_id: renda, confirmed_by: "regra" }]);
  });
});

describe("marca da TASK-0902 com a conciliação da TASK-0207", () => {
  const conciliar = async (householdId: string, ids: string[]) =>
    classifyMovements(dbDeTeste(), householdId, ids, "2026-11-10T13:00:00.000Z");

  it("o que a pessoa classificou fica, e o recebimento não duplica nem some", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const renda = await criarRenda(lar, "[TEST] Salário em dólar");
    const transferido = await criarPix(lar, 50_000, "[TEST] Beltrana");
    const rendimento = await criarPix(lar, 30_000, "[TEST] Banco rende");
    const salario = await criarPix(lar, 150_000, "[TEST] Ciclana");
    const app = appDoLar(lar);
    await chamar(app, "PUT", url(transferido), { option: "transferencia", remember: false });
    await chamar(app, "PUT", url(rendimento), {
      option: "variavel",
      incomeSubtype: "rendimento",
      remember: false,
    });
    await chamar(app, "PUT", url(salario), { option: "salario", fixedIncomeId: renda, remember: false });

    await conciliar(lar.householdId, [transferido, rendimento, salario]);

    expect((await linhaDa(transferido))?.income_kind).toBe("transferencia");
    expect((await linhaDa(rendimento))?.income_kind).toBe("variavel");
    expect((await linhaDa(rendimento))?.income_subtype).toBe("rendimento");
    expect((await linhaDa(salario))?.income_kind).toBe("parte_salario");
    expect(await recebimentosDa(salario)).toHaveLength(1);
  });

  it("o que a regra de remetente classificou (com rule_id) não é marca própria: a conciliação mantém", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    await criarRegraDeRemetente(lar, CHAVE_FULANA, { kind: "variavel", subtipo: "rendimento" });
    const pix = await criarPix(lar, 30_000);
    await processNewTransactions(dbDeTeste(), lar.householdId, [pix], AGORA);
    const classificado = await linhaDa(pix);
    expect(classificado?.income_kind).toBe("variavel");
    expect(classificado?.rule_id).not.toBeNull();

    await conciliar(lar.householdId, [pix]);

    const depois = await linhaDa(pix);
    expect(depois?.income_kind).toBe("variavel");
    expect(depois?.income_subtype).toBe("rendimento");
    expect(depois?.rule_id).toBe(classificado?.rule_id);
  });

  it("o recebimento do extrato (marca 'regra' sem rule_id) fica com a conciliação e com o pipeline de novo, sem duplicar", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const renda = await criarRenda(lar, "[TEST] Renda X", 1_000_000, {
      arrival: "auto",
      texto: "PAGADORA EXTERIOR",
    });
    const pix = await criarPix(lar, 300_000, "[TEST] Fulana", { descricao: "[TEST] PAGADORA EXTERIOR Pix" });
    await processNewTransactions(dbDeTeste(), lar.householdId, [pix], AGORA);
    expect(await recebimentosDa(pix)).toEqual([{ fixed_income_id: renda, confirmed_by: "extrato" }]);

    await conciliar(lar.householdId, [pix]);
    await processNewTransactions(dbDeTeste(), lar.householdId, [pix], AGORA);

    expect((await linhaDa(pix))?.income_kind).toBe("parte_salario");
    expect(await recebimentosDa(pix)).toEqual([{ fixed_income_id: renda, confirmed_by: "extrato" }]);
  });
});

describe("chamadas ao D1 por rota (metered-d1)", () => {
  it("GET 2, prévia 2, PUT 3, aceite com entrada 2, aceite só de saída 1 e desfazer 1", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const renda = await criarRenda(lar, "[TEST] Salário em dólar");
    const pix = await criarPix(lar, 150_000);
    const aceitavel = await criarPix(lar, 90_000, "[TEST] Beltrana");
    await sugerir(aceitavel, { kind: "variavel", subtipo: "venda" });
    const medidos: Meter[] = [];
    const app = createApp({
      resolveSession: async () => ({ householdId: lar.householdId, memberId: lar.memberId }),
      agora: () => new Date(AGORA),
      onMeter: (meter) => medidos.push({ ...meter }),
    });

    await chamar(app, "GET", url(pix));
    await chamar(app, "POST", `${url(pix)}/preview`, { option: "salario", fixedIncomeId: renda });
    await chamar(app, "PUT", url(pix), { option: "salario", fixedIncomeId: renda, remember: true });
    await chamar(app, "POST", "/api/categorization/accept", { transactionIds: [aceitavel] });
    await chamar(app, "POST", "/api/categorization/accept", { transactionIds: ["inexistente"] });
    await chamar(app, "POST", "/api/categorization/undo", {
      items: [{ transactionId: aceitavel, categoryId: null }],
    });

    expect(medidos.map((m) => m.calls)).toEqual([2, 2, 3, 2, 1, 1]);
  });

  it("o pipeline continua em 2 chamadas, com a regra de remetente e o extrato no mesmo lote", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const renda = await criarRenda(lar, "[TEST] Salário em dólar");
    await criarRegraDeRemetente(lar, CHAVE_FULANA, { kind: "parte_salario", rendaId: renda });
    const ids = [
      await criarPix(lar, 100_000),
      await criarPix(lar, 200_000),
      await inserirTransacao(lar, {
        movement: "pix_enviado",
        amountCents: -500,
        descricao: "[TEST] enviado",
      }),
    ];
    const meter = newMeter();

    await processNewTransactions(createDb(env.DB, meter), lar.householdId, ids, AGORA);

    expect(meter.calls).toBeLessThanOrEqual(2);
    expect(await contar("SELECT COUNT(*) AS total FROM fixed_income_receipts")).toBe(2);
  });
});

describe("casos das mutações que sobreviveram", () => {
  it("422 nao_e_entrada no PUT e na prévia, sem gravar nada", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const enviado = await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -5_000,
      descricao: "[TEST] Pix enviado",
      localDate: "2026-10-20",
    });
    const app = appDoLar(lar);

    const put = await chamar(app, "PUT", url(enviado), { option: "reembolso", remember: false });
    const previa = await chamar(app, "POST", `${url(enviado)}/preview`, { option: "reembolso" });

    expect(put.status).toBe(422);
    expect(put.corpo.error).toBe("nao_e_entrada");
    expect(previa.status).toBe(422);
    expect(previa.corpo.error).toBe("nao_e_entrada");
    expect((await linhaDa(enviado))?.income_kind).toBeNull();
    expect((await linhaDa(enviado))?.hidden).toBe(0);
  });

  it("oculta por outro motivo continua oculta quando a opção troca", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const pix = await criarPix(lar, 150_000);
    await env.DB.prepare("UPDATE transactions SET hidden = 1, hidden_reason = 'gasto_terceiros' WHERE id = ?")
      .bind(pix)
      .run();
    const app = appDoLar(lar);

    await chamar(app, "PUT", url(pix), { option: "variavel", incomeSubtype: "venda", remember: false });
    await chamar(app, "PUT", url(pix), { option: "transferencia", remember: false });

    const linha = await linhaDa(pix);
    expect(linha?.income_kind).toBe("transferencia");
    expect(linha?.hidden).toBe(1);
    expect(linha?.hidden_reason).toBe("gasto_terceiros");
  });

  it("aceite: entrada do histórico não é aceita pela fila, e fica em skipped", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const historico = await criarPix(lar, 150_000, "[TEST] Fulana", { backfill: true });
    await sugerir(historico, { kind: "variavel", subtipo: "venda" });

    const aceite = await chamar(appDoLar(lar), "POST", "/api/categorization/accept", {
      transactionIds: [historico],
    });

    expect(aceite.corpo.skipped).toEqual([historico]);
    expect(aceite.corpo.accepted).toEqual([]);
    expect((await linhaDa(historico))?.income_kind).toBeNull();
  });

  it("aceite: os iguais que esperavam recebem a classificação e o recebimento da regra", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const renda = await criarRenda(lar, "[TEST] Salário em dólar");
    const aceita = await criarPix(lar, 100_000);
    const igual = await criarPix(lar, 150_000, "[TEST] Fulana", { dia: "2026-10-21" });
    await sugerir(aceita, { kind: "parte_salario", rendaId: renda });

    const aceite = await chamar(appDoLar(lar), "POST", "/api/categorization/accept", {
      transactionIds: [aceita],
    });

    expect(aceite.corpo.accepted.map((x: { transactionId: string }) => x.transactionId)).toEqual([aceita]);
    expect(aceite.corpo.alsoResolved.map((x: { transactionId: string }) => x.transactionId)).toEqual([igual]);
    const linha = await linhaDa(igual);
    expect(linha?.income_kind).toBe("parte_salario");
    expect(linha?.categorized_by).toBe("regra");
    expect(linha?.rule_id).not.toBeNull();
    expect(await recebimentosDa(igual)).toEqual([{ fixed_income_id: renda, confirmed_by: "regra" }]);
  });
});
