import { describe, expect, it } from "vitest";
import type { DetalheDaCompra } from "../../../../src/shared/api/transactions";
import {
  formaDaCompra,
  horaSaoPaulo,
  linhaDeData,
  podeOcultar,
  temTipoDeGasto,
  textoDaCategoria,
  textoDaFatura,
  textoDoCiclo,
  tiposDaCompra,
  tituloDaCompra,
} from "../../../../src/web/screens/transaction/view-model";

// Textos da tela da compra (TASK-0403): forma, fatura, ciclo, data, categoria e os tipos que cada compra oferece.

const BASE: DetalheDaCompra = {
  id: "t1",
  movement: "compra",
  localDate: "2026-11-10",
  occurredAt: "2026-11-10T17:32:00Z",
  amountCents: -4500,
  originalDescription: "PAG*JOSEDASILVA SAO PAULO BR",
  customName: null,
  displayName: "PAG*JOSEDASILVA SAO PAULO BR",
  category: null,
  categorizedBy: null,
  aiSuggestion: null,
  spendType: "prazeres",
  spendTypeSource: "padrao",
  hidden: false,
  hiddenReason: null,
  installment: null,
  card: { id: "c1", label: "Nubank", last4: "4417" },
  account: null,
  bill: { closesOn: "2026-11-03", dueOn: "2026-11-10" },
  cycle: { key: "2026-10", startsOn: "2026-10-11", endsOn: "2026-11-10" },
};

const com = (extra: Partial<DetalheDaCompra>): DetalheDaCompra => ({ ...BASE, ...extra });

describe("formaDaCompra", () => {
  it("cartão à vista, parcelado, estorno e as saídas da conta", () => {
    expect(formaDaCompra(BASE)).toBe("Crédito à vista");
    expect(formaDaCompra(com({ installment: { number: 2, total: 10 } }))).toBe(
      "Crédito parcelado · parcela 2 de 10",
    );
    expect(formaDaCompra(com({ movement: "estorno" }))).toBe("Estorno");
    expect(formaDaCompra(com({ movement: "debito", card: null, bill: null }))).toBe("Débito");
    expect(formaDaCompra(com({ movement: "boleto", card: null, bill: null }))).toBe("Boleto");
    expect(formaDaCompra(com({ movement: "outro", card: null, bill: null }))).toBe("Saída");
  });
});

describe("textoDaFatura e textoDoCiclo", () => {
  it("fecha e vence, só fecha sem vencimento, e sem fatura", () => {
    expect(textoDaFatura(BASE.bill)).toBe("Fecha 03/11 · vence 10/11");
    expect(textoDaFatura({ closesOn: "2026-11-03", dueOn: null })).toBe("Fecha 03/11");
    expect(textoDaFatura(null)).toBe("Sem fatura ainda");
  });

  it("mês por extenso com inicial maiúscula e as datas do ciclo", () => {
    expect(textoDoCiclo(BASE.cycle)).toBe("Outubro · 11/10 – 10/11");
    expect(textoDoCiclo(null)).toBe("—");
  });
});

describe("linhaDeData", () => {
  it("hoje, ontem e o dia da semana, com a hora de São Paulo", () => {
    expect(linhaDeData(BASE, "2026-11-10")).toBe("Hoje, 10/11 às 14:32 · Nubank final 4417");
    expect(linhaDeData({ ...BASE, localDate: "2026-11-09" }, "2026-11-10")).toBe(
      "Ontem, 09/11 às 14:32 · Nubank final 4417",
    );
    expect(linhaDeData({ ...BASE, localDate: "2026-11-04" }, "2026-11-10")).toBe(
      "Quarta-feira, 04/11 às 14:32 · Nubank final 4417",
    );
  });

  it("sem horário no texto, não mostra a hora; na conta, mostra o banco sem final", () => {
    expect(linhaDeData({ ...BASE, occurredAt: "2026-11-10" }, "2026-11-10")).toBe(
      "Hoje, 10/11 · Nubank final 4417",
    );
    expect(
      linhaDeData({ ...BASE, card: null, account: { id: "a1", label: "Banco Teste" } }, "2026-11-10"),
    ).toBe("Hoje, 10/11 às 14:32 · Banco Teste");
  });

  it("a hora é a de São Paulo (UTC−3)", () => {
    expect(horaSaoPaulo("2026-10-04T17:32:00Z")).toBe("14:32");
    expect(horaSaoPaulo("2026-10-04T02:05:00Z")).toBe("23:05");
    expect(horaSaoPaulo("2026-10-04")).toBeNull();
  });

  // F3: só a meia-noite UTC é data de calendário (sem horário). 03:00Z é meia-noite em São Paulo: um horário de verdade.
  it("F3: T00:00:00.000Z é só a data (sem hora); 03:00Z é meia-noite de São Paulo e sai 00:00", () => {
    expect(horaSaoPaulo("2026-11-05T00:00:00.000Z")).toBeNull();
    expect(horaSaoPaulo("2026-11-05T00:00:00Z")).toBeNull();
    expect(horaSaoPaulo("2026-11-05T03:00:00.000Z")).toBe("00:00");
    expect(
      linhaDeData({ ...BASE, localDate: "2026-11-05", occurredAt: "2026-11-05T00:00:00.000Z" }, "2026-11-05"),
    ).toBe("Hoje, 05/11 · Nubank final 4417");
    expect(
      linhaDeData({ ...BASE, localDate: "2026-11-05", occurredAt: "2026-11-05T03:00:00.000Z" }, "2026-11-05"),
    ).toBe("Hoje, 05/11 às 00:00 · Nubank final 4417");
  });
});

