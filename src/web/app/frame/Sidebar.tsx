import { Link } from "react-router";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { BrandWordmark } from "@/components/brand/BrandWordmark";
import { RostoIA } from "@/components/RostoIA";
import { cn } from "@/lib/utils";
import { brand } from "../../../shared/brand";
import type { Aba } from "./aba";
import type { MembroDoLar } from "./frame-data";
import { HouseholdFooter } from "./HouseholdFooter";
import { CAMINHO_DA_IA, ITENS_DE_MENU } from "./nav-items";

// Barra de 252 px do desktop: logo e nome, cartão do Assistente, itens com nome e rodapé do lar.
export function Sidebar({
  aba,
  assistente,
  membros,
}: {
  aba: Aba | null;
  assistente: boolean;
  membros: MembroDoLar[] | null;
}) {
  return (
    <aside className="sticky top-0 z-[3] flex h-dvh w-[252px] shrink-0 flex-col bg-white px-[18px] pt-[26px] pb-6 shadow-[8px_0_30px_rgba(22,60,45,0.06)]">
      <Link
        to="/inicio"
        aria-label={`${brand.name}, início`}
        className="flex items-center gap-2.5 px-2 pb-[22px] no-underline"
      >
        <BrandIcon className="size-[38px]" />
        <BrandWordmark className="text-[21px]" />
      </Link>

      {assistente && (
        <Link
          to={CAMINHO_DA_IA}
          aria-label={`Assistente de IA do ${brand.name}`}
          aria-current={aba === "ia" ? "page" : undefined}
          className="flex items-center gap-3 rounded-[22px] bg-(image:--gradient-assistente) py-3 pr-3.5 pl-3 text-white no-underline shadow-[0_10px_24px_rgba(4,60,38,0.28)]"
        >
          <span className="flex size-[50px] shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-ai-bg">
            <RostoIA tamanho={46} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[15px] font-extrabold">Assistente</span>
            <span className="text-[12px] text-white/80">{brand.texts.assistantCta}</span>
          </span>
        </Link>
      )}

      <nav aria-label="Navegação principal" className="mt-4 flex flex-col gap-1">
        {ITENS_DE_MENU.map(({ aba: id, caminho, nome, rotuloAcessivel, Icone }) => {
          const ativo = aba === id;
          return (
            <Link
              key={id}
              to={caminho}
              aria-label={rotuloAcessivel}
              aria-current={ativo ? "page" : undefined}
              className={cn(
                "flex min-h-12 items-center gap-3.5 rounded-2xl px-3.5 text-[15px] no-underline",
                ativo ? "bg-primary-soft font-extrabold text-primary-ink" : "font-bold text-ink-nav",
              )}
            >
              <Icone size={22} className={cn("shrink-0", ativo ? "text-primary" : "text-ink-3")} />
              <span>{nome}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto pt-6">
        <HouseholdFooter members={membros} />
      </div>
    </aside>
  );
}
