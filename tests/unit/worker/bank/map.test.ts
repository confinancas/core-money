import { describe, expect, it } from "vitest";
import {
  type CardBillContext,
  type ContaDaTransacao,
  mapAccount,
  mapBill,
  mapCard,
  mapInvestmentAccount,
  mapMovement,
  mapTransaction,
  mascararDocumento,
  openBillFromCard,
  type PluggyAccount,
  type PluggyTransaction,
  resolveCardBill,
  toCents,
} from "../../../../src/worker/bank/map";

const CARTAO = "[TEST] cartao-1";

const transacao = (extra: Partial<PluggyTransaction> = {}): PluggyTransaction => ({
  id: "[TEST] tx-1",
  date: "2026-11-10T12:00:00.000Z",
  description: "[TEST] Movimento",
  amount: 10,
  type: "DEBIT",
  category: null,
  operationType: null,
  paymentData: null,
  creditCardMetadata: null,
  ...extra,
});

const contaBanco: ContaDaTransacao = { kind: "BANK", accountId: "[TEST] conta-1" };

const faturasComAberta = (extra: Partial<CardBillContext> = {}): CardBillContext => ({
  cardId: CARTAO,
  openClosesOn: "2026-11-03",
  knownBills: [],
  ...extra,
});

const contaCartao = (faturas: CardBillContext = faturasComAberta()): ContaDaTransacao => ({
  kind: "CREDIT",
  cardId: CARTAO,
  faturas,
});

