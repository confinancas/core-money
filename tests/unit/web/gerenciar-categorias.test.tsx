import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryDTO } from "../../../src/shared/categories";

// N7 (TASK-0305, rodada 1): escolher uma categoria no tablet e no desktop não remonta a tela. A lista não volta ao
// esqueleto nem é lida de novo, e "Arquivadas" continua como estava.

const buscarCategorias = vi.fn();
vi.mock("@/api/categories", () => ({
  fetchCategories: (opcoes: unknown) => buscarCategorias(opcoes),
  updateCategory: vi.fn(async () => ({})),
}));

import { FeaturesProvider } from "@/app/features";
import { HideValuesProvider } from "@/components/ui/hide-values";
import { criarRotas } from "@/routes";
import { SessionProvider } from "@/session/SessionProvider";
import { SESSAO_DE_TESTE } from "./helpers/app";

const categorias: CategoryDTO[] = [
  {
    id: "cat-saude",
    name: "Saúde",
    color: "#F0559A",
    parentId: null,
    defaultSpendType: null,
    aiHint: null,
    sort: 0,
    archived: false,
  },
  {
    id: "cat-lazer",
    name: "Lazer",
    color: "#13B5A6",
    parentId: null,
    defaultSpendType: null,
    aiHint: null,
    sort: 1,
    archived: false,
  },
];

beforeEach(() => {
  buscarCategorias.mockReset();
  buscarCategorias.mockResolvedValue(categorias);
  // Largura de tablet: a lista e o editor lado a lado.
  window.matchMedia = ((query: string) => ({
    matches: query.includes("768") || query.includes("834"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
});

describe("N7: trocar de categoria não recarrega a lista", () => {
  it("clicar numa categoria no tablet mantém a lista (uma só leitura)", async () => {
    const roteador = createMemoryRouter(criarRotas(), { initialEntries: ["/configuracoes/categorias"] });
    render(
      <FeaturesProvider valores={{ ia: false, assistente: true, voz: false }}>
        <HideValuesProvider>
          <SessionProvider valores={SESSAO_DE_TESTE}>
            <RouterProvider router={roteador} />
          </SessionProvider>
        </HideValuesProvider>
      </FeaturesProvider>,
    );
    await screen.findByRole("link", { name: "Saúde" });
    expect(buscarCategorias).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("link", { name: "Lazer" }));
    await waitFor(() => expect(roteador.state.location.pathname).toBe("/configuracoes/categorias/cat-lazer"));

    // A lista continua na tela, e nenhuma nova leitura foi feita.
    expect(screen.getByRole("link", { name: "Saúde" })).toBeTruthy();
    expect(buscarCategorias).toHaveBeenCalledTimes(1);
  });
});
