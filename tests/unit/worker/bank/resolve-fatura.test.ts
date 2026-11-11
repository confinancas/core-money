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

  it("uma real anterior à compra não a leva; a aberta fica a 36 dias, além do teto de 35 (R10), e a compra fica sem fatura", () => {
    // O fechamento calculado da compra é 03/11, antes da aberta (03/12) e sem fatura real: fica sem fatura.
    const real = { id: "[TEST] real-out", closes_on: "2026-10-03" };
    expect(
      resolveCardBill(transacao({ date: "2026-10-28T12:00:00.000Z" }), contexto({ knownBills: [real] })),
    ).toBeNull();
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

// Faturas reais só de junho a novembro de 2026 (o Pluggy devolveu só esse trecho), com a aberta em 03/12/2026.
const JUNHO_A_NOVEMBRO = [
  "2026-06-03",
  "2026-07-03",
  "2026-08-03",
  "2026-09-03",
  "2026-10-03",
  "2026-11-03",
].map((fecha) => ({ id: `[TEST] real-${fecha}`, closes_on: fecha }));

describe("resolveCardBill: teto de 35 dias no fechamento conhecido (TASK-0204, R10)", () => {
  it("compras de dezembro a abril não vão para a de junho: com a aberta, o fechamento calculado é anterior a ela e sem fatura real", () => {
    for (const data of ["2025-12-05", "2026-01-20", "2026-03-10", "2026-04-15"]) {
      expect(
        resolveCardBill(
          transacao({ date: `${data}T12:00:00.000Z` }),
          contexto({ knownBills: JUNHO_A_NOVEMBRO }),
        ),
      ).toBeNull();
    }
  });

  it("uma compra a até 35 dias do fechamento conhecido segue o teto e vai para ele (20/05 cai na de 03/06)", () => {
    expect(
      resolveCardBill(
        transacao({ date: "2026-05-20T12:00:00.000Z" }),
        contexto({ knownBills: JUNHO_A_NOVEMBRO }),
      ),
    ).toEqual({ billId: "[TEST] real-2026-06-03", closesOn: "2026-06-03" });
  });

  it("sem a aberta, as compras de dezembro e abril vão para as sintéticas dos fechamentos calculados delas", () => {
    expect(
      resolveCardBill(
        transacao({ date: "2025-12-05T12:00:00.000Z" }),
        contexto({ openClosesOn: null, knownBills: JUNHO_A_NOVEMBRO }),
      ),
    ).toEqual({ billId: `sint:${CARTAO}:2026-01-03`, closesOn: "2026-01-03" });
    expect(
      resolveCardBill(
        transacao({ date: "2026-04-15T12:00:00.000Z" }),
        contexto({ openClosesOn: null, knownBills: JUNHO_A_NOVEMBRO }),
      ),
    ).toEqual({ billId: `sint:${CARTAO}:2026-05-03`, closesOn: "2026-05-03" });
  });

  it("sem nenhuma fatura real, as compras de meses antigos não caem todas na aberta; a de novembro segue nela", () => {
    expect(resolveCardBill(transacao({ date: "2026-05-10T12:00:00.000Z" }), contexto())).toBeNull();
    expect(resolveCardBill(transacao({ date: "2026-07-01T12:00:00.000Z" }), contexto())).toBeNull();
    expect(resolveCardBill(transacao({ date: "2026-11-20T12:00:00.000Z" }), contexto())).toEqual({
      billId: `sint:${CARTAO}:2026-12-03`,
      closesOn: "2026-12-03",
    });
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
