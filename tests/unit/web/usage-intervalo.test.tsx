import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsoProvider, useUso } from "@/usage/useUsage";

// A leitura do uso (TASK-0109, rodada 1): ao voltar à tela, só relê depois de 15 minutos da última leitura boa.
function Leitor() {
  const { uso } = useUso();
  return <p>{uso ? "lido" : "vazio"}</p>;
}

const RESPOSTA = {
  day: "2026-11-11",
  paidPlan: false,
  band: "normal",
  resetsAt: "2026-11-12T00:00:00.000Z",
  resources: [],
};

const MINUTO = 60 * 1000;

describe("leitura do uso ao voltar à tela", () => {
  let fetchSimulado: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T10:00:00.000Z"));
    fetchSimulado = vi.fn(async () => Response.json(RESPOSTA));
    vi.stubGlobal("fetch", fetchSimulado);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function voltaAATela() {
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  it("não relê antes de 15 minutos e relê depois", async () => {
    render(
      <UsoProvider>
        <Leitor />
      </UsoProvider>,
    );
    await waitFor(() => expect(screen.getByText("lido")).toBeInTheDocument());
    expect(fetchSimulado).toHaveBeenCalledTimes(1);

    // 5 minutos depois da última leitura boa: ainda dentro do intervalo, nada muda.
    vi.setSystemTime(new Date(Date.now() + 5 * MINUTO));
    voltaAATela();
    await waitFor(() => expect(fetchSimulado).toHaveBeenCalledTimes(1));

    // 16 minutos depois: passou do intervalo, então a tela relê.
    vi.setSystemTime(new Date(Date.now() + 11 * MINUTO));
    voltaAATela();
    await waitFor(() => expect(fetchSimulado).toHaveBeenCalledTimes(2));
  });
});
