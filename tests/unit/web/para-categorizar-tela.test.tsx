import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../../../src/web/app/features";
import { ParaCategorizar } from "../../../src/web/screens/para-categorizar/ParaCategorizar";
import { instalarMatchMedia, desinstalarMatchMedia } from "./helpers/larguras";

// Tela Para categorizar (TASK-0304, rodada 1): valores sem "R$", detalhe com "Hoje", e as confirmações da visita
// acumuladas, cada uma com o seu Desfazer. A API é falsa: nenhum teste fala com o servidor.

const acoes = vi.hoisted(() => ({
  fetchQueue: vi.fn(),
  acceptSuggestions: vi.fn(),
  undoCategorization: vi.fn(),
}));
vi.mock("../../../src/web/api/categorization", () => acoes);

const LINHA_PIX = {
  transactionId: "t-1",
  kind: "pix",
  movement: "pix_enviado",
  title: "Pix para JOAO P SILVA",
  localDate: "2026-11-11",
  institutionName: "Inter",
  amountCents: -15000,
  suggestion: {
    categoryId: "cat-serv",
    categoryName: "Serviços",
    categoryColor: "#1B84F2",
    confidence: "pouca",
    reason: null,
  },
  detailPath: "/pix/t-1",
};
const LINHA_PIX_2 = {
  ...LINHA_PIX,
  transactionId: "t-2",
  title: "Pix para MARIANA S",
  amountCents: -6000,
  detailPath: "/pix/t-2",
};

function resposta(linhas: unknown[]) {
  return {
    counts: { todos: linhas.length, pix: linhas.length, cartao: 0, entradas: 0 },
    suggested: { todos: linhas.length, pix: linhas.length, cartao: 0, entradas: 0 },
    items: linhas,
    nextCursor: null,
    hoje: "2026-11-11",
  };
}

function montar() {
  return render(
    <FeaturesProvider valores={{ ia: true, assistente: false, voz: false }}>
      <MemoryRouter>
        <ParaCategorizar />
      </MemoryRouter>
    </FeaturesProvider>,
  );
}

beforeEach(() => {
  instalarMatchMedia(1440);
  acoes.fetchQueue.mockReset();
  acoes.acceptSuggestions.mockReset();
  acoes.undoCategorization.mockReset();
});

afterEach(() => {
  cleanup();
  desinstalarMatchMedia();
});

describe("tela Para categorizar (rodada 1)", () => {
  it("mostra o valor sem R$ e a linha de detalhe com Hoje, tipo e banco", async () => {
    acoes.fetchQueue.mockResolvedValue(resposta([LINHA_PIX]));
    const { container } = montar();
    await screen.findByText("Pix para JOAO P SILVA");
    expect(container.textContent).not.toContain("R$");
    expect(screen.getByText("Hoje · Pix · Inter")).toBeTruthy();
  });

  it("cada confirmação fica em Categorizados agora, com o seu Desfazer", async () => {
    acoes.fetchQueue.mockResolvedValue(resposta([LINHA_PIX, LINHA_PIX_2]));
    acoes.acceptSuggestions
      .mockResolvedValueOnce({
        accepted: [{ transactionId: "t-1", categoryId: "cat-serv", ruleId: null }],
        alsoResolved: [],
        skipped: [],
      })
      .mockResolvedValueOnce({
        accepted: [{ transactionId: "t-2", categoryId: "cat-serv", ruleId: null }],
        alsoResolved: [],
        skipped: [],
      });
    montar();
    const usuario = userEvent.setup();
    await screen.findByText("Pix para JOAO P SILVA");
    await usuario.click(screen.getByRole("button", { name: /Confirmar Serviços para Pix para JOAO/ }));
    await screen.findByText(/Categorizados agora · 1/);
    acoes.fetchQueue.mockResolvedValue(resposta([LINHA_PIX_2]));
    await usuario.click(screen.getByRole("button", { name: /Confirmar Serviços para Pix para MARIANA/ }));
    await screen.findByText(/Categorizados agora · 2/);
    const lista = screen.getByText(/Categorizados agora/).parentElement as HTMLElement;
    expect(within(lista).getAllByRole("button", { name: "Desfazer" })).toHaveLength(2);
    expect(within(lista).getByText("Pix para JOAO P SILVA")).toBeTruthy();
    expect(within(lista).getByText("Pix para MARIANA S")).toBeTruthy();
  });

  it("sem a chave do Claude, linha com sugestão gravada mostra Sem sugestão e nenhum ✓", async () => {
    acoes.fetchQueue.mockResolvedValue(resposta([LINHA_PIX]));
    render(
      <FeaturesProvider valores={{ ia: false, assistente: false, voz: false }}>
        <MemoryRouter>
          <ParaCategorizar />
        </MemoryRouter>
      </FeaturesProvider>,
    );
    await screen.findByText("Pix para JOAO P SILVA");
    expect(screen.getByText("Sem sugestão · toque para escolher")).toBeTruthy();
    expect(screen.queryByText("Serviços · pouca certeza")).toBeNull();
    expect(screen.queryByRole("button", { name: /Confirmar/ })).toBeNull();
  });

  it("Ver mais: dois cliques trazem a próxima página uma vez só", async () => {
    acoes.fetchQueue.mockResolvedValueOnce({ ...resposta([LINHA_PIX]), nextCursor: "cursor-1" });
    acoes.fetchQueue.mockImplementationOnce(() => new Promise(() => {}));
    montar();
    const usuario = userEvent.setup();
    const botao = await screen.findByRole("button", { name: "Ver mais" });
    await usuario.click(botao);
    await usuario.click(botao);
    expect(acoes.fetchQueue).toHaveBeenCalledTimes(2);
    expect(acoes.fetchQueue).toHaveBeenLastCalledWith("todos", "cursor-1");
  });
});

describe("erro ao carregar (rodada 1)", () => {
  it("sem a fila carregada não mostra progresso nem 'tudo certo'", async () => {
    acoes.fetchQueue.mockRejectedValue(new Error("rede"));
    const { container } = montar();
    await screen.findByText("Não deu para carregar a fila.");
    expect(container.textContent).not.toContain("tudo certo");
    expect(container.textContent).not.toContain("0 de 0");
  });
});
