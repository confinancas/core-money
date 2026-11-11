import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
