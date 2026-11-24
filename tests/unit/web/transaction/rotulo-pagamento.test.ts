import { describe, expect, it } from "vitest";
import { rotuloDoPagamento } from "../../../../src/web/screens/transaction/view-model";

// Pagamento de cartão na compra (TASK-0404): "Os próximos de <matchLabel>" usa o rótulo da categorização (0302), não o nome.
describe("rotuloDoPagamento", () => {
  it("usa o matchLabel da categorização quando ele é diferente do nome da compra", () => {
    expect(rotuloDoPagamento("[TEST] NU PAGAMENTOS", "[TEST] PAG BOLETO NU 123")).toBe(
      "[TEST] NU PAGAMENTOS",
    );
  });

  it("sem matchLabel (ou vazio), cai no nome da compra", () => {
    expect(rotuloDoPagamento(null, "[TEST] PAG CARTAO")).toBe("[TEST] PAG CARTAO");
    expect(rotuloDoPagamento("  ", "[TEST] PAG CARTAO")).toBe("[TEST] PAG CARTAO");
  });
});
