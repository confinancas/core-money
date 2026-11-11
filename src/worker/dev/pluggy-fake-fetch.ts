// Meu Pluggy falso para a medição de CPU (TASK-0204): responde pelo fetch injetado, em memória, sem rede. Os dados são
// [TEST] e seguem a forma das fixtures da TASK-0201. Não há credencial real aqui: a apiKey é fictícia.

const JSON_HEADERS = { "content-type": "application/json" };

const resposta = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), { status, headers: JSON_HEADERS });

// Transações de uma janela: `linhas` movimentos no dia final da janela, com ids estáveis dentro da janela.
function transacoesDaJanela(conta: string, dataFinal: string, linhas: number) {
  return Array.from({ length: linhas }, (_, i) => ({
    id: `${conta}-${dataFinal}-${i}`,
    accountId: conta,
    date: `${dataFinal}T15:00:00.000Z`,
    description: `[TEST] COMPRA ${i} MERCADO`,
    descriptionRaw: `[TEST] COMPRA ${i} MERCADO`,
    amount: -(10 + (i % 90)) - (i % 100) / 100,
    type: "DEBIT",
    category: "Groceries",
    operationType: "CARTAO",
    paymentData: null,
    creditCardMetadata: null,
    status: "POSTED",
  }));
}

// Responde às rotas que a importação usa: item, contas, investimentos, faturas e transações.
export function pluggyFalsoEmMemoria(linhasPorJanela: number): typeof fetch {
  return async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url,
    );
    const metodo = (init?.method ?? "GET").toUpperCase();
    const caminho = url.pathname;
    const params = url.searchParams;

    if (metodo === "POST" && caminho === "/auth") return resposta({ apiKey: "[TEST] apikey-medicao" });
    if (metodo !== "GET") return resposta({ code: "NAO_PERMITIDO" }, 405);

    if (caminho.startsWith("/items/")) {
      const itemId = decodeURIComponent(caminho.slice("/items/".length));
      return resposta({
        id: itemId,
        connector: {
          id: 200,
          name: "MeuPluggy",
          primaryColor: "#0E9A63",
          type: "PERSONAL_BANK",
          isSandbox: false,
        },
        status: "UPDATED",
        executionStatus: "SUCCESS",
        error: null,
        lastUpdatedAt: "2026-11-06T03:00:00.000Z",
        consentExpiresAt: "2027-10-01T00:00:00.000Z",
      });
    }

    if (caminho === "/accounts") {
      const itemId = params.get("itemId") ?? "item";
      return resposta({
        page: 1,
        total: 2,
        totalPages: 1,
        results: [
          {
            id: `${itemId}-corrente`,
            itemId,
            type: "BANK",
            subtype: "CHECKING_ACCOUNT",
            number: "[TEST] 000001-0",
            name: "[TEST] Conta Corrente",
            marketingName: "[TEST] Conta Corrente",
            balance: 1234.56,
            currencyCode: "BRL",
            bankData: { overdraftUsedLimit: 0 },
            creditData: null,
          },
          {
            id: `${itemId}-cartao`,
            itemId,
            type: "CREDIT",
            subtype: "CREDIT_CARD",
            number: "[TEST] **** **** **** 4321",
            name: "[TEST] Cartão",
            marketingName: "[TEST] Cartão",
            balance: 350.0,
            currencyCode: "BRL",
            bankData: null,
            creditData: {
              balanceCloseDate: "2026-11-03",
              balanceDueDate: "2026-11-10",
              creditLimit: 5000,
              availableCreditLimit: 4650,
              brand: "VISA",
            },
          },
        ],
      });
    }

    if (caminho === "/investments") return resposta({ page: 1, total: 0, totalPages: 1, results: [] });

    if (caminho === "/bills") {
      return resposta({
        page: 1,
        total: 1,
        totalPages: 1,
        results: [
          {
            id: `${params.get("accountId") ?? "cartao"}-fatura-anterior`,
            dueDate: "2026-10-10",
            billClosingDate: "2026-10-03",
            totalAmount: 480.0,
            payments: [{ amount: 480.0, paymentDate: "2026-10-09" }],
          },
        ],
      });
    }

    if (caminho === "/v2/transactions") {
      const conta = params.get("accountId") ?? "conta";
      const dataFinal = params.get("dateTo") ?? "2026-11-11";
      return resposta({ results: transacoesDaJanela(conta, dataFinal, linhasPorJanela), next: null });
    }

    return resposta({ code: "ROTA_INEXISTENTE" }, 404);
  };
}
