import { Link } from "react-router";
import { cn } from "@/lib/utils";
import type { DetalheDaCompra } from "../../../shared/api/transactions";
import type { Aba } from "../../app/frame/aba";
import { IconeSetaDireita } from "../../components/icons";
import { textoDaCategoria } from "./view-model";

// Cartão da categoria (TASK-0403): leva ao seletor com a compra, e volta para cá. Sem categoria, fundo verde-claro e
// "revisar" em laranja, como no protótipo. Com categoria, fundo branco e "Toque para trocar".
// O seletor entra com replace: a compra sai do histórico enquanto ele está aberto, e volta no lugar dela (F2).
export function CategoryCard({
  detalhe,
  aba,
  temHistorico,
}: {
  detalhe: DetalheDaCompra;
  aba: Aba | null;
  temHistorico: boolean;
}) {
  const texto = textoDaCategoria(detalhe);
  const voltar = `/compras/${encodeURIComponent(detalhe.id)}`;
  const destino = `/categorias/escolher?${new URLSearchParams({ transacao: detalhe.id, voltar }).toString()}`;

  return (
    <Link
      to={destino}
      replace
      state={{ ...(aba !== null ? { fromTab: aba } : {}), temHistorico }}
      className={cn(
        "flex min-h-[76px] items-center justify-between gap-3 rounded-card border px-[22px] py-4 text-ink transition-colors",
        texto.semCategoria
          ? "border-primary-soft-2 bg-primary-soft"
          : "border-transparent bg-card shadow-card",
      )}
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-[12px] font-semibold text-ink-3">Categoria</span>
        {/* 19 px em negrito é texto grande: o laranja #C27400 sobre o verde-claro passa de 3:1 (AA para texto grande). */}
        <span className={cn("break-words text-[19px] font-extrabold", texto.semCategoria && "text-warn")}>
          {texto.nome}
        </span>
        <span className="text-[12px] text-ink-3">{texto.sub}</span>
      </span>
      <IconeSetaDireita size={20} className="shrink-0 text-primary" />
    </Link>
  );
}
