import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type ResultadoSonda, rodarSonda } from "../../../../scripts/dev/pluggy-sonda";
import {
  ITEM_ID,
  iniciarServidorFixtures,
  lerFixture,
  type ServidorFixtures,
  valoresSensiveis,
} from "../../../fixtures/pluggy/servidor";

const CLIENT_ID = "[TEST] client-id-sonda";
const CLIENT_SECRET = "[TEST] client-secret-sonda";
const ITEM_INEXISTENTE = "00000000-0000-4000-8000-0000000000ff";
const AGORA = Date.parse("2026-11-07T12:00:00.000Z");

type Registro = Record<string, unknown>;

let servidor: ServidorFixtures;
let resultado: ResultadoSonda;
let saida: Record<string, unknown>;

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  servidor = await iniciarServidorFixtures();
  resultado = await rodarSonda(
    {
      PLUGGY_CLIENT_ID: CLIENT_ID,
      PLUGGY_CLIENT_SECRET: CLIENT_SECRET,
      PLUGGY_ITEM_IDS: `${ITEM_ID}, ${ITEM_INEXISTENTE}`,
      PLUGGY_BASE_URL: servidor.url,
    },
    { now: () => AGORA },
  );
  saida = JSON.parse(resultado.saida) as Record<string, unknown>;
});

afterAll(async () => {
  await servidor.fechar();
  vi.restoreAllMocks();
});

const itens = () => (saida.itens as Registro[]) ?? [];

describe("sonda contra o servidor de fixtures (PLUGGY_BASE_URL)", () => {
  it("roda com código 0 e a saída é um JSON com um item por id", () => {
    expect(resultado.codigo).toBe(0);
    expect(saida.versao).toBe(1);
    expect(itens()).toHaveLength(2);
  });

  it("a saída não tem nenhum valor, descrição, nome, documento ou id das fixtures, nem as credenciais", () => {
    const vazamentos = [...valoresSensiveis(), CLIENT_ID, CLIENT_SECRET, ITEM_INEXISTENTE].filter((valor) =>
      resultado.saida.includes(valor),
    );
    expect(vazamentos).toEqual([]);
  });

  it("id que não existe vira erro not_found, sem o id", () => {
    const erro = itens()[1]?.erro as Registro;
    expect(erro).toEqual({ kind: "not_found", status: 404, code: "ITEM_NOT_FOUND" });
    expect(resultado.saida).not.toContain(ITEM_INEXISTENTE);
  });

  it("item 1: conector MeuPluggy, status, consentimento e meses até vencer", () => {
    const item = itens()[0] as Registro;
    expect(item.erro).toBeNull();
    expect(item.conector).toEqual({
      id: 200,
      type: "PERSONAL_BANK",
      nomeEhMeuPluggy: true,
      bancoNoNome: null,
    });
    expect(item.status).toBe("UPDATED");
    expect(item.executionStatus).toBe("SUCCESS");
    expect(item.consentimento).toEqual({ presente: true, mesesAteVencer: 10 });
  });

  it("item 1: contas por tipo, bancos reconhecidos no nome e presença dos campos", () => {
    const contas = (itens()[0] as Registro).contas as Registro;
    expect(contas.total).toBe(3);
    expect(contas.porTipo).toEqual({
      "BANK/CHECKING_ACCOUNT": 1,
      "BANK/SAVINGS_ACCOUNT": 1,
      "CREDIT/CREDIT_CARD": 1,
    });
    expect(contas.bancoNoNome).toEqual({ Itaú: 1, Nubank: 1 });
    expect(contas.comOverdraftUsedLimit).toBe(1);
    expect(contas.comBalanceCloseDate).toBe(1);
    expect(contas.comBalanceDueDate).toBe(1);
  });

  it("item 1: transações da primeira página de cada conta (3 contas x 6), e não as páginas seguintes", () => {
    const transacoes = (itens()[0] as Registro).transacoes as Registro;
    expect(transacoes.total).toBe(18);
    // Fixture assimétrica: T00 aparece 2 vezes por conta, T03 3 vezes e "outra" 1 vez. Trocar os rótulos muda o resultado.
    expect(transacoes.horaDeDate).toEqual({ "T00:00:00.000Z": 6, "T03:00:00.000Z": 9, outra: 3 });
  });

  it("item 1: sinal de amount por tipo de conta (as quatro contagens DEBIT/CREDIT x sinal)", () => {
    const tipos = (((itens()[0] as Registro).transacoes as Registro).porTipoDeConta ?? {}) as Record<
      string,
      Record<string, Record<string, number>>
    >;
    expect(tipos.BANK?.DEBIT).toEqual({ amountNegativo: 4, amountPositivo: 4 });
    expect(tipos.BANK?.CREDIT).toEqual({ amountPositivo: 4 });
    expect(tipos.CREDIT?.DEBIT).toEqual({ amountNegativo: 2, amountPositivo: 2 });
    expect(tipos.CREDIT?.CREDIT).toEqual({ amountPositivo: 2 });
  });

  it("item 1: PENDING por tipo de conta, com a contagem das datas futuras", () => {
    const pendentes = ((itens()[0] as Registro).transacoes as Registro).pendentes as Record<string, Registro>;
    // Há um PENDING com data futura (cartão) e um PENDING com data passada (conta). Só o futuro conta.
    expect(pendentes.CREDIT).toEqual({ total: 2, comDataFutura: 1 });
    expect(pendentes.BANK).toEqual({ total: 4, comDataFutura: 2 });
  });

  it("item 1: POSTED e PENDING contados por status", () => {
    const status = ((itens()[0] as Registro).transacoes as Registro).status as Record<string, number>;
    expect(status).toEqual({ POSTED: 12, PENDING: 6 });
  });

  it("item 1: presença dos campos do Pluggy (paymentData, billId, billForecastDate, category...)", () => {
    const campos = ((itens()[0] as Registro).transacoes as Registro).campos as Record<string, number>;
    expect(campos.paymentData).toBe(9);
    expect(campos.billId).toBe(0);
    expect(campos.billForecastDate).toBe(3);
    expect(campos.installmentNumber).toBe(3);
    expect(campos.category).toBe(12);
    expect(campos.providerId).toBe(3);
  });

  it("item 1: forma da parcela sem nenhuma letra da descrição", () => {
    const formas = ((itens()[0] as Registro).transacoes as Registro).formaDaParcela as Record<string, number>;
    const chaves = Object.keys(formas);
    expect(chaves.length).toBeGreaterThan(0);
    // A descrição de teste está em maiúsculas ("COMPRA MERCADO"): a forma não pode trazer letra real, só A.
    expect(chaves.every((chave) => !/[a-z]/.test(chave))).toBe(true);
    expect(chaves.every((chave) => !/[B-Z]/.test(chave))).toBe(true);
    expect(chaves.some((chave) => /9/.test(chave))).toBe(true);
    expect(Object.values(formas).reduce((soma, n) => soma + n, 0)).toBe(3);
  });

  it("item 1: faturas, identidade e investimentos em forma e contagem", () => {
    const item = itens()[0] as Registro;
    expect(item.faturas).toEqual({ cartoes: 1, total: 2, comBillClosingDate: 2, erros: [] });
    expect(item.identidade).toEqual({
      disponivel: true,
      erro: null,
      formatoDoDocumento: "formatado",
      tipoDoDocumento: "CPF",
    });
    expect(item.investimentos).toEqual({
      erro: null,
      total: 2,
      porTipo: { "FIXED_INCOME/CDB": 1, "MUTUAL_FUND/(nulo)": 1 },
      comCaixinhaOuCofrinho: 1,
    });
  });
});

