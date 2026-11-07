import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TextField } from "@/components/ui/text-field";

afterEach(cleanup);

describe("TextField", () => {
  it("liga o rótulo ao campo", () => {
    render(<TextField label="Nome da conta" />);

    expect(screen.getByLabelText("Nome da conta")).toBeInTheDocument();
  });

  it("com erro, marca aria-invalid e liga a mensagem por aria-describedby", () => {
    render(<TextField label="Valor" error="Informe um valor." />);

    const campo = screen.getByLabelText("Valor");
    const erro = screen.getByText("Informe um valor.");
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo.getAttribute("aria-describedby")).toContain(erro.id);
  });

  it("com dica, liga a dica por aria-describedby e sem erro não marca aria-invalid", () => {
    render(<TextField label="Nome" hint="Como você quer ver a conta." />);

    const campo = screen.getByLabelText("Nome");
    const dica = screen.getByText("Como você quer ver a conta.");
    expect(campo.getAttribute("aria-describedby")).toContain(dica.id);
    expect(campo).not.toHaveAttribute("aria-invalid");
  });
});
