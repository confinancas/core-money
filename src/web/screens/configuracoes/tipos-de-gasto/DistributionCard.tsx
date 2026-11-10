import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import type { PlannedPercentages } from "../../../../shared/spend-types";
import type { TiposDeGastoResposta } from "../../../api/spend-types";
import {
  segmentosDaBarra,
  TEXTO_BASE_ANTES,
  TEXTO_BASE_DEPOIS,
  TEXTO_BASE_SEM_RENDA,
  totalDaDistribuicao,
} from "./view-model";

// Distribuição da renda: o total (verde, ou vermelho acima de 100), a barra empilhada nas cores e a base. Os centavos da
// base saem menores, como no restante do app (o Money).
export function DistributionCard({
  percentuais,
  base,
}: {
  percentuais: PlannedPercentages;
  base: TiposDeGastoResposta["base"];
}) {
  const total = totalDaDistribuicao(percentuais);
  const barra = segmentosDaBarra(percentuais);
  return (
    <Card className="flex flex-col gap-3.5 p-5 tablet:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[18px] font-extrabold text-ink">Distribuição da renda</h2>
        <span
          className={`text-[18px] font-extrabold tabular-nums ${total.passou ? "text-danger" : "text-primary-ink"}`}
          data-testid="total-distribuicao"
        >
          {total.texto}
        </span>
      </div>
      <div
        className="flex h-3 gap-0.5 overflow-hidden rounded-[6px]"
        role="img"
        aria-label="Distribuição da renda por tipo"
      >
        {barra.map((segmento) => (
          <span
            key={segmento.id}
            data-tipo={segmento.id}
            className="block h-full"
            style={{ backgroundColor: segmento.color, width: `${segmento.largura}%` }}
          />
        ))}
      </div>
      <p className="text-[12px] leading-[1.45] text-ink-2" data-testid="base-distribuicao">
        {base === null ? (
          TEXTO_BASE_SEM_RENDA
        ) : (
          <>
            {TEXTO_BASE_ANTES(base.label)}
            <Money cents={base.prevIncomeCents} sensitive={false} />
            {TEXTO_BASE_DEPOIS}
          </>
        )}
      </p>
    </Card>
  );
}
