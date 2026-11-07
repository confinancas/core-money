import { Link } from "react-router";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { RostoIA } from "@/components/RostoIA";
import { cn } from "@/lib/utils";
import { brand } from "../../../shared/brand";
import type { Aba } from "./aba";
import { CAMINHO_DA_IA, ITENS_DE_MENU, type ItemDeMenu } from "./nav-items";

// Barra fina do tablet: logo, IA, itens e Configurações no pé.
export function SideRail({ aba, assistente }: { aba: Aba | null; assistente: boolean }) {
  const principais = ITENS_DE_MENU.filter((item) => item.aba !== "configuracoes");
  const configuracoes = ITENS_DE_MENU.find((item) => item.aba === "configuracoes");

  return (
    <aside className="sticky top-0 z-[3] flex h-dvh w-24 shrink-0 flex-col items-center bg-white pt-[26px] pb-[30px] shadow-[8px_0_30px_rgba(22,60,45,0.06)]">
      <Link to="/inicio" aria-label={`${brand.name}, início`} className="mb-[26px] flex">
        <BrandIcon className="size-[46px]" />
      </Link>
      {assistente && (
        <Link
          to={CAMINHO_DA_IA}
          aria-label={`Assistente de IA do ${brand.name}`}
          aria-current={aba === "ia" ? "page" : undefined}
          className="mb-3.5 flex size-[66px] shrink-0 items-center justify-center overflow-hidden rounded-full border-[3px] border-white bg-ai-bg shadow-[0_10px_24px_rgba(4,60,38,0.35)]"
        >
          <RostoIA tamanho={60} />
        </Link>
      )}
      <nav aria-label="Navegação principal" className="flex min-h-0 flex-1 flex-col items-center gap-1">
        {principais.map((item) => (
          <ItemDaBarra key={item.aba} item={item} ativo={aba === item.aba} />
        ))}
        <span className="flex-1" />
        {configuracoes && <ItemDaBarra item={configuracoes} ativo={aba === "configuracoes"} />}
      </nav>
    </aside>
  );
}

function ItemDaBarra({ item, ativo }: { item: ItemDeMenu; ativo: boolean }) {
  const { caminho, rotuloAcessivel, Icone } = item;
  return (
    <Link
      to={caminho}
      aria-label={rotuloAcessivel}
      aria-current={ativo ? "page" : undefined}
      className={cn(
        "flex min-h-[52px] w-[60px] items-center justify-center no-underline",
        ativo ? "text-primary" : "text-nav-idle",
      )}
    >
      <span
        className={cn(
          "flex h-[46px] w-[52px] items-center justify-center rounded-[23px]",
          ativo && "bg-primary-soft",
        )}
      >
        <Icone size={24} />
      </span>
    </Link>
  );
}
