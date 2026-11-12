import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Cenário 9 (TASK-0305, rodada 1, F2): "Ver a versão salva" carrega a versão de B e o texto de A continua numa caixa
// na tela, mesmo depois do clique. A caixa depende só de haver texto guardado, e não do aviso de conflito.

const buscar = vi.fn();
const gravar = vi.fn();
vi.mock("@/api/settings-categorization", () => ({
  fetchAiDocument: () => buscar(),
  saveAiDocument: (texto: string, base: string | null) => gravar(texto, base),
}));

import { DocumentoIA } from "@/screens/configuracoes/documento-ia/DocumentoIA";

const DE_B = { text: "[TEST] texto de B", updatedAt: "2026-11-11T12:00:00.000Z" };

beforeEach(() => {
  buscar.mockReset();
  gravar.mockReset();
  buscar.mockResolvedValue({ text: "", updatedAt: null });
});

afterEach(() => {
  cleanup();
});

describe("F2: conflito do documento não perde o texto digitado", () => {
  it("cenário 9: depois de 'Ver a versão salva', a versão de B entra e o texto de A continua na tela", async () => {
    gravar.mockResolvedValue({ ok: false, conflito: true, atual: DE_B });
    render(
      <MemoryRouter>
        <DocumentoIA />
      </MemoryRouter>,
    );

    const area = await screen.findByRole("textbox", { name: "Documento de regras" });
    fireEvent.change(area, { target: { value: "[TEST] meu texto de A" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar documento" }));

    expect(await screen.findByText("Outra pessoa salvou o documento enquanto você editava.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ver a versão salva" }));

    await waitFor(() => {
      expect(
        (screen.getByRole("textbox", { name: "Documento de regras" }) as HTMLTextAreaElement).value,
      ).toBe("[TEST] texto de B");
    });
    // O texto de A continua visível na caixa para copiar, mesmo depois do clique.
    const copia = screen.getByDisplayValue("[TEST] meu texto de A") as HTMLTextAreaElement;
    expect(copia.readOnly).toBe(true);
    expect(screen.getByText("Seu texto, para copiar se precisar:")).toBeTruthy();
  });

  it("'Ver a versão salva' usa a versão que veio no 409, sem uma segunda leitura", async () => {
    gravar.mockResolvedValue({ ok: false, conflito: true, atual: DE_B });
    render(
      <MemoryRouter>
        <DocumentoIA />
      </MemoryRouter>,
    );
    const area = await screen.findByRole("textbox", { name: "Documento de regras" });
    fireEvent.change(area, { target: { value: "[TEST] de A" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar documento" }));
    await screen.findByText("Outra pessoa salvou o documento enquanto você editava.");
    const leiturasAntes = buscar.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Ver a versão salva" }));
    await waitFor(() => {
      expect(
        (screen.getByRole("textbox", { name: "Documento de regras" }) as HTMLTextAreaElement).value,
      ).toBe("[TEST] texto de B");
    });
    expect(buscar.mock.calls.length).toBe(leiturasAntes);
  });
});
