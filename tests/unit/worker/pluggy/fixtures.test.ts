import { describe, expect, it } from "vitest";
import { lerFixture } from "../../../fixtures/pluggy/servidor";

type Registro = Record<string, unknown>;
const comoRegistro = (valor: unknown): Registro => valor as Registro;
const lista = (valor: unknown): Registro[] => (valor as Registro[]).map(comoRegistro);

const CAMPOS_TRANSACAO = [
  "id",
  "accountId",
  "date",
  "description",
  "amount",
  "currencyCode",
  "type",
  "status",
  "category",
  "operationType",
];

describe("fixtures do Pluggy", () => {
  it("cada fixture tem os campos obrigatórios dos tipos", () => {
    expect(comoRegistro(lerFixture("auth.json"))).toHaveProperty("apiKey");

    const item = comoRegistro(lerFixture("item-meupluggy.json"));
    for (const campo of [
      "id",
      "connector",
      "status",
      "executionStatus",
      "error",
      "lastUpdatedAt",
      "consentExpiresAt",
    ]) {
      expect(item).toHaveProperty(campo);
    }
    expect(comoRegistro(item.connector)).toMatchObject({ id: 200, name: "MeuPluggy", type: "PERSONAL_BANK" });

    const contas = lista(comoRegistro(lerFixture("accounts.json")).results);
    for (const conta of contas) {
      for (const campo of ["id", "itemId", "type", "subtype", "name", "balance", "currencyCode"]) {
        expect(conta).toHaveProperty(campo);
      }
    }

    for (const nome of ["transactions-page1.json", "transactions-page2.json", "transactions-500.json"]) {
      for (const transacao of lista(comoRegistro(lerFixture(nome)).results)) {
        for (const campo of CAMPOS_TRANSACAO) expect(transacao).toHaveProperty(campo);
      }
    }

    for (const fatura of lista(comoRegistro(lerFixture("bills.json")).results)) {
      for (const campo of ["id", "dueDate", "billClosingDate", "totalAmount"])
        expect(fatura).toHaveProperty(campo);
    }

    const identidade = comoRegistro(lerFixture("identity.json"));
    expect(identidade).toHaveProperty("document");
    expect(identidade).toHaveProperty("documentType");

    for (const investimento of lista(comoRegistro(lerFixture("investments.json")).results)) {
      for (const campo of ["id", "name", "type", "balance"]) expect(investimento).toHaveProperty(campo);
    }

    const erro = comoRegistro(lerFixture("error-403-list.json"));
    expect(erro).toMatchObject({ code: 403, codeDescription: "LIST_ITEMS_FEATURE_NOT_ENABLED" });
  });

  it("nenhum CPF ou CNPJ de 11 dígitos diferente do fictício 000.000.000-00", () => {
    const arquivos = [
      "auth.json",
      "item-meupluggy.json",
      "accounts.json",
      "transactions-page1.json",
      "transactions-page2.json",
      "transactions-500.json",
      "bills.json",
      "identity.json",
      "investments.json",
      "error-403-list.json",
    ];
    const ocorrencias: string[] = [];
    for (const nome of arquivos) {
      const texto = JSON.stringify(lerFixture(nome));
      ocorrencias.push(...(texto.match(/\d{3}\.\d{3}\.\d{3}-\d{2}/g) ?? []));
      ocorrencias.push(...(texto.match(/(?<!\d)\d{11}(?!\d)/g) ?? []));
    }
    expect(ocorrencias.length).toBeGreaterThan(0);
    for (const ocorrencia of ocorrencias) {
      expect(["000.000.000-00", "00000000000"]).toContain(ocorrencia);
    }
  });

  it("nomes e descrições são [TEST] (o nome público do conector fica de fora)", () => {
    const arquivos = [
      "accounts.json",
      "transactions-page1.json",
      "transactions-page2.json",
      "identity.json",
      "investments.json",
    ];
    for (const nome of arquivos) {
      const doc = comoRegistro(lerFixture(nome));
      const registros = Array.isArray(doc.results) ? lista(doc.results) : [doc];
      for (const registro of registros) {
        for (const chave of ["name", "marketingName", "description", "fullName"]) {
          const valor = registro[chave];
          if (typeof valor === "string") expect(valor).toContain("[TEST]");
        }
      }
    }
  });

  it("accounts: exatamente uma BANK/CHECKING_ACCOUNT, uma BANK/SAVINGS_ACCOUNT e uma CREDIT/CREDIT_CARD", () => {
    const tipos = lista(comoRegistro(lerFixture("accounts.json")).results).map(
      (c) => `${c.type}/${c.subtype}`,
    );
    expect(tipos.sort()).toEqual(
      ["BANK/CHECKING_ACCOUNT", "BANK/SAVINGS_ACCOUNT", "CREDIT/CREDIT_CARD"].sort(),
    );
  });

  it("transações: a página 1 traz next como query string com ?, a página 2 traz next null", () => {
    expect(comoRegistro(lerFixture("transactions-page1.json")).next).toMatch(/^\?/);
    expect(comoRegistro(lerFixture("transactions-page2.json")).next).toBeNull();
  });

  it("transactions-500.json tem 500 movimentos com ids distintos", () => {
    const transacoes = lista(comoRegistro(lerFixture("transactions-500.json")).results);
    expect(transacoes).toHaveLength(500);
    expect(new Set(transacoes.map((t) => t.id)).size).toBe(500);
    expect(comoRegistro(lerFixture("transactions-500.json")).next).toBeNull();
  });
});
