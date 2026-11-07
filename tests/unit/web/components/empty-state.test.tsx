import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

afterEach(cleanup);

describe("EmptyState", () => {
  it("mostra título, texto e a ação", () => {
    render(
      <EmptyState
        title="Nenhuma conta ainda"
        description="Adicione uma conta para ver os saldos aqui."
        action={<Button variant="secondary">Adicionar conta</Button>}
      />,
    );

    expect(screen.getByRole("heading", { name: "Nenhuma conta ainda" })).toBeInTheDocument();
    expect(screen.getByText("Adicione uma conta para ver os saldos aqui.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar conta" })).toBeInTheDocument();
  });
});
