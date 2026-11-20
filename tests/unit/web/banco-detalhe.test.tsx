import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DetalheDoBancoDto } from "../../../src/shared/bank-item-view";
import { ConsentCard } from "../../../src/web/screens/bancos/detalhe/ConsentCard";
import { SyncCard } from "../../../src/web/screens/bancos/detalhe/SyncCard";

// Componentes do detalhe do banco (TASK-0206, rodada 1 da Fable). Os pedidos à API são falsos: nenhum sai da máquina.
const { baixarAgora, conferirConsentimento } = vi.hoisted(() => ({
  baixarAgora: vi.fn(),
  conferirConsentimento: vi.fn(),
}));
vi.mock("../../../src/web/api/bank-items", () => ({ baixarAgora, conferirConsentimento }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const HOJE = "2026-11-20";

function banco(parcial: Partial<DetalheDoBancoDto> = {}): DetalheDoBancoDto {
  return {
    id: "banco-a",
    institutionName: "[TEST] Banco A",
    institutionColor: null,
    connection: { id: "conexao-a", label: "[TEST] Conta A" },
    status: "instavel",
    disconnectedAt: null,
    consentExpiresAt: "2026-12-31T00:00:00.000Z",
    lastSyncAt: "2026-11-18T03:12:00.000Z",
    running: false,
    failed: true,
    canRetry: true,
    accounts: [],
    cards: [],
    runs: [
      {
        id: "execucao-1",
        kind: "diaria",
        startedAt: "2026-11-19T03:00:00.000Z",
        finishedAt: "2026-11-19T03:05:00.000Z",
        status: "instavel",
        newTransactions: 0,
        progressPct: 40,
        errorCode: "banco_instavel",
      },
    ],
    ...parcial,
  };
}

const comMundo = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("SyncCard: 'Não deu de novo' só depois da resposta com falha (A2, Fable)", () => {
  it("durante o pedido, a frase não aparece; depois de uma execução nova com falha, aparece", async () => {
    let liberar: () => void = () => undefined;
    baixarAgora.mockReturnValue(
      new Promise<{ runId: string }>((resolve) => {
        liberar = () => resolve({ runId: "execucao-2" });
      }),
    );
    const aoMudar = vi.fn();
    const { rerender } = comMundo(<SyncCard banco={banco()} hoje={HOJE} aoMudar={aoMudar} />);

    fireEvent.click(screen.getByRole("button", { name: "Baixar agora" }));
    // O pedido ainda não voltou: a execução anterior continua sendo a última, e a frase não pode aparecer.
    expect(screen.queryByText(/Não deu de novo/)).toBeNull();
    expect(screen.getByText("Baixando…")).toBeTruthy();

    // Voltou com a execução nova encerrada com falha: agora a frase vale.
    await act(async () => {
      liberar();
    });
    expect(aoMudar).toHaveBeenCalled();
    rerender(
      <MemoryRouter>
        <SyncCard
          banco={banco({
            runs: [
              {
                id: "execucao-2",
                kind: "manual",
                startedAt: "2026-11-20T10:00:00.000Z",
                finishedAt: "2026-11-20T10:01:00.000Z",
                status: "instavel",
                newTransactions: 0,
                progressPct: 40,
                errorCode: "banco_instavel",
              },
              ...banco().runs,
            ],
          })}
          hoje={HOJE}
          aoMudar={aoMudar}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Não deu de novo/)).toBeTruthy();
  });
});

describe("ConsentCard: a conferência ao voltar à aba (critério de aceite, rodada 1)", () => {
  it("só depois de abrir a renovação, e uma vez por abertura, mesmo com várias voltas à aba", async () => {
    conferirConsentimento.mockResolvedValue({
      renewed: false,
      consentExpiresAt: "2026-12-31T00:00:00.000Z",
      itemMissing: false,
    });
    comMundo(
      <ConsentCard
        banco={banco({ failed: false, canRetry: false, status: "ativo" })}
        hoje={HOJE}
        aoMudar={vi.fn()}
      />,
    );
    const voltar = () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    };

    // Antes de abrir a renovação, voltar à aba não confere.
    voltar();
    expect(conferirConsentimento).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("link", { name: "Renovar por mais 12 meses" }));
    await act(async () => {
      voltar();
      voltar();
      voltar();
    });
    expect(conferirConsentimento).toHaveBeenCalledTimes(1);
    expect(conferirConsentimento).toHaveBeenCalledWith("banco-a");
  });
});
