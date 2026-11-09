import { Card } from "@/components/ui/card";
import type { PlannedPercentages } from "../../../../shared/spend-types";
import type { TiposDeGastoResposta } from "../../../api/spend-types";
import { segmentosDaBarra, textoDaBase, totalDaDistribuicao } from "./view-model";

// Distribuição da renda: o total (verde, ou vermelho acima de 100), a barra empilhada nas cores e a base.
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
      <p className="text-[12px] leading-[1.45] text-ink-2">
        {textoDaBase(base, (cents) => formatarSemSimbolo(cents))}
      </p>
    </Card>
  );
}

function formatarSemSimbolo(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    cents / 100,
  );
}
