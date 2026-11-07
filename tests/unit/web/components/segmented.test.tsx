import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Segmented } from "@/components/ui/segmented";

const OPCOES = [
  { value: "mes", label: "Mês" },
  { value: "ciclo", label: "Ciclo" },
  { value: "ano", label: "Ano" },
];

function Harness({ inicial = "mes" }: { inicial?: string }) {
  const [valor, setValor] = useState(inicial);
  return <Segmented label="Período" options={OPCOES} value={valor} onChange={setValor} />;
}

afterEach(cleanup);

describe("Segmented", () => {
  it("é um radiogroup com a opção ativa marcada", () => {
    render(<Harness />);

    expect(screen.getByRole("radiogroup", { name: "Período" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Mês" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Ciclo" })).toHaveAttribute("aria-checked", "false");
  });

  it("troca a opção com o clique", async () => {
    const usuario = userEvent.setup();
    render(<Harness />);

    await usuario.click(screen.getByRole("radio", { name: "Ano" }));

    expect(screen.getByRole("radio", { name: "Ano" })).toHaveAttribute("aria-checked", "true");
  });

  it("→ seleciona a próxima opção, dá a volta no fim e ← volta", async () => {
    const usuario = userEvent.setup();
    render(<Harness />);

    screen.getByRole("radio", { name: "Mês" }).focus();
    await usuario.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Ciclo" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Ciclo" })).toHaveFocus();

    await usuario.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Mês" })).toHaveAttribute("aria-checked", "true");

    await usuario.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Ano" })).toHaveAttribute("aria-checked", "true");
  });
});
