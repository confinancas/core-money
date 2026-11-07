import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Bolha de vidro sobre o verde: branco a 14%, borda branca a 22%.
export function GlassBubble({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-glass border border-white/22 bg-white/14 px-4 py-3 text-white", className)}
      {...rest}
    />
  );
}
