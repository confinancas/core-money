import { Link } from "react-router";
import { RostoIA } from "@/components/RostoIA";
import { cn } from "@/lib/utils";
import { brand } from "../../../shared/brand";
import type { Aba } from "./aba";
import { CAMINHO_DA_IA, ITENS_DE_MENU, type ItemDeMenu } from "./nav-items";

// Menu do celular: barra de baixo, só ícones, com a IA levantada no meio. Sem o assistente, seis colunas e sem a IA.
export function BottomNav({ aba, assistente }: { aba: Aba | null; assistente: boolean }) {
  const antes = ITENS_DE_MENU.slice(0, 3);
  const depois = ITENS_DE_MENU.slice(3);

  return (
    <nav
      aria-label="Navegação principal"
      className={cn(
        "fixed inset-x-0 bottom-0 z-20 grid items-start rounded-t-[26px] bg-white px-1.5 pt-3 pb-[max(26px,env(safe-area-inset-bottom))] shadow-[0_-8px_28px_rgba(22,60,45,0.08)]",
        assistente ? "grid-cols-7" : "grid-cols-6",
      )}
    >
      {antes.map((item) => (
        <ItemDoCelular key={item.aba} item={item} ativo={aba === item.aba} />
      ))}
      {assistente && (
        <Link
          to={CAMINHO_DA_IA}
          aria-label={`Assistente de IA do ${brand.name}`}
          aria-current={aba === "ia" ? "page" : undefined}
          className="-mt-[45px] flex size-[66px] items-center justify-center justify-self-center overflow-hidden rounded-full border-[3px] border-white bg-ai-bg shadow-[0_10px_24px_rgba(4,60,38,0.35)]"
        >
          <RostoIA tamanho={60} />
        </Link>
      )}
      {depois.map((item) => (
        <ItemDoCelular key={item.aba} item={item} ativo={aba === item.aba} />
      ))}
    </nav>
  );
}

function ItemDoCelular({ item, ativo }: { item: ItemDeMenu; ativo: boolean }) {
  const { caminho, rotuloAcessivel, Icone } = item;
  return (
    <Link
      to={caminho}
      aria-label={rotuloAcessivel}
      aria-current={ativo ? "page" : undefined}
      className={cn(
        "flex min-h-12 items-center justify-center no-underline",
        ativo ? "text-primary" : "text-nav-idle",
      )}
    >
      <span
        className={cn(
          "flex h-10 w-11 items-center justify-center rounded-[20px]",
          ativo && "bg-primary-soft",
        )}
      >
        <Icone size={24} />
      </span>
    </Link>
  );
}
