// Meu Pluggy falso para os testes de integração (TASK-0203): responde pelo fetch injetado no createApp, sem rede.
// Os dados são [TEST] e seguem a forma das fixtures da TASK-0201. Não há credencial real em nenhum lugar daqui.
import { createApp } from "../../../src/worker/app";

export const CLIENT_ID_VALIDO = "11111111-1111-4111-8111-111111111111";
export const SEGREDO_VALIDO = "TEST-segredo-valido-0203";
// Segundo par válido: as chaves trocadas (TASK-0203, troca de chaves).
export const CLIENT_ID_NOVO = "22222222-2222-4222-8222-222222222222";
export const SEGREDO_NOVO = "TEST-segredo-novo-0203";
export const APIKEY_DE_TESTE = "[TEST] apikey-pluggy-falsa-0203";

// Itens conhecidos pelo falso. ITEM_A: Itaú (contas com o banco no nome de marketing); ITEM_B: cartão Nubank;
// ITEM_SEM_BANCO: as contas não dizem o banco. Qualquer outro id responde 404.
export const ITEM_A = "00000000-0000-4000-8000-0000000000a1";
export const ITEM_B = "00000000-0000-4000-8000-0000000000b2";
export const ITEM_C = "00000000-0000-4000-8000-0000000000c3";
export const ITEM_D = "00000000-0000-4000-8000-0000000000d4";
export const ITEM_SEM_BANCO = "00000000-0000-4000-8000-0000000000e5";
export const ITEM_INEXISTENTE = "00000000-0000-4000-8000-0000000000f6";

export type Chamada = { metodo: string; caminho: string; query: string };

type Opcoes = {
  // Status do /auth (503 simula o Pluggy fora).
  statusDoAuth?: number;
  // Quando true, /identity responde 404 (sem identidade).
  semIdentidade?: boolean;
};

const item = (id: string, cor: string) => ({
  id,
  connector: { id: 200, name: "MeuPluggy", primaryColor: cor, type: "PERSONAL_BANK", isSandbox: false },
  status: "UPDATED",
  executionStatus: "SUCCESS",
  error: null,
  lastUpdatedAt: "2026-11-06T03:00:00.000Z",
  consentExpiresAt: "2027-10-01T00:00:00.000Z",
  products: ["ACCOUNTS", "CREDIT_CARDS", "TRANSACTIONS", "IDENTITY"],
});

const CONTAS: Record<string, unknown[]> = {
  [ITEM_A]: [
    {
      id: "00000000-0000-4000-8000-000000000011",
      itemId: ITEM_A,
      type: "BANK",
      subtype: "CHECKING_ACCOUNT",
      number: "[TEST] 000001-0",
      name: "[TEST] Conta Corrente Teste",
      marketingName: "[TEST] Itaú Conta Corrente",
      balance: 1234.56,
      currencyCode: "BRL",
      bankData: { overdraftUsedLimit: 0, closingBalance: 1234.56 },
      creditData: null,
    },
    {
      id: "00000000-0000-4000-8000-000000000013",
      itemId: ITEM_A,
      type: "CREDIT",
      subtype: "CREDIT_CARD",
      number: "************0921",
      name: "[TEST] Cartão Teste",
      marketingName: "[TEST] Cartão Itaú Teste",
      balance: 1845.37,
      currencyCode: "BRL",
      bankData: null,
      creditData: { balanceCloseDate: "2026-11-03T00:00:00.000Z", creditLimit: 5000 },
    },
  ],
  [ITEM_B]: [
    {
      id: "00000000-0000-4000-8000-0000000000b1",
      itemId: ITEM_B,
      type: "CREDIT",
      subtype: "CREDIT_CARD",
      number: "************5678",
      name: "[TEST] Cartão Teste",
      marketingName: "[TEST] Cartão Nubank Teste",
      balance: 310.4,
      currencyCode: "BRL",
      bankData: null,
      creditData: { balanceCloseDate: "2026-11-03T00:00:00.000Z", creditLimit: 3000 },
    },
  ],
  [ITEM_C]: [
    {
      id: "00000000-0000-4000-8000-0000000000c1",
      itemId: ITEM_C,
      type: "BANK",
      subtype: "SAVINGS_ACCOUNT",
      number: "[TEST] 000003-0",
      name: "[TEST] Poupança Teste",
      marketingName: null,
      balance: 50,
      currencyCode: "BRL",
      bankData: null,
      creditData: null,
    },
  ],
  [ITEM_D]: [],
  [ITEM_SEM_BANCO]: [
    {
      id: "00000000-0000-4000-8000-0000000000e1",
      itemId: ITEM_SEM_BANCO,
      type: "BANK",
      subtype: "CHECKING_ACCOUNT",
      number: "[TEST] 000009-0",
      name: "[TEST] Conta Teste",
      marketingName: "[TEST] Conta Teste",
      balance: 10,
      currencyCode: "BRL",
      bankData: null,
      creditData: null,
    },
  ],
};

