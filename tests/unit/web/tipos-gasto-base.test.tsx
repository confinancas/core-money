import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PlannedPercentages } from "../../../src/shared/spend-types";
import { DistributionCard } from "../../../src/web/screens/configuracoes/tipos-de-gasto/DistributionCard";

// Base da distribuição (TASK-0802, rodada 2): a quantia sai com o Money, e os centavos ficam menores (.mm-cents).

const PERCENTUAIS: PlannedPercentages = {
  fixos: 35,
  conforto: 10,
  educacao: 5,
  extras: 5,
  metas: 10,
  prazeres: 10,
};

describe("base da distribuição com os centavos menores", () => {
  it("o parágrafo da base tem .mm-cents com ,70 e o texto da spec", () => {
    const { container } = render(
      <DistributionCard
        percentuais={PERCENTUAIS}
        base={{ cycleKey: "2026-08", label: "setembro", prevIncomeCents: 1656870 }}
      />,
    );
    const paragrafo = container.querySelector('[data-testid="base-distribuicao"]');
    expect(paragrafo?.querySelector(".mm-cents")?.textContent).toBe(",70");
    expect(paragrafo?.textContent).toBe(
      "Base: renda de setembro, 16.568,70. Investimentos é o que sobra: ajusta sozinho para fechar 100%.",
    );
  });

  it("sem base, o texto de 'sem renda' e nenhum .mm-cents", () => {
    const { container } = render(<DistributionCard percentuais={PERCENTUAIS} base={null} />);
    const paragrafo = container.querySelector('[data-testid="base-distribuicao"]');
    expect(paragrafo?.querySelector(".mm-cents")).toBeNull();
    expect(paragrafo?.textContent).toContain("Base: a renda do ciclo anterior");
  });
});
