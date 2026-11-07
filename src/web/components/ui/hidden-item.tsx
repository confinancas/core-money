import type { ReactNode } from "react";
import { IconeOlhoRiscado } from "@/components/icons";
import { cn } from "@/lib/utils";

type Motivo = "gasto_terceiros" | "reembolso_terceiros";

const ETIQUETAS: Record<Motivo, string> = {
  gasto_terceiros: "Gasto de terceiros · fora dos cálculos",
  reembolso_terceiros: "Reembolso de terceiros · fora dos cálculos",
};

// Item que não entra em nenhum cálculo, mas continua visível nas listas: listras e borda tracejada.
export function HiddenItem({ reason, children }: { reason: Motivo; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-field border border-dashed border-hidden-border px-4 py-3 text-ink-3",
        "bg-[repeating-linear-gradient(135deg,var(--color-hidden-a)_0_7px,var(--color-hidden-b)_7px_14px)]",
      )}
    >
      <p className="flex items-center gap-1.5 text-[12px] font-bold">
        <IconeOlhoRiscado size={14} />
        {ETIQUETAS[reason]}
      </p>
      {children}
    </div>
  );
}