const ITENS: Record<string, ReturnType<typeof item>> = {
  [ITEM_A]: item(ITEM_A, "#6A3DE8"),
  [ITEM_B]: item(ITEM_B, "#6A3DE8"),
  [ITEM_C]: item(ITEM_C, "#6A3DE8"),
  [ITEM_D]: item(ITEM_D, "#6A3DE8"),
  [ITEM_SEM_BANCO]: item(ITEM_SEM_BANCO, "#6A3DE8"),
};

const json = (status: number, corpo: unknown): Response =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

export type PluggyFalso = {
  fetch: typeof fetch;
  chamadas: Chamada[];
};

// Cada chamada entra em `chamadas` (método, caminho e query), sem corpo nem cabeçalho.
export function pluggyFalso(opcoes: Opcoes = {}): PluggyFalso {
  const chamadas: Chamada[] = [];
  const falso = async (entrada: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(entrada));
    const metodo = init?.method ?? "GET";
    chamadas.push({ metodo, caminho: url.pathname, query: url.search });

    if (metodo === "POST" && url.pathname === "/auth") {
      if (opcoes.statusDoAuth !== undefined) {
        return json(opcoes.statusDoAuth, { code: opcoes.statusDoAuth, codeDescription: "TEST_INDISPONIVEL" });
      }
      const corpo = JSON.parse(String(init?.body ?? "{}")) as { clientId?: string; clientSecret?: string };
      const aceitas =
        (corpo.clientId === CLIENT_ID_VALIDO && corpo.clientSecret === SEGREDO_VALIDO) ||
        (corpo.clientId === CLIENT_ID_NOVO && corpo.clientSecret === SEGREDO_NOVO);
      if (aceitas) return json(200, { apiKey: APIKEY_DE_TESTE });
      return json(401, {
        code: 401,
        codeDescription: "CLIENT_KEYS_UNAUTHORIZED",
        message: "[TEST] recusado",
      });
    }

    const cabecalhos = new Headers(init?.headers);
    if (cabecalhos.get("x-api-key") !== APIKEY_DE_TESTE) {
      return json(401, { code: 401, codeDescription: "CLIENT_KEYS_UNAUTHORIZED" });
    }

    if (metodo === "GET" && url.pathname.startsWith("/items/")) {
      const id = url.pathname.slice("/items/".length);
      const itemLido = ITENS[id];
      if (itemLido === undefined) return json(404, { code: 404, codeDescription: "ITEM_NOT_FOUND" });
      return json(200, itemLido);
    }
    if (metodo === "GET" && url.pathname === "/accounts") {
      const itemId = url.searchParams.get("itemId") ?? "";
      if (ITENS[itemId] === undefined) return json(404, { code: 404, codeDescription: "ITEM_NOT_FOUND" });
      const contas = CONTAS[itemId] ?? [];
      return json(200, { page: 1, total: contas.length, totalPages: 1, results: contas });
    }
    if (metodo === "GET" && url.pathname === "/identity") {
      if (opcoes.semIdentidade) return json(404, { code: 404, codeDescription: "IDENTITY_NOT_FOUND" });
      return json(200, {
        id: "00000000-0000-4000-8000-000000000031",
        document: "000.000.000-00",
        documentType: "CPF",
      });
    }
    return json(404, { code: 404, codeDescription: "ROUTE_NOT_FOUND" });
  };
  return { fetch: falso as unknown as typeof fetch, chamadas };
}

// App com o Meu Pluggy falso injetado (createApp aceita pluggyFetch; em produção vale o fetch do Worker).
export function appComPluggy(falso: PluggyFalso) {
  return createApp({ pluggyFetch: falso.fetch });
}
