import type { ReactNode } from "react";
import { IconeCaixa } from "@/components/icons";
import { cn } from "@/lib/utils";
import { Card } from "./card";

type Props = {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  // Normalmente um Button secundário.
  action?: ReactNode;
  className?: string;
};

// Estado vazio dentro de um cartão: ícone num círculo, título, texto e uma ação.
export function EmptyState({ icon, title, description, action, className }: Props) {
  return (
    <Card className={cn("flex flex-col items-center gap-3 text-center", className)}>
      <div className="flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
        {icon ?? <IconeCaixa size={26} />}
      </div>
      <h2 className="text-[16px] font-extrabold text-ink">{title}</h2>
      {description && <p className="text-[14px] text-ink-2">{description}</p>}
      {action}
    </Card>
  );
}
