import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider, useConfirm } from "@/components/ui/confirm-dialog";

function Gatilho({ aoResponder }: { aoResponder: (confirmado: boolean) => void }) {
  const confirmar = useConfirm();

  return (
    <button
      type="button"
      onClick={() => {
        void confirmar({
          title: "Apagar esta conta?",
          description: "Não dá para desfazer.",
          confirmLabel: "Apagar",
          tone: "danger",
        }).then(aoResponder);
      }}
    >
      Abrir
    </button>
  );
}

function montar(aoResponder: (confirmado: boolean) => void) {
  render(
    <ConfirmProvider>
      <Gatilho aoResponder={aoResponder} />
    </ConfirmProvider>,
  );
}

afterEach(cleanup);

describe("useConfirm e ConfirmDialog", () => {
  it("resolve true ao confirmar", async () => {
    const usuario = userEvent.setup();
    const aoResponder = vi.fn();
    montar(aoResponder);

    await usuario.click(screen.getByRole("button", { name: "Abrir" }));
    await usuario.click(screen.getByRole("button", { name: "Apagar" }));

    expect(aoResponder).toHaveBeenCalledWith(true);
  });

  it("resolve false ao cancelar, com Cancelar como rótulo padrão", async () => {
    const usuario = userEvent.setup();
    const aoResponder = vi.fn();
    montar(aoResponder);

    await usuario.click(screen.getByRole("button", { name: "Abrir" }));
    await usuario.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(aoResponder).toHaveBeenCalledWith(false);
  });

  it("Esc cancela e o foco volta ao botão que abriu", async () => {
    const usuario = userEvent.setup();
    const aoResponder = vi.fn();
    montar(aoResponder);

    const gatilho = screen.getByRole("button", { name: "Abrir" });
    await usuario.click(gatilho);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await usuario.keyboard("{Escape}");

    expect(aoResponder).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(gatilho).toHaveFocus();
  });
});
