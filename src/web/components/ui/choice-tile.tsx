// biome-ignore-all lint/a11y/useSemanticElements: o desenho pede cartões com role radio (spec), não o radio nativo
import { cn } from "@/lib/utils";

type Props = {
  selected: boolean;
  label: string;
  // Ponto de cor à esquerda. Com ponto, a opção fica com 60 px de altura e, selecionada, a borda pega a cor.
  dotColor?: string;
  onSelect: () => void;
  className?: string;
};

// Opção em forma de cartão, como as de um grupo de rádio.
export function ChoiceTile({ selected, label, dotColor, onSelect, className }: Props) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      style={selected && dotColor ? { borderColor: dotColor } : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-tile border-[1.5px] bg-card px-3.5 text-left text-[13px] font-semibold text-ink transition-colors",
        dotColor ? "min-h-[60px]" : "min-h-[52px]",
        selected ? "border-primary bg-primary-soft" : "border-tile-border",
        className,
      )}
    >
      {dotColor && (
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor }}
        />
      )}
      <span>{label}</span>
    </button>
  );
}