describe("toCents", () => {
  it("arredonda a soma de decimais binários para o centavo certo", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it("meio centavo arredonda para cima em valor absoluto, nos dois sinais", () => {
    expect(toCents(0.125)).toBe(13);
    expect(toCents(-0.125)).toBe(-13);
  });

  it("arredonda o valor absoluto, então o negativo é simétrico", () => {
    expect(toCents(-212.45)).toBe(-21245);
    expect(toCents(-2870.4)).toBe(-287040);
    expect(toCents(45.9)).toBe(4590);
  });

  it("zero nunca sai como -0", () => {
    expect(Object.is(toCents(-0.004), 0)).toBe(true);
    expect(Object.is(toCents(-0), 0)).toBe(true);
  });

  it.each([[Number.NaN], [Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY]])(
    "recusa %s com TypeError",
    (valor) => {
      expect(() => toCents(valor)).toThrow(TypeError);
    },
  );
});

describe("mapTransaction: cenários da especificação", () => {
  it("1. Pix enviado: saída de 150,00 com CPF do recebedor", () => {
    const linha = mapTransaction(
      transacao({
        operationType: "PIX",
        amount: 150,
        type: "DEBIT",
        paymentData: {
          paymentMethod: "PIX",
          receiver: {
            name: "[TEST] Recebedor",
            documentNumber: { type: "CPF", value: "12345678901" },
            routingNumber: "341",
          },
        },
      }),
      contaBanco,
    );

    expect(linha).toMatchObject({
      movement: "pix_enviado",
      amount_cents: -15000,
      counterparty_doc_masked: "***.456.789-**",
      counterparty_name: "[TEST] Recebedor",
      counterparty_bank: "Itaú",
      account_id: "[TEST] conta-1",
      card_id: null,
      bill_id: null,
      futura: null,
    });
  });

  it("entrada na conta pega o pagador como contraparte", () => {
    const linha = mapTransaction(
      transacao({
        operationType: "PIX",
        amount: 20,
        type: "CREDIT",
        paymentData: {
          paymentMethod: "PIX",
          payer: { name: "[TEST] Pagador", documentNumber: { type: "CNPJ", value: "12345678000190" } },
          receiver: { name: "[TEST] Ignorado" },
        },
      }),
      contaBanco,
    );

    expect(linha).toMatchObject({
      movement: "pix_recebido",
      amount_cents: 2000,
      counterparty_name: "[TEST] Pagador",
      counterparty_doc_masked: "12.345.678/0001-90",
    });
  });

  it("2. Compra no cartão: 45,90 vira -4590, sem contraparte", () => {
    const linha = mapTransaction(
      transacao({ amount: 45.9, date: "2026-10-28T15:00:00.000Z" }),
      contaCartao(),
    );

    expect(linha).toMatchObject({
      movement: "compra",
      amount_cents: -4590,
      counterparty_name: null,
      counterparty_doc_masked: null,
      counterparty_bank: null,
      account_id: null,
      card_id: CARTAO,
      bill_id: `sint:${CARTAO}:2026-11-03`,
    });
  });

  it("3. Pagamento no cartão: -2870,40 com PAGAMENTO_FATURA vira +287040", () => {
    const linha = mapTransaction(
      transacao({ amount: -2870.4, operationType: "PAGAMENTO_FATURA", date: "2026-11-05T12:00:00.000Z" }),
      contaCartao(),
    );

    expect(linha).toMatchObject({ movement: "pagamento_fatura", amount_cents: 287040 });
  });

  it("5. Parcela: 3 de 10 grava os dois; 1 de 1 deixa os dois nulos", () => {
    const parcelada = mapTransaction(
      transacao({ amount: 100, creditCardMetadata: { installmentNumber: 3, totalInstallments: 10 } }),
      contaCartao(),
    );
    const avulsa = mapTransaction(
      transacao({ amount: 100, creditCardMetadata: { installmentNumber: 1, totalInstallments: 1 } }),
      contaCartao(),
    );

    expect(parcelada).toMatchObject({ installment_number: 3, installment_total: 10 });
    expect(avulsa).toMatchObject({ installment_number: null, installment_total: null });
  });

  it("usa a descrição crua (sem espaços das pontas) para a chave do estabelecimento", () => {
    const linha = mapTransaction(
      transacao({ description: "[TEST] Loja", descriptionRaw: "  [TEST] LOJA X 02/10  ", amount: 10 }),
      contaCartao(),
    );

    expect(linha.original_description).toBe("[TEST] LOJA X 02/10");
    expect(linha.establishment_key).toBe("[TEST] LOJA X");
  });

  it("sem descrição crua, usa a descrição", () => {
    const linha = mapTransaction(
      transacao({ description: "[TEST] Loja", descriptionRaw: "   " }),
      contaBanco,
    );
    expect(linha.original_description).toBe("[TEST] Loja");
  });

  it("guarda a categoria e o tipo de operação do Pluggy como vieram", () => {
    const linha = mapTransaction(
      transacao({ category: "Credit card payment", operationType: "PAGAMENTO_FATURA", amount: -10 }),
      contaCartao(),
    );
    expect(linha).toMatchObject({
      provider_category: "Credit card payment",
      provider_operation_type: "PAGAMENTO_FATURA",
    });
  });
});

describe("mapTransaction: fatura e futura", () => {
  it("cria a fatura futura quando a previsão cai depois da aberta", () => {
    const linha = mapTransaction(
      transacao({ creditCardMetadata: { billForecastDate: "2026-12" }, date: "2026-11-15T12:00:00.000Z" }),
      contaCartao(),
    );

    expect(linha.bill_id).toBe(`sint:${CARTAO}:2026-12-03`);
    expect(linha.futura).toEqual({
      id: `sint:${CARTAO}:2026-12-03`,
      card_id: CARTAO,
      closes_on: "2026-12-03",
    });
  });

  it("não cria futura para a própria aberta", () => {
    const linha = mapTransaction(transacao({ date: "2026-10-28T12:00:00.000Z" }), contaCartao());
    expect(linha.futura).toBeNull();
  });

  it("não cria futura para fatura real", () => {
    const linha = mapTransaction(
      transacao({ creditCardMetadata: { billId: "[TEST] fatura-real" } }),
      contaCartao(faturasComAberta({ knownBills: [{ id: "[TEST] fatura-real", closes_on: "2026-10-03" }] })),
    );
    expect(linha.bill_id).toBe("[TEST] fatura-real");
    expect(linha.futura).toBeNull();
  });
});

describe("mapMovement: tabela de movimentos", () => {
  const BANCO = "BANK" as const;
  const CARTAO_TIPO = "CREDIT" as const;

  it.each([
    ["PIX (saída)", { type: "DEBIT", operationType: "PIX" }, BANCO, "pix_enviado"],
    ["método PIX (saída)", { type: "DEBIT", paymentData: { paymentMethod: "PIX" } }, BANCO, "pix_enviado"],
    ["TED (saída)", { type: "DEBIT", operationType: "TED" }, BANCO, "ted_enviada"],
    ["DOC (saída)", { type: "DEBIT", operationType: "DOC" }, BANCO, "ted_enviada"],
    [
      "transferência na mesma instituição (saída)",
      { type: "DEBIT", operationType: "TRANSFERENCIA_MESMA_INSTITUICAO" },
      BANCO,
      "ted_enviada",
    ],
    ["método TEV (saída)", { type: "DEBIT", paymentData: { paymentMethod: "TEV" } }, BANCO, "ted_enviada"],
    ["boleto (saída)", { type: "DEBIT", operationType: "BOLETO" }, BANCO, "boleto"],
    ["convênio (saída)", { type: "DEBIT", operationType: "CONVENIO_ARRECADACAO" }, BANCO, "boleto"],
    ["método boleto (saída)", { type: "DEBIT", paymentData: { paymentMethod: "BOLETO" } }, BANCO, "boleto"],
    ["cartão (saída)", { type: "DEBIT", operationType: "CARTAO" }, BANCO, "debito"],
    ["saque (saída)", { type: "DEBIT", operationType: "SAQUE" }, BANCO, "debito"],
    ["pacote de tarifa (saída)", { type: "DEBIT", operationType: "PACOTE_TARIFA_SERVICOS" }, BANCO, "debito"],
    ["tarifa avulsa (saída)", { type: "DEBIT", operationType: "TARIFA_SERVICOS_AVULSOS" }, BANCO, "debito"],
    [
      "juros do cheque especial (saída)",
      { type: "DEBIT", operationType: "ENCARGOS_JUROS_CHEQUE_ESPECIAL" },
      BANCO,
      "debito",
    ],
    ["operação de crédito (saída)", { type: "DEBIT", operationType: "OPERACAO_CREDITO" }, BANCO, "debito"],
    ["OUTROS (saída)", { type: "DEBIT", operationType: "OUTROS" }, BANCO, "outro"],
    ["sem operação (saída)", { type: "DEBIT", operationType: null }, BANCO, "outro"],
    ["PIX (entrada)", { type: "CREDIT", operationType: "PIX" }, BANCO, "pix_recebido"],
    ["TED (entrada)", { type: "CREDIT", operationType: "TED" }, BANCO, "ted_recebida"],
    ["DOC (entrada)", { type: "CREDIT", paymentData: { paymentMethod: "DOC" } }, BANCO, "ted_recebida"],
    [
      "rendimento (entrada)",
      { type: "CREDIT", operationType: "RENDIMENTO_APLIC_FINANCEIRA" },
      BANCO,
      "rendimento",
    ],
    [
      "folha de pagamento (entrada)",
      { type: "CREDIT", operationType: "FOLHA_PAGAMENTO" },
      BANCO,
      "ted_recebida",
    ],
    [
      "portabilidade de salário (entrada)",
      { type: "CREDIT", operationType: "PORTABILIDADE_SALARIO" },
      BANCO,
      "ted_recebida",
    ],
    ["boleto (entrada) não é boleto", { type: "CREDIT", operationType: "BOLETO" }, BANCO, "outro"],
    ["cartão (entrada) não é débito", { type: "CREDIT", operationType: "CARTAO" }, BANCO, "outro"],
    ["PAGAMENTO_FATURA na conta", { type: "DEBIT", operationType: "PAGAMENTO_FATURA" }, BANCO, "outro"],
    [
      "cartão: pagamento de fatura (entrada)",
      { amount: -100, operationType: "PAGAMENTO_FATURA" },
      CARTAO_TIPO,
      "pagamento_fatura",
    ],
    [
      "cartão: categoria de pagamento (entrada)",
      { amount: -100, category: "Credit card payment" },
      CARTAO_TIPO,
      "pagamento_fatura",
    ],
    ["cartão: estorno (entrada)", { amount: -50, operationType: "ESTORNO" }, CARTAO_TIPO, "estorno"],
    ["cartão: cashback (entrada)", { amount: -5, operationType: "CASHBACK" }, CARTAO_TIPO, "outro"],
    ["cartão: crédito sem outro sinal", { amount: -50 }, CARTAO_TIPO, "estorno"],
    ["cartão: compra", { amount: 45.9 }, CARTAO_TIPO, "compra"],
    ["cartão: tarifa (saída) é compra", { amount: 12, operationType: "ENCARGOS" }, CARTAO_TIPO, "compra"],
    [
      "cartão: estorno com sinal de saída é compra",
      { amount: 50, operationType: "ESTORNO" },
      CARTAO_TIPO,
      "compra",
    ],
  ] as const)("%s", (_nome, extra, tipo, esperado) => {
    expect(mapMovement(transacao(extra), tipo)).toBe(esperado);
  });
});

describe("mapAccount", () => {
  const conta = (extra: Partial<PluggyAccount> = {}): PluggyAccount => ({
    id: "[TEST] conta-1",
    type: "BANK",
    subtype: "CHECKING_ACCOUNT",
    name: "[TEST] Conta",
    balance: 1234.5,
    ...extra,
  });

  it("conta corrente: saldo em centavos, cheque especial usado e nome de marketing", () => {
    expect(
      mapAccount(
        conta({
          marketingName: "[TEST] Conta Corrente",
          bankData: { overdraftUsedLimit: 12.34 },
        }),
      ),
    ).toEqual({
      id: "[TEST] conta-1",
      kind: "corrente",
      name: "[TEST] Conta Corrente",
      balance_cents: 123450,
      overdraft_used_cents: 1234,
    });
  });

  it("poupança e saldo negativo", () => {
    expect(mapAccount(conta({ subtype: "SAVINGS_ACCOUNT", balance: -10 }))).toMatchObject({
      kind: "poupanca",
      balance_cents: -1000,
      overdraft_used_cents: 0,
    });
  });

  it("cartão não é conta: devolve null", () => {
    expect(mapAccount(conta({ type: "CREDIT", subtype: "CREDIT_CARD" }))).toBeNull();
  });
});

describe("mapInvestmentAccount", () => {
  it("investimento resgatado por inteiro não entra", () => {
    expect(
      mapInvestmentAccount({
        id: "[TEST] inv-1",
        name: "[TEST] Caixinha",
        status: "TOTAL_WITHDRAWAL",
        balance: 0,
      }),
    ).toBeNull();
  });

  it.each([
    ["[TEST] Caixinha Viagem"],
    ["[TEST] Cofrinho"],
    ["[TEST] Porquinho"],
    ["[TEST] Reserva de emergência"],
  ])("renda fixa com nome de caixinha (%s) vira caixinha", (nome) => {
    expect(
      mapInvestmentAccount({ id: "[TEST] inv-1", name: nome, type: "FIXED_INCOME", balance: 100 }),
    ).toMatchObject({ kind: "caixinha", balance_cents: 10000 });
  });

  it("renda fixa comum vira outra", () => {
    expect(
      mapInvestmentAccount({ id: "[TEST] inv-2", name: "[TEST] CDB 2028", type: "FIXED_INCOME", balance: 1 }),
    ).toMatchObject({ kind: "outra", balance_cents: 100 });
  });

  it("nome de caixinha fora da renda fixa vira outra", () => {
    expect(
      mapInvestmentAccount({ id: "[TEST] inv-3", name: "[TEST] Reserva", type: "EQUITY", balance: 1 }),
    ).toMatchObject({ kind: "outra" });
  });
});

describe("mapCard", () => {
  it("guarda os últimos 4 dígitos, o limite e o disponível em centavos", () => {
    expect(
      mapCard({
        id: CARTAO,
        type: "CREDIT",
        number: "************1234",
        name: "[TEST] Cartão",
        balance: 0,
        creditData: { creditLimit: 5000, availableCreditLimit: 1234.56 },
      }),
    ).toEqual({
      id: CARTAO,
      last4: "1234",
      name: "[TEST] Cartão",
      limit_cents: 500000,
      available_cents: 123456,
    });
  });

  it("sem limite informado, os campos ficam nulos", () => {
    expect(
      mapCard({ id: CARTAO, type: "CREDIT", number: "5678", name: "[TEST] C", balance: 0 }),
    ).toMatchObject({
      limit_cents: null,
      available_cents: null,
    });
  });
});

describe("openBillFromCard", () => {
  const cartao = (creditData: PluggyAccount["creditData"]): PluggyAccount => ({
    id: CARTAO,
    type: "CREDIT",
    name: "[TEST] Cartão",
    balance: 1234.5,
    creditData,
  });

  it("monta a aberta sintética com o fechamento e o vencimento do Pluggy", () => {
    expect(
      openBillFromCard(
        cartao({
          balanceCloseDate: "2026-11-03T00:00:00.000Z",
          balanceDueDate: "2026-11-10T00:00:00.000Z",
        }),
      ),
    ).toEqual({
      id: `sint:${CARTAO}:2026-11-03`,
      closes_on: "2026-11-03",
      due_on: "2026-11-10",
      amount_cents: 123450,
      status: "aberta",
      paid_on: null,
    });
  });

  it("sem data de fechamento não há aberta", () => {
    expect(openBillFromCard(cartao({ balanceDueDate: "2026-11-10T00:00:00.000Z" }))).toBeNull();
  });
});

describe("mapBill", () => {
  it("usa a data de fechamento do Pluggy quando vem", () => {
    expect(
      mapBill(
        {
          id: "[TEST] fatura-1",
          dueDate: "2026-11-10T00:00:00.000Z",
          billClosingDate: "2026-11-03T00:00:00.000Z",
          totalAmount: 1500.5,
          payments: [{ amount: 500, paymentDate: "2026-11-05" }],
        },
        7,
      ),
    ).toEqual({
      id: "[TEST] fatura-1",
      closes_on: "2026-11-03",
      due_on: "2026-11-10",
      amount_cents: 150050,
      status: "fechada",
      paid_on: null,
    });
  });

  it("sem data de fechamento, usa o vencimento menos o intervalo", () => {
    expect(
      mapBill({ id: "[TEST] fatura-2", dueDate: "2026-11-10", totalAmount: 100, payments: [] }, 7),
    ).toMatchObject({ closes_on: "2026-11-03", due_on: "2026-11-10", status: "fechada" });
  });

  it("paga quando os pagamentos cobrem o total, com a data do último", () => {
    expect(
      mapBill(
        {
          id: "[TEST] fatura-3",
          dueDate: "2026-11-10",
          billClosingDate: "2026-11-03",
          totalAmount: 1500.5,
          payments: [
            { amount: 1000, paymentDate: "2026-11-09" },
            { amount: 500.5, paymentDate: "2026-11-05" },
          ],
        },
        7,
      ),
    ).toMatchObject({ status: "paga", paid_on: "2026-11-09" });
  });
});

describe("resolveCardBill", () => {
  it("sem dia de fechamento conhecido, a compra fica sem fatura", () => {
    const semDia = { cardId: CARTAO, openClosesOn: null, knownBills: [] };
    expect(resolveCardBill(transacao({ date: "2026-10-28T12:00:00.000Z" }), semDia)).toBeNull();
  });

  it("depois da aberta, sem previsão: o próximo fechamento do dia do cartão", () => {
    expect(resolveCardBill(transacao({ date: "2026-11-20T12:00:00.000Z" }), faturasComAberta())).toEqual({
      billId: `sint:${CARTAO}:2026-12-03`,
      closesOn: "2026-12-03",
    });
  });

  it("a previsão de um mês com menos dias fecha no último dia do mês", () => {
    const resultado = resolveCardBill(
      transacao({ creditCardMetadata: { billForecastDate: "2027-02" } }),
      faturasComAberta({ openClosesOn: "2026-12-31" }),
    );
    expect(resultado?.closesOn).toBe("2027-02-28");
  });

  it("a previsão que cai num fechamento de fatura real usa a real", () => {
    expect(
      resolveCardBill(
        transacao({ creditCardMetadata: { billForecastDate: "2026-10" } }),
        faturasComAberta({ knownBills: [{ id: "[TEST] real-out", closes_on: "2026-10-03" }] }),
      ),
    ).toEqual({ billId: "[TEST] real-out", closesOn: "2026-10-03" });
  });
});

describe("mascararDocumento", () => {
  it("CPF mostra só os 6 dígitos do meio", () => {
    expect(mascararDocumento("123.456.789-01")).toBe("***.456.789-**");
  });

  it("CNPJ vai formatado inteiro", () => {
    expect(mascararDocumento("12345678000190")).toBe("12.345.678/0001-90");
  });

  it("outro tamanho ou sem documento devolve null", () => {
    expect(mascararDocumento("123")).toBeNull();
    expect(mascararDocumento(null)).toBeNull();
  });
});
