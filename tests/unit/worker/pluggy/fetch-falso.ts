// fetch simulado para os testes do cliente do Pluggy: registra cada chamada (URL, método, headers, corpo, signal).

export type Chamada = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal | undefined;
};

export function respostaJson(
  status: number,
  corpo: unknown,
  cabecalhos: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json", ...cabecalhos },
  });
}

export function fetchFalso(responder: (chamada: Chamada) => Response | Promise<Response>): {
  fetch: typeof fetch;
  chamadas: Chamada[];
} {
  const chamadas: Chamada[] = [];
  const falso = async (entrada: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const corpoTexto = typeof init?.body === "string" ? init.body : undefined;
    const chamada: Chamada = {
      url: String(entrada),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: corpoTexto === undefined ? undefined : (JSON.parse(corpoTexto) as unknown),
      signal: init?.signal ?? undefined,
    };
    chamadas.push(chamada);
    return responder(chamada);
  };
  return { fetch: falso as unknown as typeof fetch, chamadas };
}
