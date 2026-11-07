import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  count?: number;
};

// Pílula de 40 px. A área de toque chega a 45 px.
export function Chip({ selected = false, count, children, className, type = "button", ...rest }: Props) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        "relative inline-flex h-10 items-center gap-1.5 rounded-full border-[1.5px] px-4 text-[13px] font-extrabold text-primary-ink transition-colors",
        "before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
        selected ? "border-primary bg-primary-soft" : "border-chip-border bg-card",
        className,
      )}
      {...rest}
    >
      {children}
      {count !== undefined && <span className="text-ink-2">{count}</span>}
    </button>
  );
}
