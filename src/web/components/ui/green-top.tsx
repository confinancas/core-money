import type { ReactNode } from "react";
import { IconeFechar, IconeSeta } from "@/components/icons";
import { cn } from "@/lib/utils";
import { TopIconButton } from "./top-icon-button";

type Rota = { to: string; label: string };

type Props = {
  variant?: "tab" | "detail" | "form";
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  back?: Rota;
  close?: Rota;
  // Mais 70 px de respiro embaixo, para o cartão de baixo sobrepor a faixa.
  overlap?: boolean;
};

// Topo verde. tab: título de aba com ações à direita; detail: seta e título centrado no celular
// (à esquerda a partir do tablet); form: X no lugar da seta.
export function GreenTop({ variant = "tab", title, eyebrow, actions, back, close, overlap = false }: Props) {
  const aba = variant === "tab";

  return (
    <header
      className={cn(
        "bg-(image:--gradient-top) px-6 pt-6 text-white shadow-top tablet:px-10",
        variant === "form" ? "rounded-b-[30px]" : "rounded-b-top",
        overlap ? "pb-[94px]" : "pb-6",
      )}
    >
      {aba ? (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {eyebrow && <p className="text-[13px] font-semibold text-white/82">{eyebrow}</p>}
            <h1 className="text-[30px] font-extrabold tracking-[-0.5px]">{title}</h1>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          {back ? (
            <TopIconButton label={back.label} to={back.to} icon={<IconeSeta />} />
          ) : close ? (
            <TopIconButton label={close.label} to={close.to} icon={<IconeFechar />} />
          ) : (
            <span aria-hidden="true" className="size-11 shrink-0" />
          )}
          <h1 className="flex-1 text-center text-[18px] font-extrabold tablet:text-left tablet:text-[26px]">
            {title}
          </h1>
          {actions ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : (
            <span aria-hidden="true" className="size-11 shrink-0" />
          )}
        </div>
      )}
    </header>
  );
}
