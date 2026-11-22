import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, type InitialEntry, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeaturesProvider } from "@/app/features";
import { HideValuesProvider } from "@/components/ui/hide-values";
import { criarRotas } from "@/routes";
import { SessionProvider } from "@/session/SessionProvider";
import { SESSAO_DE_TESTE } from "../helpers/app";
import { instalarMatchMedia } from "../helpers/larguras";

// A seta da Compra (TASK-0403, F2): com histórico, volta à tela de origem; sem histórico (aberta direto), vai para a
// aba da compra (Cartões). O link tem o href da aba, para quem abre o link em outra aba. A API é falsa: só o detalhe.

const DETALHE = {
  id: "abc",
  movement: "compra",
  localDate: "2026-11-05",
  occurredAt: "2026-11-05T17:32:00Z",
  amountCents: -4500,
  originalDescription: "PAG*JOSEDASILVA SAO PAULO BR",
  customName: null,
  displayName: "PAG*JOSEDASILVA SAO PAULO BR",
  category: null,
  categorizedBy: null,
  aiSuggestion: null,
  spendType: "prazeres",
  spendTypeSource: "padrao",
  hidden: false,
  hiddenReason: null,
  installment: null,
  card: { id: "c1", label: "[TEST] Banco", last4: "1234" },
  account: null,
  bill: null,
  cycle: null,
  counterparty: null,
  origin: null,
  cardWouldAccept: false,
  isCardPayment: false,
  canMarkCardPayment: false,
};

function montar(entradas: InitialEntry[], indice: number) {
  const roteador = createMemoryRouter(criarRotas(), { initialEntries: entradas, initialIndex: indice });
  render(
    <FeaturesProvider valores={{ ia: false, assistente: true, voz: false }}>
      <HideValuesProvider>
        <SessionProvider valores={SESSAO_DE_TESTE}>
          <RouterProvider router={roteador} />
        </SessionProvider>
      </HideValuesProvider>
    </FeaturesProvider>,
  );
  return roteador;
}