describe("textoDaCategoria", () => {
  it("com categoria: subcategoria com a mãe, e o texto de quem categorizou", () => {
    const categoria = { id: "c", name: "Academia", parentName: "Saúde" };
    expect(textoDaCategoria(com({ category: categoria, categorizedBy: "pessoa" }))).toEqual({
      nome: "Saúde › Academia",
      sub: "Toque para trocar",
      semCategoria: false,
    });
    expect(textoDaCategoria(com({ category: categoria, categorizedBy: "regra" })).sub).toBe(
      "Automática: vocês já confirmaram antes. Toque para trocar",
    );
    expect(textoDaCategoria(com({ category: categoria, categorizedBy: "ia" })).sub).toBe(
      "Sugerida pela IA no histórico, sem conferência. Toque para trocar",
    );
  });

  it("sem categoria: revisar, com a sugestão e o grau de certeza, ou toque para escolher", () => {
    const comSugestao = com({
      aiSuggestion: { categoryId: "k9", name: "Serviços", confidence: "pouca" },
    });
    expect(textoDaCategoria(comSugestao)).toEqual({
      nome: "Sem categoria · revisar",
      sub: "Sugestão da IA: Serviços (pouca certeza)",
      semCategoria: true,
    });
    expect(
      textoDaCategoria(com({ aiSuggestion: { categoryId: "k9", name: "Serviços", confidence: null } })).sub,
    ).toBe("Sugestão da IA: Serviços");
    expect(textoDaCategoria(BASE).sub).toBe("Toque para escolher");
  });
});

describe("tipos, ocultar e título", () => {
  it("cartão oferece cinco tipos; a conta oferece os sete", () => {
    expect(tiposDaCompra(true).map((tipo) => tipo.id)).toEqual([
      "fixos",
      "conforto",
      "educacao",
      "extras",
      "prazeres",
    ]);
    expect(tiposDaCompra(false)).toHaveLength(7);
  });

  // F1: tipo e ocultar só na saída (valor negativo nos movimentos de saída, ou estorno). O "outro" de cashback, com
  // valor positivo, é entrada.
  it("F1: só saída tem tipo e pode ser ocultada; o cashback (outro, +5,00) não", () => {
    const de = (movement: string, amountCents: number) => ({ movement, amountCents });
    expect(podeOcultar(de("compra", -4500))).toBe(true);
    expect(podeOcultar(de("estorno", 3000))).toBe(true);
    expect(podeOcultar(de("outro", -500))).toBe(true);
    expect(podeOcultar(de("outro", 500))).toBe(false);
    expect(podeOcultar(de("pix_recebido", 10000))).toBe(false);
    expect(podeOcultar(de("pagamento_fatura", -10000))).toBe(false);
    expect(temTipoDeGasto(de("outro", 500))).toBe(false);
    expect(temTipoDeGasto(de("rendimento", 1200))).toBe(false);
    expect(temTipoDeGasto(de("boleto", -58000))).toBe(true);
    expect(tituloDaCompra("estorno")).toBe("Estorno");
    expect(tituloDaCompra("debito")).toBe("Débito");
    expect(tituloDaCompra("boleto")).toBe("Boleto");
    expect(tituloDaCompra("compra")).toBe("Compra");
  });
});
