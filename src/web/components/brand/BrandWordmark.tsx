import { cn } from "@/lib/utils";
import { brand } from "../../../shared/brand";

// Nome da marca em duas cores (as partes vêm do marca.json), Nunito 900. O tamanho vem de className.
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("whitespace-nowrap font-black tracking-[-0.4px]", className)}>
      <span style={{ color: brand.colors.wordmarkA }}>{brand.wordmark[0]}</span>
      <span style={{ color: brand.colors.wordmarkB }}>{brand.wordmark[1]}</span>
    </span>
  );
}
