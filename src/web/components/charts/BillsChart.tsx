import type { FaturaDaSerie } from "../../../shared/api/cards";
import { billsWindow } from "../../../shared/cards/installments";
import { monthAbbrPt, monthNamePt } from "../../../shared/format/dates";
import { formatMoney } from "../../../shared/money";
import { type BarraDoGrafico, MonthBars, type VariantDaBarra } from "./MonthBars";
import { scaleMax } from "./scale";

// Gráfico das faturas do cartão (TASK-0402): cinco posições em volta da fatura selecionada. Fechadas em verde claro;
// aberta e futuras em contorno tracejado. Escala: o maior valor visível com 15% de folga. Posição fora da série fica
// vazia. Quem decide a fatura selecionada é a tela: aqui só se toca numa barra.

const POSICOES = [-2, -1, 0, 1, 2];

function variantDe(fatura: FaturaDaSerie | null): VariantDaBarra {
  if (fatura === null) return "empty";
  if (fatura.status === "fechada" || fatura.status === "paga") return "closed";
  if (fatura.status === "futura") return "future";
  return "open";
}

function rotuloDe(fatura: FaturaDaSerie | null): string {
  if (fatura === null) return "";
  return monthAbbrPt(`${fatura.cycleKey}-01`);
}

export function BillsChart({
  series,
  selecionada,
  onPick,
}: {
  series: readonly FaturaDaSerie[];
  selecionada: number;
  onPick: (indice: number) => void;
}) {
  const janela = billsWindow(series, selecionada);
  const visiveis = janela.filter((fatura): fatura is FaturaDaSerie => fatura !== null);
  const maximo = scaleMax(visiveis.map((fatura) => fatura.totalCents));

  const barras: BarraDoGrafico[] = janela.map((fatura, posicao) => {
    const deslocamento = POSICOES[posicao] ?? 0;
    const indice = selecionada + deslocamento;
    const nome =
      fatura === null
        ? ""
        : `Fatura de ${monthNamePt(fatura.cycleKey)}, ${formatMoney(fatura.totalCents, "none")}`;
    return {
      key: `${indice}`,
      label: rotuloDe(fatura),
      valueCents: fatura?.totalCents ?? 0,
      variant: variantDe(fatura),
      selected: deslocamento === 0,
      ariaLabel: nome,
    };
  });

  return (
    <MonthBars
      bars={barras}
      maxCents={maximo}
      line
      ariaLabel="Faturas do cartão"
      onPick={(key) => onPick(Number(key))}
    />
  );
}
