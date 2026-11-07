import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider, useConfirm } from "@/components/ui/confirm-dialog";

type Confirmar = ReturnType<typeof useConfirm>;

// Entrega a função de confirmação ao teste, para chamá-la fora de um clique.
function Captura({ aoCapturar }: { aoCapturar: (confirmar: Confirmar) => void }) {
  aoCapturar(useConfirm());
  return null;
}

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

  it("uma confirmação nova resolve a anterior com false e mostra o próprio título", async () => {
    const usuario = userEvent.setup();
    let confirmar: Confirmar | undefined;
    render(
      <ConfirmProvider>
        <Captura aoCapturar={(valor) => (confirmar = valor)} />
      </ConfirmProvider>,
    );
    let primeira: Promise<boolean> | undefined;
    let segunda: Promise<boolean> | undefined;

    act(() => {
      primeira = confirmar?.({ title: "Primeiro aviso", confirmLabel: "Ok" });
      segunda = confirmar?.({ title: "Segundo aviso", confirmLabel: "Confirmar" });
    });

    await expect(primeira).resolves.toBe(false);
    expect(screen.getByRole("heading", { name: "Segundo aviso" })).toBeInTheDocument();
    expect(screen.queryByText("Primeiro aviso")).toBeNull();

    await usuario.click(screen.getByRole("button", { name: "Confirmar" }));
    await expect(segunda).resolves.toBe(true);
  });

  it("ao desmontar o provedor, a confirmação pendente resolve com false", async () => {
    let confirmar: Confirmar | undefined;
    const { unmount } = render(
      <ConfirmProvider>
        <Captura aoCapturar={(valor) => (confirmar = valor)} />
      </ConfirmProvider>,
    );
    let pendente: Promise<boolean> | undefined;
    act(() => {
      pendente = confirmar?.({ title: "Sair sem salvar?", confirmLabel: "Sair" });
    });

    unmount();

    await expect(pendente).resolves.toBe(false);
  });
});
