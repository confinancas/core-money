import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SectionPlano } from "@/screens/configuracoes/SectionPlano";
import { UsoContexto, type ValorDoUso } from "@/usage/useUsage";
import { recurso, type UsageResponse, usageBand } from "../../../src/shared/usage";

// Seção Plano da Cloudflare (TASK-0109): o switch manda o valor que a pessoa escolheu, e a falha aparece na seção.
function usoCom(paidPlan: boolean, leiturasPct = 72): UsageResponse {
  const recursos = [
    recurso("requests", 10),
    recurso("rows_read", leiturasPct * 50_000),
    recurso("rows_written", 10),
    recurso("size_bytes", 1000),
  ];
  return {
    day: "2026-11-10",
    paidPlan,
    band: paidPlan ? "normal" : usageBand(Math.max(...recursos.map((item) => item.pct))),
    resetsAt: "2026-11-11T00:00:00.000Z",
    resources: recursos,
  };
}

function comValor(valor: ValorDoUso) {
  return (
    <UsoContexto.Provider value={valor}>
      <SectionPlano />
    </UsoContexto.Provider>
  );
}

afterEach(() => {
  cleanup();
});

describe("seção Plano da Cloudflare", () => {
  it("ligar o switch com plano gratuito grava 'paidPlan: true'", async () => {
    const definirPlanoPago = vi.fn(async () => undefined);
    render(comValor({ uso: usoCom(false), atualizar: async () => undefined, definirPlanoPago }));

    await userEvent.click(screen.getByRole("switch", { name: "Estou no plano pago" }));

    expect(definirPlanoPago).toHaveBeenCalledTimes(1);
    expect(definirPlanoPago).toHaveBeenCalledWith(true);
  });

  it("desligar o switch com plano pago grava 'paidPlan: false'", async () => {
    const definirPlanoPago = vi.fn(async () => undefined);
    render(comValor({ uso: usoCom(true), atualizar: async () => undefined, definirPlanoPago }));

    expect(screen.getByRole("switch", { name: "Estou no plano pago" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await userEvent.click(screen.getByRole("switch", { name: "Estou no plano pago" }));

    expect(definirPlanoPago).toHaveBeenCalledWith(false);
  });

  it("falha ao gravar: a mensagem padrão aparece e o switch não fica preso", async () => {
    const definirPlanoPago = vi.fn(async () => {
      throw new Error("sem conexão");
    });
    render(comValor({ uso: usoCom(false), atualizar: async () => undefined, definirPlanoPago }));

    await userEvent.click(screen.getByRole("switch", { name: "Estou no plano pago" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não deu para salvar agora. Tente de novo.");
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Estou no plano pago" })).not.toBeDisabled(),
    );
  });

  it("'Uso de hoje' abre as quatro barras, com a estimativa nas leituras e o tamanho em MB", async () => {
    render(
      comValor({
        uso: usoCom(false),
        atualizar: async () => undefined,
        definirPlanoPago: async () => undefined,
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: /Uso de hoje/ }));

    expect(screen.getByRole("progressbar", { name: "Leituras do banco" })).toBeInTheDocument();
    expect(screen.getByText("estimativa")).toBeInTheDocument();
    expect(screen.getByText(/0 MB de 500 MB/)).toBeInTheDocument();
  });
});
