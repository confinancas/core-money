import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PausaDoTeto } from "@/components/sync/PausaDoTeto";
import { UsoContexto, type ValorDoUso } from "@/usage/useUsage";

// Pausa pelo teto (TASK-0209), na tela: o botão liga o plano pago e avisa a tela; se gravar falhar, a mensagem aparece e
// a faixa continua pausada (cenário 4). No plano pago, a frase fica e o botão some.
const PAUSADA_ATE = "2026-11-11T00:00:00.000Z";

function comValor(valor: ValorDoUso, paidPlan: boolean, aoSeguir = vi.fn()) {
  render(
    <UsoContexto.Provider value={valor}>
      <PausaDoTeto pausadaAte={PAUSADA_ATE} paidPlan={paidPlan} aoSeguir={aoSeguir} />
    </UsoContexto.Provider>,
  );
  return aoSeguir;
}

function valorCom(definirPlanoPago: ValorDoUso["definirPlanoPago"]): ValorDoUso {
  return { uso: null, atualizar: async () => undefined, definirPlanoPago };
}

afterEach(() => {
  cleanup();
});

describe("PausaDoTeto no plano gratuito", () => {
  it("mostra a frase, a explicação, o botão e a nota", () => {
    comValor(
      valorCom(async () => undefined),
      false,
    );

    expect(screen.getByText(/^A importação continua (hoje|amanhã) às 21h\.$/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Para o app caber no plano gratuito da Cloudflare, a importação usa até 60% das gravações do banco por dia. O resto fica para o uso de vocês.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seguir agora · tenho o plano pago" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Só vale o plano pago do Workers (Workers Paid). O plano Pro do site não conta. No plano gratuito, o app pode parar até as 21h.",
      ),
    ).toBeInTheDocument();
  });

  it("'Seguir agora' grava paidPlan true e, depois, avisa a tela para reler o status", async () => {
    const definirPlanoPago = vi.fn(async () => undefined);
    const aoSeguir = comValor(valorCom(definirPlanoPago), false);

    await userEvent.click(screen.getByRole("button", { name: "Seguir agora · tenho o plano pago" }));

    expect(definirPlanoPago).toHaveBeenCalledWith(true);
    await waitFor(() => expect(aoSeguir).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("se gravar falhar: 'Não deu para seguir. Tente de novo.' em alerta, e o botão continua para tentar de novo", async () => {
    const definirPlanoPago = vi.fn(async () => {
      throw new Error("500");
    });
    const aoSeguir = comValor(valorCom(definirPlanoPago), false);

    await userEvent.click(screen.getByRole("button", { name: "Seguir agora · tenho o plano pago" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não deu para seguir. Tente de novo.");
    expect(aoSeguir).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Seguir agora · tenho o plano pago" })).toBeEnabled();
  });
});

describe("PausaDoTeto no plano pago", () => {
  it("mostra só a frase: sem a explicação, sem o botão e sem a nota", () => {
    comValor(
      valorCom(async () => undefined),
      true,
    );

    expect(screen.getByText(/^A importação continua (hoje|amanhã) às 21h\.$/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Seguir agora · tenho o plano pago" })).toBeNull();
    expect(screen.queryByText(/plano gratuito da Cloudflare/)).toBeNull();
  });
});
