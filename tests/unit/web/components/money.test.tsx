import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Money } from "@/components/ui/money";

afterEach(cleanup);

describe("Money", () => {
  it("separa a parte inteira dos centavos, que ficam em mm-cents", () => {
    const { container } = render(<Money cents={1076966} />);

    expect(container.querySelector(".mm-money")).toHaveTextContent("10.769,66");
    expect(container.querySelector(".mm-cents")).toHaveTextContent(",66");
  });

  it("mostra o menos U+2212 e um aria-label por extenso", () => {
    render(<Money cents={-5097} />);

    const valor = screen.getByLabelText("menos 50,97");
    expect(valor.textContent).toBe("−50,97");
  });

  it("com sign always, mostra o mais e lê 'mais' por extenso", () => {
    render(<Money cents={150000} sign="always" />);

    expect(screen.getByLabelText("mais 1.500,00").textContent).toBe("+1.500,00");
  });

  it("é sensível por padrão e sensitive={false} tira o data-v", () => {
    const { container, rerender } = render(<Money cents={641000} />);
    expect(container.querySelector(".mm-money")).toHaveAttribute("data-v");

    rerender(<Money cents={641000} sensitive={false} />);
    expect(container.querySelector(".mm-money")).not.toHaveAttribute("data-v");
  });

  it("com struck, risca e usa a cor de item oculto", () => {
    const { container } = render(<Money cents={4450} struck />);

    const valor = container.querySelector(".mm-money");
    expect(valor).toHaveClass("line-through");
    expect(valor).toHaveClass("text-hidden-ink");
  });
});
