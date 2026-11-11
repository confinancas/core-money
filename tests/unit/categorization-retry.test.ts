import { describe, expect, it } from "vitest";
import {
  type BlocoDeSistema,
  createClaudeClient,
  type ItemParaIA,
  requestSuggestions,
} from "../../src/worker/categorization/claude";

// Contagem de requisições (K6): o cliente da fatia não repete nada sozinho; quem tenta de novo é a fila. Um 429 e um 500
// chegam ao fetch uma única vez. Stub do fetch, sem rede.
const sistema: BlocoDeSistema[] = [{ type: "text", text: "instruções" }];
const itens: ItemParaIA[] = [{ ref: "t1", entrada: false, payload: { descricao: "[TEST] Compra" } }];
const codigos = { categorias: new Map<string, string>(), rendas: new Map<string, string>() };

const contandoFetch = (status: number) => {
  let requisicoes = 0;
  const fetchStub = async (): Promise<Response> => {
    requisicoes++;
    return new Response(
      JSON.stringify({ type: "error", error: { type: "api_error", message: "indisponível" } }),
      {
        status,
        headers: { "content-type": "application/json" },
      },
    );
  };
  return { fetchStub: fetchStub as unknown as typeof fetch, contagem: () => requisicoes };
};

describe("createClaudeClient: sem tentativa automática do SDK", () => {
  it.each([429, 500, 529])("um erro %i chega ao fetch uma vez só", async (status) => {
    const { fetchStub, contagem } = contandoFetch(status);
    const cliente = createClaudeClient("sk-ant-api03-TEST-chave-falsa", undefined, fetchStub);
    const resultado = await requestSuggestions(cliente, sistema, itens, codigos);
    expect(resultado.ok).toBe(false);
    expect(contagem()).toBe(1);
  });
});