beforeEach(() => {
  instalarMatchMedia(1440);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (caminho: string) => {
      if (caminho.startsWith("/api/transactions/")) {
        return new Response(JSON.stringify(DETALHE), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "nao_encontrada" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  // Cada teste monta o app de novo: sem limpar, a árvore do teste anterior sobra e duplica os links.
  cleanup();
  vi.unstubAllGlobals();
});

describe("seta da compra (F2)", () => {
  it("com histórico (veio de Início), a seta volta a Início, e não à aba Cartões", async () => {
    const roteador = montar(["/inicio", "/compras/abc"], 1);
    await screen.findByRole("heading", { level: 2, name: DETALHE.displayName });

    fireEvent.click(screen.getByRole("link", { name: "Voltar" }));

    await waitFor(() => expect(roteador.state.location.pathname).toBe("/inicio"));
  });

  it("sem histórico (aberta direto), a seta vai para a aba da compra, Cartões", async () => {
    const roteador = montar(["/compras/abc"], 0);
    await screen.findByRole("heading", { level: 2, name: DETALHE.displayName });

    fireEvent.click(screen.getByRole("link", { name: "Voltar" }));

    await waitFor(() => expect(roteador.state.location.pathname).toBe("/cartoes"));
  });

  it("o link da seta leva o href da aba, para quem abre em outra aba", async () => {
    montar(["/inicio", "/compras/abc"], 1);
    const seta = await screen.findByRole("link", { name: "Voltar" });
    expect(seta).toHaveAttribute("href", "/cartoes");
  });

  // F6: a marca temHistorico do estado vale sobre o histórico do roteador. Veio do seletor (ou da criação de categoria),
  // com a marca falsa, a seta vai à aba mesmo com uma entrada anterior: a Compra não pode ignorar a marca (mutação U9).
  it("F6: a marca temHistorico do estado vale sobre o histórico: falsa vai à aba, mesmo com entrada anterior", async () => {
    const roteador = montar(["/inicio", { pathname: "/compras/abc", state: { temHistorico: false } }], 1);
    await screen.findByRole("heading", { level: 2, name: DETALHE.displayName });

    fireEvent.click(screen.getByRole("link", { name: "Voltar" }));

    await waitFor(() => expect(roteador.state.location.pathname).toBe("/cartoes"));
  });
});

// Herança da reconferência da TASK-0403 (TASK-0404): o seletor aberto por link direto (outra aba ou endereço digitado)
// chega sem a marca temHistorico. A volta dele passa temHistorico falso, e a seta da tela de detalhe (Compra e Pix) vai
// à aba de origem, em vez de um navigate(-1) sem para onde voltar.
describe("seletor de categoria aberto direto (sem temHistorico)", () => {
  const CATEGORIA = {
    id: "cat1",
    name: "[TEST] Serviços",
    color: "#1E9E63",
    parentId: null,
    defaultSpendType: null,
    aiHint: null,
    sort: 1,
    archived: false,
  };

  function falsa(detalhe: Record<string, unknown>) {
    const json = (corpo: unknown) =>
      new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (caminho: string) => {
        if (caminho.startsWith("/api/categories")) return json({ categories: [CATEGORIA] });
        if (caminho.startsWith("/api/categorization/queue")) {
          return json({
            counts: { todos: 0 },
            suggested: {},
            items: [],
            nextCursor: null,
            hoje: "2026-11-05",
          });
        }
        if (caminho.endsWith("/categorization")) {
          return json({
            transactionId: "abc",
            scope: "estabelecimento",
            matchLabel: null,
            categoryId: null,
            aiCategoryId: null,
            rule: null,
          });
        }
        if (caminho.endsWith("/category"))
          return json({ transactionId: "abc", rule: null, retroactive: null });
        if (caminho.startsWith("/api/transactions/")) return json(detalhe);
        return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
      }),
    );
  }

  it("Compra: escolher a categoria sem a marca volta com temHistorico falso, e a seta vai a Cartões", async () => {
    falsa(DETALHE);
    const roteador = montar(
      [`/categorias/escolher?${new URLSearchParams({ transacao: "abc", voltar: "/compras/abc" })}`],
      0,
    );
    fireEvent.click(await screen.findByRole("radio", { name: /Serviços/ }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar categoria" }));

    await waitFor(() => expect(roteador.state.location.pathname).toBe("/compras/abc"));
    expect(roteador.state.location.state).toMatchObject({ temHistorico: false });
    fireEvent.click(await screen.findByRole("link", { name: "Voltar" }));
    await waitFor(() => expect(roteador.state.location.pathname).toBe("/cartoes"));
  });

  it("Pix: a volta mantém o ?fila=1, leva temHistorico falso, e a seta do Pix em fila vai a Para categorizar; fora da fila, ao Início", async () => {
    const pix = {
      ...DETALHE,
      movement: "pix_enviado",
      card: null,
      counterparty: {
        name: "[TEST] JOAO",
        docMasked: null,
        docKind: null,
        bank: null,
        pixKeyMasked: null,
      },
    };
    falsa(pix);
    const roteador = montar(
      [`/categorias/escolher?${new URLSearchParams({ transacao: "abc", voltar: "/pix/abc?fila=1" })}`],
      0,
    );
    fireEvent.click(await screen.findByRole("radio", { name: /Serviços/ }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar categoria" }));

    await waitFor(() => expect(roteador.state.location.pathname).toBe("/pix/abc"));
    expect(roteador.state.location.search).toBe("?fila=1");
    expect(roteador.state.location.state).toMatchObject({ temHistorico: false });
  });

  it("Pix fora da fila, aberto sem histórico: a seta vai ao Início", async () => {
    falsa({ ...DETALHE, movement: "pix_enviado", card: null });
    const roteador = montar([{ pathname: "/pix/abc", state: { temHistorico: false } }], 0);
    fireEvent.click(await screen.findByRole("link", { name: "Voltar" }));
    await waitFor(() => expect(roteador.state.location.pathname).toBe("/inicio"));
  });

  describe("link do cartão de categoria (TASK-0404)", () => {
    it("o voltar é o caminho atual com a busca, no Pix em fila e na compra", async () => {
      falsa({ ...DETALHE, movement: "pix_enviado", card: null });
      montar(["/pix/abc?fila=1"], 0);
      const link = await screen.findByRole("link", { name: /Categoria/ });
      const voltar = new URL(link.getAttribute("href") ?? "", "http://app.invalid").searchParams.get(
        "voltar",
      );
      expect(voltar).toBe("/pix/abc?fila=1");
      cleanup();

      falsa(DETALHE);
      montar(["/compras/abc"], 0);
      const outro = await screen.findByRole("link", { name: /Categoria/ });
      const voltarDaCompra = new URL(outro.getAttribute("href") ?? "", "http://app.invalid").searchParams.get(
        "voltar",
      );
      expect(voltarDaCompra).toBe("/compras/abc");
    });
  });
});
