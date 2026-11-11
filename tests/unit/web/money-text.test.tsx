import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MoneyText } from "@/components/ui/money-text";

// O corpo das notificações: cada valor com centavos a 60% (mm-cents), e o texto inteiro sem mudança.
describe("MoneyText", () => {
  afterEach(() => cleanup());

  it("põe os centavos num span menor, e o texto fica igual", () => {
    const { container } = render(<MoneyText texto="1.980,00 · vence 15/10" />);

    expect(container.textContent).toBe("1.980,00 · vence 15/10");
    const valores = container.querySelectorAll(".mm-money");
    expect(valores).toHaveLength(1);
    expect(valores[0]?.textContent).toBe("1.980,00");
    expect(valores[0]?.querySelector(".mm-cents")?.textContent).toBe(",00");
    expect(valores[0]).toHaveAttribute("data-v");
  });

  it("trata cada valor, com sinal e sem separador de milhar", () => {
    const { container } = render(
      <MoneyText texto="+1.500,00 · Pode gastar hoje: 127,41 · meta por dia: 178,38" />,
    );

    expect(container.textContent).toBe("+1.500,00 · Pode gastar hoje: 127,41 · meta por dia: 178,38");
    const cents = [...container.querySelectorAll(".mm-cents")].map((item) => item.textContent);
    expect(cents).toEqual([",00", ",41", ",38"]);
  });

  it("texto sem valor sai como estava", () => {
    const { container } = render(<MoneyText texto="Toque para categorizar." />);

    expect(container.querySelector(".mm-money")).toBeNull();
    expect(container.textContent).toBe("Toque para categorizar.");
  });
});
