import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, type InitialEntry, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeaturesProvider } from "@/app/features";
import { HideValuesProvider } from "@/components/ui/hide-values";
import { criarRotas } from "@/routes";
import { SessionProvider } from "@/session/SessionProvider";
import { SESSAO_DE_TESTE } from "../helpers/app";
import { instalarMatchMedia } from "../helpers/larguras";

// F8 (TASK-0403): desistir de uma criação de categoria aberta pela compra. A seta do topo da "Nova categoria" volta ao
// seletor com replace e leva a marca de histórico; um link comum empilharia o seletor sobre a criação. Sem a compra
// (o seletor aberto de outro jeito), a seta segue como antes, com um link comum.

// O seletor aberto pela compra, e a criação aberta a partir dele. A entrada de objeto separa caminho e busca: o
// caminho nunca leva "?" (o roteador o trataria como texto).
const SELETOR_DA_COMPRA = "/categorias/escolher?transacao=abc&voltar=%2Fcompras%2Fabc";
const entradaDaCriacaoDaCompra = (estado: { temHistorico: boolean }): InitialEntry => ({
  pathname: "/categorias/nova",
  search: `?${new URLSearchParams({ voltar: SELETOR_DA_COMPRA }).toString()}`,
  state: estado,
});
// O seletor aberto sem a compra (sem transacao): a seta da criação não é trocada.
const CRIACAO_SEM_COMPRA = `/categorias/nova?${new URLSearchParams({ voltar: "/categorias/escolher" }).toString()}`;

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
      if (caminho.startsWith("/api/categories")) {
        return new Response(JSON.stringify({ categories: [] }), {
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
  cleanup();
  vi.unstubAllGlobals();
});

describe("F8: desistir da criação aberta pela compra", () => {
  it("com histórico: a seta do topo volta ao seletor com replace e leva temHistorico verdadeiro", async () => {
    const roteador = montar(["/inicio", entradaDaCriacaoDaCompra({ temHistorico: true })], 1);
    const seta = await screen.findByRole("link", { name: "Voltar às categorias" });

    fireEvent.click(seta);

    await waitFor(() => expect(roteador.state.location.pathname).toBe("/categorias/escolher"));
    expect(roteador.state.historyAction).toBe("REPLACE");
    expect(roteador.state.location.state).toEqual({ temHistorico: true });
  });

  it("sem histórico (compra aberta direto): a seta volta ao seletor com replace e leva temHistorico falso", async () => {
    const roteador = montar([entradaDaCriacaoDaCompra({ temHistorico: false })], 0);
    const seta = await screen.findByRole("link", { name: "Voltar às categorias" });

    fireEvent.click(seta);

    await waitFor(() => expect(roteador.state.location.pathname).toBe("/categorias/escolher"));
    expect(roteador.state.historyAction).toBe("REPLACE");
    expect(roteador.state.location.state).toEqual({ temHistorico: false });
  });

  it("sem a compra (seletor aberto de outro jeito): a seta segue um link comum, como antes", async () => {
    const roteador = montar(["/inicio", CRIACAO_SEM_COMPRA], 1);
    const seta = await screen.findByRole("link", { name: "Voltar às categorias" });

    fireEvent.click(seta);

    await waitFor(() => expect(roteador.state.location.pathname).toBe("/categorias/escolher"));
    expect(roteador.state.historyAction).toBe("PUSH");
  });
});
