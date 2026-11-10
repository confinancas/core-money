import type { KeyboardEvent, ReactNode } from "react";
import { barHeightPx } from "./scale";

// Gráfico de barras em SVG próprio (TASK-0402; reaproveitado pela TASK-1001). Sem biblioteca: as cores e as formas
// são as do protótipo. Cada barra clicável é um alvo de 62 px de largura por 150 de altura (acima dos 44 px), com
// teclado. A linha laranja liga os topos quando line é true.

export type VariantDaBarra = "closed" | "open" | "future" | "empty";

export type BarraDoGrafico = {
  key: string;
  label: string;
  valueCents: number;
  variant: VariantDaBarra;
  selected: boolean;
  ariaLabel: string;
};

type Props = {
  bars: BarraDoGrafico[];
  maxCents: number;
  line?: boolean;
  onPick?: (key: string) => void;
  badge?: { key: string; text: string };
  ariaLabel: string;
};

const LARGURA = 310;
const ALTURA = 150;
const BASE = 140;
const LARGURA_DA_BARRA = 32;
const ALTURA_MAXIMA = 120;
const ALTURA_MINIMA = 6;
const RAIO = 6;
const COR_FECHADA = "#B3E2CA";
const COR_FECHADA_SELECIONADA = "#0E9A63";
const COR_DA_LINHA = "#F7931E";

function caminhoDaBarra(x: number, y: number): string {
  const r = Math.min(RAIO, (BASE - y) / 2);
  return `M${x} ${BASE} V${y + r} Q${x} ${y} ${x + r} ${y} H${x + LARGURA_DA_BARRA - r} Q${x + LARGURA_DA_BARRA} ${y} ${x + LARGURA_DA_BARRA} ${y + r} V${BASE} Z`;
}

function estiloDaBarra(
  variant: VariantDaBarra,
  selecionada: boolean,
): { fill: string; stroke?: string; strokeWidth?: number; dasharray?: string } {
  if (variant === "closed") return { fill: selecionada ? COR_FECHADA_SELECIONADA : COR_FECHADA };
  if (variant === "open" || variant === "future") {
    return selecionada
      ? { fill: "#C8EBD8", stroke: "#0E9A63", strokeWidth: 2, dasharray: "4 3" }
      : { fill: "#FFFFFF", stroke: "#0E9A63", strokeWidth: 1.5, dasharray: "4 3" };
  }
  return { fill: "none" };
}

export function MonthBars({ bars, maxCents, line = false, onPick, badge, ariaLabel }: Props) {
  const espacamento = LARGURA / Math.max(bars.length, 1);
  const posicoes = bars.map((barra, indice) => {
    const cx = espacamento * (indice + 0.5);
    const altura =
      barra.variant === "empty" ? 0 : barHeightPx(barra.valueCents, maxCents, ALTURA_MAXIMA, ALTURA_MINIMA);
    return { cx, topo: BASE - altura };
  });
  const pontos = bars
    .map((barra, indice) =>
      barra.variant === "empty" ? null : `${posicoes[indice]?.cx ?? 0},${posicoes[indice]?.topo ?? BASE}`,
    )
    .filter((ponto): ponto is string => ponto !== null);

  return (
    <figure aria-label={ariaLabel} className="m-0">
      <svg viewBox={`0 0 ${LARGURA} ${ALTURA}`} className="block w-full overflow-visible">
        <title>{ariaLabel}</title>
        {bars.map((barra, indice) => {
          const pos = posicoes[indice];
          if (!pos) return null;
          const conteudo = (
            <>
              {barra.variant !== "empty" && onPick !== undefined && (
                <rect
                  x={pos.cx - espacamento / 2}
                  y={0}
                  width={espacamento}
                  height={ALTURA}
                  fill="transparent"
                />
              )}
              {barra.variant !== "empty" && (
                <path
                  d={caminhoDaBarra(pos.cx - LARGURA_DA_BARRA / 2, pos.topo)}
                  {...estiloDaBarra(barra.variant, barra.selected)}
                />
              )}
              <text
                x={pos.cx}
                y={ALTURA - 2}
                textAnchor="middle"
                className="fill-ink-2 text-[11px] font-bold"
              >
                {barra.label}
              </text>
              {badge !== undefined && badge.key === barra.key && barra.variant !== "empty" && (
                <text
                  x={pos.cx}
                  y={pos.topo - 6}
                  textAnchor="middle"
                  className="fill-primary-ink text-[10px] font-extrabold"
                >
                  {badge.text}
                </text>
              )}
            </>
          );

          if (barra.variant !== "empty" && onPick !== undefined) {
            return (
              // biome-ignore lint/a11y/useSemanticElements: SVG não tem <button>; o alvo é um grupo com papel de botão.
              <g
                key={barra.key}
                role="button"
                tabIndex={0}
                aria-label={barra.ariaLabel}
                aria-pressed={barra.selected}
                onClick={() => onPick(barra.key)}
                onKeyDown={teclaDaBarra(barra.key, onPick)}
                className="cursor-pointer outline-none"
              >
                {conteudo}
              </g>
            );
          }
          return <g key={barra.key}>{conteudo}</g>;
        })}
        {line && pontos.length > 1 && (
          <polyline points={pontos.join(" ")} fill="none" stroke={COR_DA_LINHA} strokeWidth={2} />
        )}
        {line && bolinhas(bars, posicoes)}
      </svg>
    </figure>
  );
}

// Enter e espaço acionam a barra, como o clique.
function teclaDaBarra(key: string, aoEscolher: (key: string) => void) {
  return (evento: KeyboardEvent<SVGGElement>) => {
    if (evento.key === "Enter" || evento.key === " ") {
      evento.preventDefault();
      aoEscolher(key);
    }
  };
}

// Um ponto branco com contorno laranja no topo de cada barra com valor.
function bolinhas(
  bars: readonly BarraDoGrafico[],
  posicoes: readonly { cx: number; topo: number }[],
): ReactNode[] {
  return bars.flatMap((barra, indice) => {
    const pos = posicoes[indice];
    if (!pos || barra.variant === "empty") return [];
    return [
      <circle
        key={`ponto-${barra.key}`}
        cx={pos.cx}
        cy={pos.topo}
        r={3.5}
        fill="#FFFFFF"
        stroke={COR_DA_LINHA}
        strokeWidth={2}
      />,
    ];
  });
}
