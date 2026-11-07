import { type ApiErrorBody, isApiErrorBody } from "../../shared/api";

const MENSAGEM_PADRAO = "Algo deu errado. Tente de novo.";

// Falha da API: status (0 quando não houve resposta), código da convenção e mensagem para a tela.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

// Chamada à API do mesmo site: cookies da mesma origem, JSON. Não mostra detalhe técnico: a mensagem é da convenção.
export async function apiFetch<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const cabecalhos = new Headers(init.headers);
  if (!cabecalhos.has("accept")) cabecalhos.set("accept", "application/json");

  let resposta: Response;
  try {
    resposta = await fetch(caminho, { ...init, credentials: "same-origin", headers: cabecalhos });
  } catch {
    throw new ApiError(0, "sem_conexao", "Sem conexão.");
  }

  if (!resposta.ok) {
    const corpo: unknown = await resposta.json().catch(() => null);
    if (isApiErrorBody(corpo)) {
      const erro: ApiErrorBody = corpo;
      throw new ApiError(resposta.status, erro.error, erro.message ?? MENSAGEM_PADRAO, erro.fields);
    }
    throw new ApiError(resposta.status, "erro_http", MENSAGEM_PADRAO);
  }

  return (await resposta.json()) as T;
}
