import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EyeToggle, HideValuesProvider } from "@/components/ui/hide-values";

const CHAVE = "mm:ocultar-valores";

function Tela() {
  return (
    <HideValuesProvider>
      <EyeToggle />
    </HideValuesProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.classList.remove("mm-oculto");
});

describe("HideValuesProvider e EyeToggle", () => {
  it("põe mm-oculto no html e troca o rótulo do botão", async () => {
    const usuario = userEvent.setup();
    render(<Tela />);

    await usuario.click(screen.getByRole("button", { name: "Ocultar valores" }));

    expect(document.documentElement).toHaveClass("mm-oculto");
    expect(screen.getByRole("button", { name: "Mostrar valores" })).toHaveAttribute("aria-pressed", "true");

    await usuario.click(screen.getByRole("button", { name: "Mostrar valores" }));
    expect(document.documentElement).not.toHaveClass("mm-oculto");
  });

  it("lembra a escolha no aparelho e a aplica na carga seguinte", async () => {
    const usuario = userEvent.setup();
    const { unmount } = render(<Tela />);
    await usuario.click(screen.getByRole("button", { name: "Ocultar valores" }));
    expect(localStorage.getItem(CHAVE)).toBe("1");
    unmount();

    render(<Tela />);

    expect(document.documentElement).toHaveClass("mm-oculto");
    expect(screen.getByRole("button", { name: "Mostrar valores" })).toBeInTheDocument();
  });

  it("funciona quando o localStorage lança", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    const usuario = userEvent.setup();
    render(<Tela />);

    await usuario.click(screen.getByRole("button", { name: "Ocultar valores" }));

    expect(document.documentElement).toHaveClass("mm-oculto");
  });
});
