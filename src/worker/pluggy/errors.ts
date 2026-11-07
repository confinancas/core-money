// Erros do cliente do Pluggy. A mensagem é só "pluggy <MÉTODO> <rota-molde> <status> <code>":
// nunca leva query, id, secret, apiKey nem corpo de resposta. O `cause` do erro original não é anexado (pode trazer URL).

export type PluggyErrorKind =
  | "auth"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "bad_request"
  | "temporary";

export type PluggyErrorInit = {
  kind: PluggyErrorKind;
  status: number;
  code: string;
  metodo: string;
  // Rota-molde, sem query e sem ids (ex.: /items/:id).
  rota: string;
  retryAfterSec?: number | undefined;
};

export class PluggyError extends Error {
  readonly kind: PluggyErrorKind;
  readonly status: number;
  readonly code: string;
  readonly retryAfterSec: number | undefined;

  constructor(init: PluggyErrorInit) {
    super(`pluggy ${init.metodo} ${init.rota} ${init.status} ${init.code}`);
    this.name = "PluggyError";
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.retryAfterSec = init.retryAfterSec;
  }
}

// codeDescription do corpo de erro, quando vier como texto não vazio. O campo `message` do Pluggy é instável e não entra.
export function codigoDoCorpo(corpo: unknown): string | null {
  if (typeof corpo !== "object" || corpo === null) return null;
  const codigo = (corpo as { codeDescription?: unknown }).codeDescription;
  return typeof codigo === "string" && codigo.trim() !== "" ? codigo : null;
}

// Retry-After em segundos inteiros. Ausente, em formato de data ou inválido vira undefined (nunca NaN).
export function parseRetryAfter(valor: string | null): number | undefined {
  if (valor === null) return undefined;
  const texto = valor.trim();
  if (!/^\d+$/.test(texto)) return undefined;
  const segundos = Number(texto);
  return Number.isSafeInteger(segundos) ? segundos : undefined;
}

export type RespostaFalha = {
  status: number;
  corpo: unknown;
  metodo: string;
  rota: string;
  retryAfter?: string | null;
};

// Tabela de kind: 401 auth; 403 forbidden; 404 not_found; 429 rate_limited; 400/409/422 e os demais 4xx bad_request;
// 408, 5xx e o resto temporary.
export function classifyPluggyResponse(resposta: RespostaFalha): PluggyError {
  const base = {
    status: resposta.status,
    code: codigoDoCorpo(resposta.corpo) ?? "SEM_CODIGO",
    metodo: resposta.metodo,
    rota: resposta.rota,
  };
  const status = resposta.status;
  if (status === 401) return new PluggyError({ ...base, kind: "auth" });
  if (status === 403) return new PluggyError({ ...base, kind: "forbidden" });
  if (status === 404) return new PluggyError({ ...base, kind: "not_found" });
  if (status === 429) {
    return new PluggyError({
      ...base,
      kind: "rate_limited",
      retryAfterSec: parseRetryAfter(resposta.retryAfter ?? null),
    });
  }
  if (status === 408) return new PluggyError({ ...base, kind: "temporary" });
  if (status >= 400 && status < 500) return new PluggyError({ ...base, kind: "bad_request" });
  return new PluggyError({ ...base, kind: "temporary" });
}
