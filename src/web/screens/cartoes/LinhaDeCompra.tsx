import type { ReactNode } from "react";
import { Link } from "react-router";
import type { CompraDaLista } from "../../../shared/api/cards";
import { relativeDayPt } from "../../../shared/format/dates";
import { HiddenItem } from "../../components/ui/hidden-item";
import { Money } from "../../components/ui/money";

// Uma compra ou estorno da fatura (TASK-0402): nome; contexto; valor. A compra sai sem sinal; só o estorno leva o "−",
// em verde, com "estorno" no lugar da categoria. Parcelada mostra "parcela k de n" no lugar da categoria. Sem categoria
// aparece "Revisar categoria" em laranja: na lista de compras é o contexto inteiro ("Revisar categoria"); no detalhe do
// cartão vem depois da data ("DD/MM · Revisar categoria"). Oculto vai para o item tracejado, com o valor riscado.
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
  const parcelada = compra.installmentNumber !== null && compra.installmentTotal !== null;
  const data = relativeDayPt(compra.localDate, hoje);
  const banco = mostrarBanco ? compra.cardLabel : undefined;
  const semCategoria = !estorno && !parcelada && compra.uncategorized;
  const revisar = <span className="text-warn">Revisar categoria</span>;

  let categoria: ReactNode;
  if (estorno) categoria = "estorno";
  else if (parcelada) categoria = `parcela ${compra.installmentNumber} de ${compra.installmentTotal}`;
  else if (semCategoria) categoria = revisar;
  else categoria = compra.categoryName ?? "";

  // Na lista, a compra sem categoria mostra só "Revisar categoria" (sem data nem banco).
  const contexto =
    mostrarBanco && semCategoria ? (
      revisar
    ) : (
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
        <Money cents={Math.abs(compra.amountCents)} sign="none" className="shrink-0" struck={compra.hidden} />
      )}
    </Link>
  );

  if (compra.hidden) return <HiddenItem reason="gasto_terceiros">{conteudo}</HiddenItem>;
  return conteudo;
}
