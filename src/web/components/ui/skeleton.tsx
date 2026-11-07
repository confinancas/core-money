import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Card } from "./card";

// Bloco que pulsa (CSS mm-esqueleto); com movimento reduzido, fica parado.
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("mm-esqueleto h-4 rounded-tile", className)} />;
}

// Esqueleto no formato de um cartão da tela.
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <Card role="status" aria-label="Carregando" className={cn("flex flex-col gap-3", className)}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-10 w-2/3" />
      <Skeleton />
    </Card>
  );
}

// Fica true só depois de `atrasoMs` seguidos com `ligado`; uma carga mais curta não chega a mostrar nada.
export function useDelayedFlag(ligado: boolean, atrasoMs: number): boolean {
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (!ligado) {
      setVisivel(false);
      return;
    }
    const temporizador = setTimeout(() => setVisivel(true), atrasoMs);
    return () => clearTimeout(temporizador);
  }, [ligado, atrasoMs]);

  return visivel;
}
