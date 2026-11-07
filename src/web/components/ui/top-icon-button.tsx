import type { MouseEventHandler, ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  icon: ReactNode;
  // Número no canto. Zero some; acima de 9 mostra "9+".
  badge?: number;
  pressed?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  // Com `to`, vira um Link do react-router (navega dentro do app, sem recarregar a página).
  to?: string;
  // Estado que vai junto com o Link (location.state), como o `fromTab` das telas de detalhe.
  state?: unknown;
};

// Botão redondo de 44 px sobre o verde do topo.
export function TopIconButton({ label, icon, badge = 0, pressed, onClick, to, state }: Props) {
  const estilo = cn(
    "relative inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-white/28 bg-white/18 text-white",
  );
  const conteudo = (
    <>
      {icon}
      {badge > 0 && (
        <span className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-badge-ring bg-badge px-1 text-[10px] font-black text-white">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </>
  );

  if (to !== undefined) {
    return (
      <Link to={to} state={state} aria-label={label} className={estilo}>
        {conteudo}
      </Link>
    );
  }

  return (
    <button type="button" aria-label={label} aria-pressed={pressed} onClick={onClick} className={estilo}>
      {conteudo}
    </button>
  );
}
