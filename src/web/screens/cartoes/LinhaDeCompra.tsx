import type { ReactNode } from "react";
import { Link } from "react-router";
import type { CompraDaLista } from "../../../shared/api/cards";
import { relativeDayPt } from "../../../shared/format/dates";
import { HiddenItem } from "../../components/ui/hidden-item";
import { Money } from "../../components/ui/money";

// Uma compra ou estorno da fatura (TASK-0402): nome; contexto "Hoje · banco · categoria" (ou só a categoria, na
// detalhe do cartão); valor. Estorno em verde, com "−" e "estorno" no lugar da categoria. Parcelada mostra
// "parcela k de n". Sem categoria: "Revisar categoria" em laranja. Oculto vai para o item tracejado, riscado.
export function LinhaDeCompra({
  compra,
  hoje,
  mostrarBanco,
}: {
  compra: CompraDaLista;
  hoje: string;
  mostrarBanco: boolean;
}) {
  const estorno = compra.movement === "estorno";
  const data = relativeDayPt(compra.localDate, hoje);
  const banco = mostrarBanco ? compra.cardLabel : undefined;

  let categoria: ReactNode;
  if (estorno) categoria = "estorno";
  else if (compra.installmentNumber !== null && compra.installmentTotal !== null) {
    categoria = `parcela ${compra.installmentNumber} de ${compra.installmentTotal}`;
  } else if (compra.uncategorized) categoria = <span className="text-warn">Revisar categoria</span>;
  else categoria = compra.categoryName ?? "";

  const contexto = (
    <>
      {data}
      {banco !== undefined && <> · {banco}</>} · {categoria}
    </>
  );

  const conteudo = (
    <Link
      to={`/compras/${encodeURIComponent(compra.id)}`}
      className="flex min-h-11 items-center justify-between gap-3 rounded-field py-2 text-ink"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold">{compra.name}</span>
        <span className="block text-[13px] text-ink-2">{contexto}</span>
      </span>
      {estorno ? (
        <Money cents={-Math.abs(compra.amountCents)} className="shrink-0 text-success-ink" />
      ) : (
        <Money cents={compra.amountCents} className="shrink-0" struck={compra.hidden} />
      )}
    </Link>
  );

  if (compra.hidden) return <HiddenItem reason="gasto_terceiros">{conteudo}</HiddenItem>;
  return conteudo;
}
