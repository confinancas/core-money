import { Money } from "@/components/ui/money";
import { SpendTypeDot } from "@/components/ui/spend-type";
import type { SpendTypeDef } from "../../../../shared/spend-types";

// Uma linha de tipo com controle (− N% +) ou só o valor (Investimentos, automático). Botões de 44 px.
export function TypeRow({
  tipo,
  pct,
  valorCents,
  onDiminuir,
  onAumentar,
  automatico = false,
  negativo = false,
}: {
  tipo: SpendTypeDef;
  pct: number;
  valorCents: number | null;
  onDiminuir?: () => void;
  onAumentar?: () => void;
  automatico?: boolean;
  negativo?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
          <SpendTypeDot type={tipo.id} />
          {tipo.label}
          {tipo.fixo && (
            <span className="rounded-full border border-switch-off-border px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.5px] text-ink-3">
              fixo
            </span>
          )}
          {automatico && (
            <span className="rounded-full border border-primary-soft-2 px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.5px] text-primary-ink">
              automático
            </span>
          )}
        </span>
        <span className="text-[12px] leading-[1.4] text-ink-2">{tipo.descricao}</span>
        {valorCents !== null && (
          <span className="whitespace-nowrap text-[12px] font-bold tabular-nums text-ink-3">
            <Money cents={valorCents} sensitive={false} /> por ciclo
          </span>
        )}
      </div>
      {automatico || onAumentar === undefined || onDiminuir === undefined ? (
        <span
          className={`whitespace-nowrap text-[18px] font-extrabold tabular-nums ${negativo ? "text-danger" : "text-ink"}`}
        >
          {pct}%
        </span>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onDiminuir}
            aria-label={`Diminuir ${tipo.label}`}
            className="flex size-11 items-center justify-center rounded-full border border-tile-border bg-card text-[20px] text-ink"
          >
            −
          </button>
          <span className="min-w-11 text-center text-[18px] font-extrabold tabular-nums text-ink">
            {pct}%
          </span>
          <button
            type="button"
            onClick={onAumentar}
            aria-label={`Aumentar ${tipo.label}`}
            className="flex size-11 items-center justify-center rounded-full border border-tile-border bg-card text-[20px] text-ink"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}
