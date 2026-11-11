import { describe, expect, it } from "vitest";
import {
  accountsSummary,
  COR_PADRAO_DO_BANCO,
  institutionFromItem,
} from "../../../../src/worker/pluggy/institution";
import type { PluggyAccount, PluggyItem } from "../../../../src/worker/pluggy/types";

const itemDoMeuPluggy = (): PluggyItem => ({
  id: "00000000-0000-4000-8000-000000000001",
  connector: { id: 200, name: "MeuPluggy", primaryColor: "#6A3DE8", type: "PERSONAL_BANK" },
  status: "UPDATED",
  executionStatus: "SUCCESS",
  error: null,
  lastUpdatedAt: null,
  consentExpiresAt: "2027-10-01T00:00:00.000Z",
});

const conta = (parcial: Partial<PluggyAccount>): PluggyAccount => ({
  id: "c",
  itemId: "00000000-0000-4000-8000-000000000001",
  type: "BANK",
  subtype: "CHECKING_ACCOUNT",
  number: "[TEST] 000001-0",
  name: "[TEST] Conta",
  marketingName: null,
  balance: 0,
  currencyCode: "BRL",
  bankData: null,
  creditData: null,
  ...parcial,
});

describe("institutionFromItem", () => {
  it("usa o nome e a cor do conector quando não é o Meu Pluggy", () => {
    const item = itemDoMeuPluggy();
    item.connector = { id: 999, name: "Outro conector", primaryColor: "EC7000" };
    expect(institutionFromItem(item, [])).toEqual({ name: "Outro conector", color: "#EC7000" });
  });

  it("mantém a cor do conector quando ela já vem com '#'", () => {
    const item = itemDoMeuPluggy();
    item.connector = { id: 999, name: "Outro", primaryColor: "#123456" };
    expect(institutionFromItem(item, []).color).toBe("#123456");
  });

  it("sem cor no conector, usa a de BANKS pelo nome", () => {
    const item = itemDoMeuPluggy();
    item.connector = { id: 999, name: "Bradesco" };
    expect(institutionFromItem(item, [])).toEqual({ name: "Bradesco", color: "#CC092F" });
  });

  it("no Meu Pluggy, acha o banco no nome de marketing da conta", () => {
    const contas = [conta({ name: "[TEST] Conta", marketingName: "[TEST] Itaú Conta Corrente" })];
    expect(institutionFromItem(itemDoMeuPluggy(), contas)).toEqual({ name: "Itaú", color: "#EC7000" });
  });

  it("no Meu Pluggy, acha o banco no nome da conta quando o marketing não diz", () => {
    const contas = [conta({ name: "[TEST] Cartão Nubank Teste", marketingName: null, type: "CREDIT" })];
    expect(institutionFromItem(itemDoMeuPluggy(), contas)).toEqual({ name: "Nubank", color: "#820AD1" });
  });

  it("no Meu Pluggy sem banco nas contas: nome nulo e a cor padrão (a tela pede o nome)", () => {
    const contas = [conta({ name: "[TEST] Conta Teste", marketingName: "[TEST] Conta Teste" })];
    expect(institutionFromItem(itemDoMeuPluggy(), contas)).toEqual({
      name: null,
      color: COR_PADRAO_DO_BANCO,
    });
  });
});

describe("accountsSummary", () => {
  it("junta conta corrente e cartão com 'e'", () => {
    const contas = [
      conta({ subtype: "CHECKING_ACCOUNT" }),
      conta({ type: "CREDIT", subtype: "CREDIT_CARD", number: "************0921" }),
    ];
    expect(accountsSummary(contas)).toBe("Conta corrente e cartão final 0921");
  });

  it("com três partes, vírgula e depois 'e'", () => {
    const contas = [
      conta({ subtype: "CHECKING_ACCOUNT" }),
      conta({ subtype: "SAVINGS_ACCOUNT" }),
      conta({ type: "CREDIT", subtype: "CREDIT_CARD", number: "************0921" }),
    ];
    expect(accountsSummary(contas)).toBe("Conta corrente, poupança e cartão final 0921");
  });

  it("não repete a mesma parte (dois cartões diferentes entram cada um)", () => {
    const contas = [
      conta({ type: "CREDIT", subtype: "CREDIT_CARD", number: "************1111" }),
      conta({ type: "CREDIT", subtype: "CREDIT_CARD", number: "************2222" }),
      conta({ subtype: "CHECKING_ACCOUNT" }),
      conta({ subtype: "CHECKING_ACCOUNT" }),
    ];
    expect(accountsSummary(contas)).toBe("cartão final 1111, cartão final 2222 e Conta corrente");
  });

  it("sem contas, texto vazio; cartão sem dígitos não inventa final", () => {
    expect(accountsSummary([])).toBe("");
    expect(accountsSummary([conta({ type: "CREDIT", number: "xx" })])).toBe("cartão");
  });
});
