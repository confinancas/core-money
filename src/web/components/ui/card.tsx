import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props = HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "insight";
  // Sobe 44 px sobre a faixa verde do topo.
  overlap?: boolean;
};

export function Card({ variant = "default", overlap = false, className, ...rest }: Props) {
  return (
    <div
      className={cn(
        "rounded-card px-[22px] py-5",
        variant === "default" && "bg-card shadow-card",
        variant === "insight" && "bg-insight text-white shadow-insight",
        overlap && "-mt-11",
        className,
      )}
      {...rest}
    />
  );
}
