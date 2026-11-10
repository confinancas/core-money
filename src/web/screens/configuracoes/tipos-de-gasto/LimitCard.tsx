import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import type { PlannedPercentages } from "../../../../shared/spend-types";
import type { TiposDeGastoResposta } from "../../../api/spend-types";
import { TEXTO_DO_LIMITE, textoDoLimite } from "./view-model";

// Limite de gasto do ciclo: o valor da fotografia, a linha da base e a prévia do próximo ciclo quando os percentuais mudam.
export function LimitCard({
  limite,
  percentuais,
}: {
  limite: TiposDeGastoResposta["currentLimit"];
  percentuais: PlannedPercentages;
}) {
  const texto = textoDoLimite(limite, percentuais);
  return (
    <Card className="flex flex-col gap-2.5 border border-primary-soft-2 bg-primary-soft p-5 tablet:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[18px] font-extrabold text-ink">Limite de gasto do ciclo</h2>
        <span
          className="whitespace-nowrap text-[22px] font-extrabold tabular-nums text-ink"
          data-testid="valor-limite"
        >
          {texto.valorCents === null ? "—" : <Money cents={texto.valorCents} sensitive={false} />}
        </span>
      </div>
      {texto.linha !== null && <span className="text-[13px] text-ink-2 tabular-nums">{texto.linha}</span>}
      <span className="text-[12px] leading-[1.45] text-ink-2">{TEXTO_DO_LIMITE}</span>
      {texto.proximo !== null && <span className="text-[13px] font-semibold text-ink">{texto.proximo}</span>}
      {texto.semValor !== null && <span className="text-[13px] text-ink-2">{texto.semValor}</span>}
    </Card>
  );
}
