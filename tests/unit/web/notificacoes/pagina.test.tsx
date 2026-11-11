import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificacoesPage } from "@/screens/notificacoes/NotificacoesPage";

// Rodada 1, robustez: um tipo fora do catálogo e uma data inválida não derrubam a tela. O item some, e o resto aparece.
describe("NotificacoesPage com item fora do esperado", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("mostra a notificação boa e não mostra nem quebra com as duas ruins", async () => {
    const corpo = {
      unreadCount: 1,
      new: [
        {
          id: "boa",
          kind: "vencimento",
          title: "[TEST] Fatura boa",
          body: "[TEST] 1.980,00 · vence 15/10",
          link: "/contas",
          createdAt: "2026-11-10T11:00:00.000Z",
        },
        {
          id: "tipo-ruim",
          kind: "tipo_que_nao_existe",
          title: "[TEST] Tipo fora do catálogo",
          body: "[TEST] corpo",
          link: "/inicio",
          createdAt: "2026-11-10T11:00:00.000Z",
        },
      ],
      previous: [
        {
          id: "data-ruim",
          kind: "fatura_paga",
          title: "[TEST] Data inválida",
          body: "[TEST] corpo",
          link: "/cartoes/x",
          createdAt: "não é data",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(corpo)),
    );

    render(
      <MemoryRouter>
        <NotificacoesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("[TEST] Fatura boa")).toBeInTheDocument();
    expect(screen.queryByText("[TEST] Tipo fora do catálogo")).not.toBeInTheDocument();
    expect(screen.queryByText("[TEST] Data inválida")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Notificações" })).toBeInTheDocument();
  });
});
