import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorState } from "@/components/ui/error-state";

afterEach(cleanup);

describe("ErrorState", () => {
  it("mostra o texto padrão e chama onRetry em Tentar de novo", async () => {
    const usuario = userEvent.setup();
    const aoTentar = vi.fn();
    render(<ErrorState onRetry={aoTentar} />);

    expect(screen.getByText("Não foi possível carregar")).toBeInTheDocument();
    expect(screen.getByText("Confira a internet e tente de novo.")).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(aoTentar).toHaveBeenCalledTimes(1);
  });

  it("offline mostra Sem conexão", () => {
    render(<ErrorState offline onRetry={() => undefined} />);

    expect(screen.getByText("Sem conexão")).toBeInTheDocument();
    expect(screen.getByText("Os dados aparecem quando a internet voltar.")).toBeInTheDocument();
  });
});
