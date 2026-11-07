import { cn } from "@/lib/utils";

// Ícone do app: o arquivo da pasta pública do app decide qual é (icons/icon.svg). Decorativo: o nome vem do link ou do status em volta.
export function BrandIcon({ className }: { className?: string }) {
  return <img src="/icons/icon.svg" alt="" draggable={false} className={cn("block shrink-0", className)} />;
}