describe("sonda com campos nulos", () => {
  const clonar = (valor: unknown): Registro => JSON.parse(JSON.stringify(valor)) as Registro;

  it("date, description e name nulos não derrubam a saída, e nada vaza", async () => {
    const page1 = clonar(lerFixture("transactions-page1.json"));
    const transacoes = page1.results as Registro[];
    transacoes[0].date = null; // primeiro movimento sem data
    transacoes[5].date = null; // PENDING sem data (passa pela contagem de datas futuras)
    transacoes[4].description = null; // parcela sem descrição (entra na forma da parcela)
    transacoes[4].descriptionRaw = null;
    const investimentos = clonar(lerFixture("investments.json"));
    (investimentos.results as Registro[])[0].name = null;
    const contas = clonar(lerFixture("accounts.json"));
    (contas.results as Registro[])[0].name = null;
    const item = clonar(lerFixture("item-meupluggy.json"));
    (item.connector as Registro).name = null;

    const nulo = await iniciarServidorFixtures({
      "transactions-page1.json": page1,
      "investments.json": investimentos,
      "accounts.json": contas,
      "item-meupluggy.json": item,
    });
    try {
      const r = await rodarSonda(
        {
          PLUGGY_CLIENT_ID: CLIENT_ID,
          PLUGGY_CLIENT_SECRET: CLIENT_SECRET,
          PLUGGY_ITEM_IDS: ITEM_ID,
          PLUGGY_BASE_URL: nulo.url,
        },
        { now: () => AGORA },
      );
      expect(r.codigo).toBe(0);
      const saida = JSON.parse(r.saida) as Registro;
      expect(saida.itens as Registro[]).toHaveLength(1);
      const vazamentos = valoresSensiveis().filter((valor) => r.saida.includes(valor));
      expect(vazamentos).toEqual([]);
    } finally {
      await nulo.fechar();
    }
  });
});

describe("sonda sem ambiente", () => {
  it("sem as variáveis, código 1 e saída vazia (nada é lido de arquivo)", async () => {
    const vazio = await rodarSonda({});
    expect(vazio).toEqual({ codigo: 1, saida: "" });
  });

  it("sem PLUGGY_ITEM_IDS, código 1", async () => {
    const semItens = await rodarSonda({ PLUGGY_CLIENT_ID: CLIENT_ID, PLUGGY_CLIENT_SECRET: CLIENT_SECRET });
    expect(semItens.codigo).toBe(1);
  });
});
