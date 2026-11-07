import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChoiceTile } from "@/components/ui/choice-tile";

afterEach(cleanup);

describe("ChoiceTile", () => {
  it("é um radio com aria-checked e chama onSelect ao tocar", async () => {
    const usuario = userEvent.setup();
    const aoSelecionar = vi.fn();
    render(<ChoiceTile label="Só eu" selected onSelect={aoSelecionar} />);

    const opcao = screen.getByRole("radio", { name: "Só eu" });
    expect(opcao).toHaveAttribute("aria-checked", "true");

    await usuario.click(opcao);
    expect(aoSelecionar).toHaveBeenCalledTimes(1);
  });

  it("não selecionada, tem aria-checked false", () => {
    render(<ChoiceTile label="Nós dois" selected={false} onSelect={() => undefined} />);

    expect(screen.getByRole("radio", { name: "Nós dois" })).toHaveAttribute("aria-checked", "false");
  });

  it("com ponto, fica com 60 px e, selecionada, a borda pega a cor do ponto", () => {
    render(<ChoiceTile label="Fixos" dotColor="rgb(61, 123, 247)" selected onSelect={() => undefined} />);

    const opcao = screen.getByRole("radio", { name: "Fixos" });
    expect(opcao).toHaveClass("min-h-[60px]");
    expect(opcao.style.borderColor).toBe("rgb(61, 123, 247)");
  });
});
