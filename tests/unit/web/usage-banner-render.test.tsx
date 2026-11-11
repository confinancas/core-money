import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UsageBanner } from "@/usage/UsageBanner";
import { UsoContexto, type ValorDoUso } from "@/usage/useUsage";
import { recurso, type UsageResponse, usageBand } from "../../../src/shared/usage";

// A faixa na tela (TASK-0109, cenários 6 e 11): atenção fechável, crítico sem o ×, e a atenção que volta depois do crítico.
const CHAVE = "uso-atencao-fechada";

function usoCom(leiturasPct: number): UsageResponse {
  const recursos = [
    recurso("requests", 10),
    recurso("rows_read", leiturasPct * 50_000),
    recurso("rows_written", 10),
    recurso("size_bytes", 1000),
  ];
  return {
    day: "2026-11-10",
    paidPlan: false,
    band: usageBand(Math.max(...recursos.map((item) => item.pct))),
    resetsAt: "2026-11-11T00:00:00.000Z",
    resources: recursos,
  };
}

function comUso(uso: UsageResponse | null) {
  const valor: ValorDoUso = {
    uso,
    atualizar: async () => undefined,
    definirPlanoPago: async () => undefined,
  };
  return (
    <UsoContexto.Provider value={valor}>
      <UsageBanner />
    </UsoContexto.Provider>
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("faixa de uso na tela", () => {
  it("72%: atenção, com 'das leituras do banco de hoje' e o link do upgrade; dá para fechar", async () => {
    render(comUso(usoCom(72)));

    expect(screen.getByText(/72% das leituras do banco de hoje/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Como fazer o upgrade/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fechar aviso" })).toBeInTheDocument();
  });

  it("fechar a atenção esconde a faixa e grava a escolha no navegador (cenário 11)", async () => {
    render(comUso(usoCom(72)));

    await userEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));

    expect(screen.queryByText(/das leituras do banco de hoje/)).not.toBeInTheDocument();
    expect(localStorage.getItem(CHAVE)).toBe("atencao");
  });

  it("91%: crítico, sem o × (não fecha)", () => {
    render(comUso(usoCom(91)));

    expect(screen.getByText(/91% das leituras do banco de hoje/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fechar aviso" })).not.toBeInTheDocument();
  });

  it("atenção fechada não volta; depois do crítico, a atenção volta a aparecer", async () => {
    const { rerender } = render(comUso(usoCom(72)));
    await userEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));
    expect(screen.queryByText(/das leituras do banco de hoje/)).not.toBeInTheDocument();

    rerender(comUso(usoCom(91)));
    expect(screen.getByText(/91% das leituras/)).toBeInTheDocument();
    expect(localStorage.getItem(CHAVE)).toBeNull();

    rerender(comUso(usoCom(72)));
    expect(screen.getByText(/72% das leituras do banco de hoje/)).toBeInTheDocument();
  });

  it("normal e sem leitura não mostram nada", () => {
    const { container, rerender } = render(comUso(usoCom(10)));
    expect(container.querySelector("section")).toBeNull();

    rerender(comUso(null));
    expect(container.querySelector("section")).toBeNull();
  });
});
