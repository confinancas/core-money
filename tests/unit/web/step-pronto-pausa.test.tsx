import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lerEstadoDaImportacao } from "@/api/sync";
import { StepPronto } from "@/screens/bancos/conectar/StepPronto";
import type { SyncStatusResponse } from "../../../src/shared/sync-api";

// Passo 4 do conectar, pausado pelo teto (TASK-0209): a frase de quando volta e, no plano gratuito, a explicação, o botão
// e a nota; no plano pago, só a frase. A barra de progresso some enquanto está pausado.
vi.mock("@/api/sync", () => ({ lerEstadoDaImportacao: vi.fn() }));

function estadoPausado(paidPlan: boolean): SyncStatusResponse {
  return {
    importing: [
      {
        bankItemId: "banco-test",
        institutionName: "Banco [TEST]",
        progressPct: 42,
        startedAt: "2026-11-10T11:00:00.000Z",
        pausada: true,
        pausadaAte: "2026-11-11T00:00:00.000Z",
      },
    ],
    recentlyFinished: [],
    lastSync: null,
    banks: [],
    paidPlan,
  };
}

function renderiza(paidPlan: boolean) {
  vi.mocked(lerEstadoDaImportacao).mockResolvedValue(estadoPausado(paidPlan));
  render(
    <StepPronto
      rotulo="[TEST] Conexão"
      quantidade={1}
      bancoIds={["banco-test"]}
      aoIrParaInicio={() => undefined}
      aoVerEmConfiguracoes={() => undefined}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("passo 4 pausado pelo teto", () => {
  it("no plano gratuito: a frase, a explicação, o botão e a nota, e sem a barra", async () => {
    renderiza(false);

    expect(await screen.findByText(/^A importação continua (hoje|amanhã) às 21h\.$/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Para o app caber no plano gratuito da Cloudflare, a importação usa até 60% das gravações do banco por dia. O resto fica para o uso de vocês.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seguir agora · tenho o plano pago" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "Histórico" })).toBeNull();
  });

  it("no plano pago ligado (ainda pausada): só a frase, sem o botão", async () => {
    renderiza(true);

    expect(await screen.findByText(/^A importação continua (hoje|amanhã) às 21h\.$/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Seguir agora · tenho o plano pago" })).toBeNull();
    expect(screen.queryByText(/plano gratuito da Cloudflare/)).toBeNull();
  });
});
