import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tom = "aviso" | "falta" | "sucesso";

const TONS: Record<Tom, string> = {
  aviso: "bg-warn-bg text-warn",
  falta: "bg-danger-bg text-danger",
  sucesso: "bg-success-bg text-success-ink",
};

// Pílula de estado, 12/800.
export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: Tom;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-[3px] text-[12px] font-extrabold",
        TONS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
