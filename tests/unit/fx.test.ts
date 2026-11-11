import { describe, expect, it } from "vitest";
import { buildPtaxUrl, escolheCotacao, parsePtaxResponse } from "../../src/worker/income/fx-puro";

// Cotação de referência (TASK-0902): a URL, a leitura da resposta e a escolha do dia. A resposta de exemplo tem a forma
// da API Olinda como a spec a documenta (cinco dias úteis de 26 a 30/10/2026). Nenhum teste fala com o Banco Central.

const RESPOSTA_DA_SEMANA = {
  "@odata.context": "[TEST] forma da resposta, sem dado real",
  value: [
    { cotacaoCompra: 5.4206, cotacaoVenda: 5.4212, dataHoraCotacao: "2026-10-30 13:04:18.706" },
    { cotacaoCompra: 5.42, cotacaoVenda: 5.4215, dataHoraCotacao: "2026-10-29 13:04:18.100" },
    { cotacaoCompra: 5.41, cotacaoVenda: 5.4102, dataHoraCotacao: "2026-10-28 13:03:01.000" },
    { cotacaoCompra: 5.4, cotacaoVenda: 5.4001, dataHoraCotacao: "2026-10-27 13:02:44.000" },
    { cotacaoCompra: 5.39, cotacaoVenda: 5.3999, dataHoraCotacao: "2026-10-26 13:01:10.000" },
  ],
};

describe("buildPtaxUrl", () => {
  it("manda as datas como MM-DD-AAAA entre aspas simples", () => {
    const url = buildPtaxUrl("2026-09-28", "2026-10-05");
    expect(url).toContain("@dataInicial='09-28-2026'");
    expect(url).toContain("@dataFinalCotacao='10-05-2026'");
    expect(url).toContain("$format=json");
  });
});

describe("parsePtaxResponse", () => {
  it("lê uma cotação por dia, em rateE4 (venda × 10.000) e a data do começo de dataHoraCotacao", () => {
    expect(parsePtaxResponse(RESPOSTA_DA_SEMANA)).toEqual([
      { date: "2026-10-30", rateE4: 54212 },
      { date: "2026-10-29", rateE4: 54215 },
      { date: "2026-10-28", rateE4: 54102 },
      { date: "2026-10-27", rateE4: 54001 },
      { date: "2026-10-26", rateE4: 53999 },
    ]);
  });

  it("value vazio (fim de semana) é válido e não tem cotação", () => {
    expect(parsePtaxResponse({ value: [] })).toEqual([]);
  });

  it("recusa o que não tem a forma: nada é gravado", () => {
    expect(parsePtaxResponse(null)).toBeNull();
    // Positiva, mas que arredonda para zero em rateE4 (× 10.000): também não é cotação.
    expect(
      parsePtaxResponse({ value: [{ cotacaoVenda: 0.00004, dataHoraCotacao: "2026-10-30 13:00:00" }] }),
    ).toBeNull();
    expect(parsePtaxResponse("texto")).toBeNull();
    expect(parsePtaxResponse({})).toBeNull();
    expect(parsePtaxResponse({ value: "x" })).toBeNull();
    expect(
      parsePtaxResponse({ value: [{ cotacaoVenda: 0, dataHoraCotacao: "2026-10-30 13:00:00" }] }),
    ).toBeNull();
    expect(
      parsePtaxResponse({ value: [{ cotacaoVenda: -1, dataHoraCotacao: "2026-10-30 13:00:00" }] }),
    ).toBeNull();
    expect(parsePtaxResponse({ value: [{ cotacaoVenda: 5.4, dataHoraCotacao: null }] })).toBeNull();
    expect(parsePtaxResponse({ value: [{ cotacaoVenda: 5.4, dataHoraCotacao: "ontem" }] })).toBeNull();
  });
});

describe("escolheCotacao (a data)", () => {
  const cotacoes = new Map<string, number>([
    ["2026-10-30", 54212],
    ["2026-10-29", 54215],
    ["2026-10-05", 55000],
  ]);

  it("o próprio dia de referência, quando tem cotação", () => {
    expect(escolheCotacao("2026-10-05", "2026-11-10", cotacoes, false)).toEqual({
      date: "2026-10-05",
      rateE4: 55000,
    });
  });

  it("sem a cotação do dia, antes de buscar, não escolhe nada (a busca vem primeiro)", () => {
    expect(escolheCotacao("2026-11-01", "2026-11-10", cotacoes, false)).toBeNull();
  });

  it("cenário 3: domingo 01/11 usa a última cotação até o domingo, a de sexta 30/10", () => {
    expect(escolheCotacao("2026-11-01", "2026-11-10", cotacoes, true)).toEqual({
      date: "2026-10-30",
      rateE4: 54212,
    });
  });

  it("cenário 4: a cotação de hoje ainda não saiu, então não há escolha", () => {
    expect(escolheCotacao("2026-11-10", "2026-11-10", new Map([["2026-11-09", 54000]]), true)).toBeNull();
  });

  it("cotação mais antiga que os 7 dias não serve", () => {
    expect(escolheCotacao("2026-11-01", "2026-11-10", new Map([["2026-10-20", 54000]]), true)).toBeNull();
  });
});
