import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// N5 (TASK-0305, rodada 1): a busca sem resultado tem um texto próprio; o vazio de lar sem regras fica como está.

const buscarRegras = vi.fn();
vi.mock("@/api/settings-categorization", () => ({
  fetchRules: (opcoes: unknown) => buscarRegras(opcoes),
  deleteRule: vi.fn(async () => undefined),
}));

import { Regras } from "@/screens/configuracoes/regras/Regras";

const VAZIO_DO_LAR = "Nenhuma regra ainda. Elas aparecem quando vocês confirmam uma categoria.";
const VAZIO_DA_BUSCA = "Nenhuma regra com esse nome.";

beforeEach(() => {
  buscarRegras.mockReset();
  buscarRegras.mockResolvedValue({ total: 0, items: [], nextCursor: null });
});

afterEach(() => {
  cleanup();
});

function montar() {
  return render(
    <MemoryRouter>
      <Regras />
    </MemoryRouter>,
  );
}

describe("N5: textos de vazio", () => {
  it("lar sem regras mostra o texto de vazio do lar", async () => {
    montar();
    expect(await screen.findByText(VAZIO_DO_LAR)).toBeTruthy();
    expect(screen.queryByText(VAZIO_DA_BUSCA)).toBeNull();
  });

  it("busca sem resultado mostra o texto próprio da busca", async () => {
    montar();
    await screen.findByText(VAZIO_DO_LAR);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "xyz" } });
    await waitFor(() => expect(screen.getByText(VAZIO_DA_BUSCA)).toBeTruthy());
    expect(screen.queryByText(VAZIO_DO_LAR)).toBeNull();
  });
});
