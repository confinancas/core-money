import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  type BlocoDeSistema,
  type ClienteDaIA,
  classificaErro,
  type ItemParaIA,
  requestSuggestions,
} from "../../src/worker/categorization/claude";

// Cliente falso: devolve a resposta (ou lança o erro) que o teste manda. Nunca fala com a Anthropic.
const clienteQueResponde = (resposta: unknown): ClienteDaIA => ({
  messages: { create: async () => resposta },
});

const codigos = { categorias: new Map([["c1", "cat-1"]]), rendas: new Map<string, string>() };
const itens: ItemParaIA[] = [{ ref: "t1", entrada: false, payload: { descricao: "[TEST] Mercado" } }];
const sistema: BlocoDeSistema[] = [
  { type: "text", text: "instruções" },
  { type: "text", text: "contexto", cache_control: { type: "ephemeral" } },
];

const sugestaoT1 = JSON.stringify({
  sugestoes: [
    {
      ref: "t1",
      categoria: "c1",
      entrada: null,
      renda: null,
      subtipo: null,
      certeza: "alta",
      motivo: "mercado",
    },
  ],
});

describe("requestSuggestions: leitura da resposta", () => {
  it("lê o texto depois de um bloco de pensamento (cenário 4)", async () => {
    const cliente = clienteQueResponde({
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "raciocínio" },
        { type: "text", text: sugestaoT1 },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 0,
      },
    });
    const r = await requestSuggestions(cliente, sistema, itens, codigos);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.porRef.get("t1")?.aiCategoryId).toBe("cat-1");
    expect(r.uso).toEqual({ cacheRead: 3, cacheWrite: 0, input: 10, output: 5 });
  });

  it("recusa antes de ler o conteúdo (cenário 6)", async () => {
    const cliente = clienteQueResponde({
      stop_reason: "refusal",
      content: [{ type: "text", text: sugestaoT1 }],
    });
    const r = await requestSuggestions(cliente, sistema, itens, codigos);
    expect(r).toMatchObject({ ok: false, erro: "recusa" });
  });

  it("corte por max_tokens se comporta como recusa, com o próprio código (cenário 7)", async () => {
    const cliente = clienteQueResponde({ stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] });
    const r = await requestSuggestions(cliente, sistema, itens, codigos);
    expect(r).toMatchObject({ ok: false, erro: "max_tokens" });
  });

  it("sem bloco de texto, ou com JSON quebrado, é saida_invalida", async () => {
    const semTexto = await requestSuggestions(
      clienteQueResponde({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "x" }] }),
      sistema,
      itens,
      codigos,
    );
    const quebrado = await requestSuggestions(
      clienteQueResponde({ stop_reason: "end_turn", content: [{ type: "text", text: "{ruim" }] }),
      sistema,
      itens,
      codigos,
    );
    expect(semTexto).toMatchObject({ ok: false, erro: "saida_invalida" });
    expect(quebrado).toMatchObject({ ok: false, erro: "saida_invalida" });
  });
});

describe("classificaErro: cada classe do SDK vai para o código certo", () => {
  it("chave: autenticação e permissão", () => {
    expect(classificaErro(new AuthenticationError(401, undefined, "x", new Headers()))).toEqual({
      erro: "chave",
      status: 401,
    });
    expect(classificaErro(new PermissionDeniedError(403, undefined, "x", new Headers()))).toEqual({
      erro: "chave",
      status: 403,
    });
  });

  it("requisição inválida: 400", () => {
    expect(classificaErro(new BadRequestError(400, undefined, "x", new Headers()))).toEqual({
      erro: "requisicao_invalida",
      status: 400,
    });
  });

  it("indisponível: limite, erro do servidor, 529, rede e outros", () => {
    expect(classificaErro(new RateLimitError(429, undefined, "x", new Headers())).erro).toBe("indisponivel");
    expect(classificaErro(new InternalServerError(500, undefined, "x", new Headers())).erro).toBe(
      "indisponivel",
    );
    expect(classificaErro(new APIError(529, undefined, "x", new Headers())).erro).toBe("indisponivel");
    expect(classificaErro(new APIConnectionError({ message: "rede" })).erro).toBe("indisponivel");
    expect(classificaErro(new Error("outro"))).toEqual({ erro: "indisponivel", status: null });
  });

  it("a falha da chamada chega como erro tipado, sem lançar", async () => {
    const cliente = {
      messages: {
        create: async () => {
          throw new AuthenticationError(401, undefined, "x", new Headers());
        },
      },
    };
    const r = await requestSuggestions(cliente, sistema, itens, codigos);
    expect(r).toEqual({ ok: false, erro: "chave", status: 401, uso: null });
  });
});

describe("requestSuggestions: formato da requisição com o SDK de verdade", () => {
  it("modelo, schema, effort e cache conferidos; sem stream, temperature nem thinking (cenário de formato)", async () => {
    const enviados: Array<{ url: string; corpo: Record<string, unknown> }> = [];
    const fetchFalso = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      enviados.push({ url: String(url), corpo: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(
        JSON.stringify({
          id: "msg_teste",
          type: "message",
          role: "assistant",
          model: "claude-haiku-5-5",
          content: [{ type: "text", text: sugestaoT1 }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const cliente = new Anthropic({
      apiKey: "sk-ant-api03-TEST-chave-falsa",
      fetch: fetchFalso as unknown as typeof fetch,
      maxRetries: 0,
    });
    const r = await requestSuggestions(cliente as unknown as ClienteDaIA, sistema, itens, codigos);
    expect(r.ok).toBe(true);
    expect(enviados).toHaveLength(1);
    const corpo = enviados[0]?.corpo ?? {};
    expect(corpo.model).toBe("claude-haiku-5-5");
    expect(corpo.max_tokens).toBe(8000);
    expect((corpo.output_config as { effort: string }).effort).toBe("low");
    expect((corpo.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    expect(
      (corpo.output_config as { format: { schema: { required: string[] } } }).format.schema.required,
    ).toEqual(["sugestoes"]);
    expect(corpo).not.toHaveProperty("stream");
    expect(corpo).not.toHaveProperty("temperature");
    expect(corpo).not.toHaveProperty("top_p");
    expect(corpo).not.toHaveProperty("top_k");
    expect(corpo).not.toHaveProperty("thinking");
    const blocos = corpo.system as Array<{ text: string; cache_control?: unknown }>;
    expect(blocos[0]?.cache_control).toBeUndefined();
    expect(blocos[1]?.cache_control).toEqual({ type: "ephemeral" });
  });
});
