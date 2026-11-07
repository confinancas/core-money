import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HiddenItem } from "@/components/ui/hidden-item";
import { Money } from "@/components/ui/money";

afterEach(cleanup);

describe("HiddenItem", () => {
  it("mostra a etiqueta de gasto de terceiros", () => {
    render(
      <HiddenItem reason="gasto_terceiros">
        <Money cents={-8900} struck />
      </HiddenItem>,
    );

    expect(screen.getByText("Gasto de terceiros · fora dos cálculos")).toBeInTheDocument();
    expect(screen.getByLabelText("menos 89,00")).toBeInTheDocument();
  });

  it("mostra a etiqueta de reembolso de terceiros", () => {
    render(
      <HiddenItem reason="reembolso_terceiros">
        <Money cents={4450} struck />
      </HiddenItem>,
    );

    expect(screen.getByText("Reembolso de terceiros · fora dos cálculos")).toBeInTheDocument();
  });
});
