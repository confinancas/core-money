import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  type BlocoDeSistema,
  type ClienteDaIA,
  type ItemParaIA,
  requestSuggestions,
} from "../../src/worker/categorization/claude";

// Stub da Anthropic que responde um erro HTTP com "quota" na mensagem. O SDK de verdade lê a resposta (sem rede).
// O erro do provedor vira o código da convenção (indisponível, ou requisição inválida), nunca uma exceção, e nunca o
// código do banco (limite_d1), que é o que o onError do app dá a um erro de cota do D1.
const stubQueResponde = (status: number, tipo: string, mensagem: string): ClienteDaIA => {
  const fetchStub = async (): Promise<Response> =>
    new Response(JSON.stringify({ type: "error", error: { type: tipo, message: mensagem } }), {
      status,
      headers: { "content-type": "application/json" },
    });
  const cliente = new Anthropic({
    apiKey: "sk-ant-api03-TEST-chave-falsa",
    fetch: fetchStub as unknown as typeof fetch,
    maxRetries: 0,
  });
  return cliente as unknown as ClienteDaIA;
};

const sistema: BlocoDeSistema[] = [{ type: "text", text: "instruções" }];
const itens: ItemParaIA[] = [{ ref: "t1", entrada: false, payload: { descricao: "[TEST] Compra" } }];
const codigos = { categorias: new Map<string, string>(), rendas: new Map<string, string>() };

describe("erro de cota do provedor no caminho da categorização", () => {
  it.each([
    [
      "limite de uso (429)",
      429,
      "rate_limit_error",
      "Your organization has exceeded its monthly quota",
      "indisponivel",
    ],
    [
      "sobrecarga (529) com a palavra quota",
      529,
      "overloaded_error",
      "quota service unavailable",
      "indisponivel",
    ],
    [
      "requisição recusada (400) com quota",
      400,
      "invalid_request_error",
      "quota parameter is not supported",
      "requisicao_invalida",
    ],
  ])(
    "%s vira o código da convenção, sem lançar e sem limite do banco",
    async (_nome, status, tipo, mensagem, esperado) => {
      const resultado = await requestSuggestions(
        stubQueResponde(status, tipo, mensagem),
        sistema,
        itens,
        codigos,
      );
      expect(resultado).toMatchObject({ ok: false, erro: esperado, status });
      expect(JSON.stringify(resultado)).not.toContain("limite_d1");
    },
  );
});
