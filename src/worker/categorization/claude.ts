// Chamada ao Claude Haiku para categorizar (TASK-0303). Só o servidor fala com a Anthropic (ADR-003). Sem stream, sem
// temperature, sem thinking: o effort baixo e o adaptativo padrão do modelo. Quem tenta de novo é a fila (maxRetries 0).
import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
} from "@anthropic-ai/sdk";
import {
  type CodigosDoContexto,
  type GravavelDaIA,
  parseSuggestions,
  type RefDaSugestao,
  SUGGESTIONS_SCHEMA,
} from "./output-schema";

export const CATEGORIZATION_MODEL = "claude-haiku-5-5";
const MAX_TOKENS = 8000;
const TEMPO_LIMITE_MS = 30_000;

export type BlocoDeSistema = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };
export type ItemParaIA = { ref: string; entrada: boolean; payload: Record<string, unknown> };

// Só o que a chamada usa do cliente: o teste injeta um falso com esta forma.
export type ClienteDaIA = { messages: { create(params: Record<string, unknown>): Promise<unknown> } };

export type ErroDaIA =
  | "recusa"
  | "max_tokens"
  | "saida_invalida"
  | "requisicao_invalida"
  | "indisponivel"
  | "chave";
export type UsoDaChamada = { cacheRead: number; cacheWrite: number; input: number; output: number };

export type ResultadoDaChamada =
  | { ok: true; porRef: Map<string, GravavelDaIA>; codigoInvalido: number; uso: UsoDaChamada }
  | { ok: false; erro: ErroDaIA; status: number | null; uso: UsoDaChamada | null };

// fetchImpl: só o teste passa um falso (contar as requisições); em produção, o fetch padrão.
export function createClaudeClient(apiKey: string, baseURL?: string, fetchImpl?: typeof fetch): ClienteDaIA {
  const cliente = new Anthropic({
    apiKey,
    baseURL,
    maxRetries: 0,
    timeout: TEMPO_LIMITE_MS,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  return cliente as unknown as ClienteDaIA;
}

// Mensagem do usuário: só dados das transações, dentro de um JSON. As instruções que mandam ignorar pedidos escritos
// nos campos estão no bloco de instruções, nunca aqui.
export function mensagemDoUsuario(itens: readonly ItemParaIA[]): string {
  return JSON.stringify({ transacoes: itens.map((item) => ({ ref: item.ref, ...item.payload })) });
}

// Classe do erro do SDK -> código da convenção. A mais específica primeiro.
export function classificaErro(erro: unknown): { erro: ErroDaIA; status: number | null } {
  if (erro instanceof AuthenticationError || erro instanceof PermissionDeniedError) {
    return { erro: "chave", status: erro.status ?? null };
  }
  if (erro instanceof BadRequestError) return { erro: "requisicao_invalida", status: erro.status ?? null };
  if (erro instanceof APIConnectionError) return { erro: "indisponivel", status: null };
  if (erro instanceof APIError) return { erro: "indisponivel", status: erro.status ?? null };
  return { erro: "indisponivel", status: null };
}

type BlocoDaResposta = { type?: unknown; text?: unknown };
type RespostaDaIA = {
  stop_reason?: unknown;
  content?: unknown;
  usage?: {
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
};

const usoDaResposta = (resposta: RespostaDaIA): UsoDaChamada => ({
  cacheRead: resposta.usage?.cache_read_input_tokens ?? 0,
  cacheWrite: resposta.usage?.cache_creation_input_tokens ?? 0,
  input: resposta.usage?.input_tokens ?? 0,
  output: resposta.usage?.output_tokens ?? 0,
});

// Lê a resposta na ordem da spec: recusa e corte antes de qualquer conteúdo; depois o primeiro bloco do tipo "text"
// (nunca content[0], porque o thinking pode vir antes).
export async function requestSuggestions(
  client: ClienteDaIA,
  system: readonly BlocoDeSistema[],
  itens: readonly ItemParaIA[],
  codigos: CodigosDoContexto,
): Promise<ResultadoDaChamada> {
  const refs: RefDaSugestao[] = itens.map((item) => ({ ref: item.ref, entrada: item.entrada }));
  let resposta: RespostaDaIA;
  try {
    resposta = (await client.messages.create({
      model: CATEGORIZATION_MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: mensagemDoUsuario(itens) }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SUGGESTIONS_SCHEMA } },
    })) as RespostaDaIA;
  } catch (erro) {
    const { erro: tipo, status } = classificaErro(erro);
    return { ok: false, erro: tipo, status, uso: null };
  }

  const uso = usoDaResposta(resposta);
  if (resposta.stop_reason === "refusal") return { ok: false, erro: "recusa", status: null, uso };
  if (resposta.stop_reason === "max_tokens") return { ok: false, erro: "max_tokens", status: null, uso };

  const blocos = Array.isArray(resposta.content) ? (resposta.content as BlocoDaResposta[]) : [];
  const bloco = blocos.find((item) => item.type === "text");
  if (bloco === undefined || typeof bloco.text !== "string") {
    return { ok: false, erro: "saida_invalida", status: null, uso };
  }
  const lido = parseSuggestions(bloco.text, refs, codigos);
  if (!lido.ok) return { ok: false, erro: "saida_invalida", status: null, uso };
  return { ok: true, porRef: lido.porRef, codigoInvalido: lido.codigoInvalido, uso };
}
