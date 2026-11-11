import { describe, expect, it } from "vitest";
import { isCardPayment, type LinhaClassificavel } from "../../../../src/worker/bank/classify-rules";
import {
  type CardBillContext,
  mapMovement,
  type PluggyTransaction,
  resolveCardBill,
} from "../../../../src/worker/bank/map";

// Correções herdadas da TASK-0202 (avaliação final) e o achado da TASK-0207 (PAGAMENTO) entram na TASK-0204.
const CARTAO = "[TEST] cartao-resolve";

const transacao = (extra: Partial<PluggyTransaction> = {}): PluggyTransaction => ({
  id: "[TEST] tx-resolve",
  date: "2026-10-28T12:00:00.000Z",
  description: "[TEST] Compra",
  amount: 45.9,
  type: "DEBIT",
  category: null,
  operationType: null,
  paymentData: null,
  creditCardMetadata: null,
  ...extra,
});

const contexto = (extra: Partial<CardBillContext> = {}): CardBillContext => ({
  cardId: CARTAO,
  openClosesOn: "2026-12-03",
  knownBills: [],
  ...extra,
});

describe("resolveCardBill: primeiro fechamento conhecido (correção da TASK-0202)", () => {
  it("releitura da compra de 28/10 mantém a fatura real de 04/11, mesmo com a aberta em dezembro", () => {
    const real = { id: "[TEST] real-nov", closes_on: "2026-11-04" };
    expect(resolveCardBill(transacao(), contexto({ knownBills: [real] }))).toEqual({
      billId: "[TEST] real-nov",
      closesOn: "2026-11-04",
    });
  });

  it("sem real a cobrir a compra, a aberta cobre a compra que cai antes do fechamento dela", () => {
    expect(resolveCardBill(transacao({ date: "2026-11-20T12:00:00.000Z" }), contexto())).toEqual({
      billId: `sint:${CARTAO}:2026-12-03`,
      closesOn: "2026-12-03",
    });
  });

  it("uma real anterior à compra não a leva: sem real a cobrir, vai para o primeiro fechamento conhecido (a aberta)", () => {
    const real = { id: "[TEST] real-out", closes_on: "2026-10-03" };
    expect(
      resolveCardBill(transacao({ date: "2026-10-28T12:00:00.000Z" }), contexto({ knownBills: [real] })),
    ).toEqual({
      billId: `sint:${CARTAO}:2026-12-03`,
      closesOn: "2026-12-03",
    });
  });

  it("regra (4) na virada do ano: compra de 15/12 com fechamento no dia 3 cai em 03/01/2027", () => {
    expect(
      resolveCardBill(
        transacao({ date: "2026-12-15T12:00:00.000Z" }),
        contexto({ openClosesOn: "2026-12-03" }),
      ),
    ).toEqual({ billId: `sint:${CARTAO}:2027-01-03`, closesOn: "2027-01-03" });
  });
});

describe("resolveCardBill: previsão do Pluggy (billForecastDate)", () => {
  it("AAAA-MM válido é usado", () => {
    expect(
      resolveCardBill(
        transacao({ creditCardMetadata: { billForecastDate: "2027-01" } }),
        contexto({ openClosesOn: "2026-12-03" }),
      ),
    ).toEqual({ billId: `sint:${CARTAO}:2027-01-03`, closesOn: "2027-01-03" });
  });

  it("formato fora de AAAA-MM é ignorado e segue para a regra seguinte", () => {
    for (const previsao of ["2026-12-03", "2026-12-03T00:00:00.000Z", "2026-1"]) {
      const resultado = resolveCardBill(
        transacao({ date: "2026-11-20T12:00:00.000Z", creditCardMetadata: { billForecastDate: previsao } }),
        contexto(),
      );
      expect(resultado).toEqual({ billId: `sint:${CARTAO}:2026-12-03`, closesOn: "2026-12-03" });
    }
  });
});

describe("mapMovement: PAGAMENTO no cartão (achado da TASK-0207)", () => {
  it("valor negativo com PAGAMENTO é pagamento de fatura, e não estorno", () => {
    expect(mapMovement(transacao({ amount: -2870.4, operationType: "PAGAMENTO" }), "CREDIT")).toBe(
      "pagamento_fatura",
    );
  });

  it("valor negativo sem operação conhecida continua estorno", () => {
    expect(mapMovement(transacao({ amount: -10, operationType: "OUTROS" }), "CREDIT")).toBe("estorno");
  });

  it("a classificação trata PAGAMENTO com o mesmo CARD_PAYMENT de PAGAMENTO_FATURA", () => {
    const linha = {
      id: "[TEST] l1",
      card_id: CARTAO,
      amount_cents: 287040,
      provider_operation_type: "PAGAMENTO",
      provider_category: null,
    } as unknown as LinhaClassificavel;
    expect(isCardPayment(linha)).toBe(true);
  });
});
