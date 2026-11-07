import { cn } from "@/lib/utils";
import { SPEND_TYPES, type SpendType } from "../../../shared/spend-types";

function acharTipo(tipo: SpendType) {
  return SPEND_TYPES.find((item) => item.id === tipo);
}

// Ponto de 8 px na cor do tipo.
export function SpendTypeDot({ type, className }: { type: SpendType; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: acharTipo(type)?.color }}
    />
  );
}

// Ponto e rótulo do tipo, como em SPEND_TYPES.
export function SpendTypeLabel({ type, className }: { type: SpendType; className?: string }) {
  const tipo = acharTipo(type);
  if (!tipo) return null;

  return (
    <span className={cn("inline-flex items-center gap-2 text-[13px] font-semibold text-ink", className)}>
      <SpendTypeDot type={type} />
      {tipo.label}
    </span>
  );
}
