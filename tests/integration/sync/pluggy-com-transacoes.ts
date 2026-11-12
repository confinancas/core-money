import { pluggyFalsoEmMemoria } from "../../../src/worker/dev/pluggy-fake-fetch";
import { urlDe } from "./importacao-helpers";

// Pluggy falso com as transações que o teste escolhe por conta. Só /v2/transactions é trocada; o resto vem do falso em
// memória. Dados [TEST]; sem rede. Auxiliar dos testes da sincronização (não é um arquivo de testes).

export type TransacaoDeTeste = { id: string; conta: string; data: string; valor: number };

export function pluggyFalsoComTransacoes(
  porConta: (conta: string) => TransacaoDeTeste[],
  operacao = "CARTAO",
): typeof fetch {
  const base = pluggyFalsoEmMemoria(0);
  return async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlDe(entrada);
    if (url.pathname !== "/v2/transactions") return base(entrada, init);
    const de = url.searchParams.get("dateFrom") ?? "";
    const ate = url.searchParams.get("dateTo") ?? "";
    const results = porConta(url.searchParams.get("accountId") ?? "")
      .filter((tx) => tx.data >= de && tx.data <= ate)
      .map((tx) => ({
        id: tx.id,
        accountId: tx.conta,
        date: `${tx.data}T15:00:00.000Z`,
        description: `[TEST] ${tx.id}`,
        descriptionRaw: `[TEST] ${tx.id}`,
        amount: tx.valor,
        type: tx.valor < 0 ? "DEBIT" : "CREDIT",
        category: "Groceries",
        operationType: operacao,
        paymentData: null,
        creditCardMetadata: null,
        status: "POSTED",
      }));
    return new Response(JSON.stringify({ results, next: null }), {
      headers: { "content-type": "application/json" },
    });
  };
}
