import type { ButtonHTMLAttributes, MouseEvent } from "react";
import { IconeCarregando } from "@/components/icons";
import { cn } from "@/lib/utils";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  full?: boolean;
  loading?: boolean;
};

// Pílula de 52 px. Carregando: mantém o rótulo, mostra o giro e ignora cliques.
export function Button({
  variant = "primary",
  full = false,
  loading = false,
  className,
  onClick,
  type = "button",
  children,
  ...rest
}: Props) {
  function aoClicar(evento: MouseEvent<HTMLButtonElement>) {
    if (loading) {
      evento.preventDefault();
      return;
    }
    onClick?.(evento);
  }

  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      onClick={aoClicar}
      className={cn(
        "inline-flex h-[52px] items-center justify-center gap-2 rounded-full px-6 transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none",
        variant === "primary" &&
          "bg-primary text-[13px] font-extrabold uppercase tracking-[1.2px] text-white shadow-primary",
        variant === "secondary" &&
          "border-[1.5px] border-primary bg-transparent text-[15px] font-semibold text-primary",
        full && "w-full",
        className,
      )}
      {...rest}
    >
      {loading && <IconeCarregando size={16} className="animate-spin motion-reduce:animate-none" />}
      {children}
    </button>
  );
}
