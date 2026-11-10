// Escala e formatação dos gráficos de barras (TASK-0402; reaproveitados pela TASK-1001). Puro: nada de DOM aqui.

// Teto da escala: o maior valor com uma folga (1,15 por padrão), para a barra mais alta não encostar no topo.
export function scaleMax(valores: readonly number[], folga = 1.15): number {
  const maior = valores.reduce((atual, valor) => Math.max(atual, valor), 0);
  return maior * folga;
}

// Altura da barra em pixels: proporcional ao teto, nunca abaixo de minPx (uma barra pequena continua visível) e
// nunca acima de maxPx. Sem teto (zero), a barra fica no mínimo.
export function barHeightPx(valor: number, maximo: number, maxPx: number, minPx: number): number {
  if (!(maximo > 0) || !(valor > 0)) return minPx;
  const proporcional = (valor / maximo) * maxPx;
  return Math.min(maxPx, Math.max(minPx, proporcional));
}

// Valor compacto em reais, a partir de centavos, com vírgula decimal: "850", "2,9K", "24K", "1,2M".
// Abaixo de mil reais, o inteiro; até um milhão, em mil com uma casa até dez mil; acima, em milhões.
export function compactBRL(cents: number): string {
  const reais = Math.abs(cents) / 100;
  const inteiro = Math.round(reais);
  if (inteiro < 1000) return String(inteiro);
  if (inteiro < 1_000_000) return formataCompacto(reais / 1000, "K");
  return formataCompacto(reais / 1_000_000, "M");
}

function formataCompacto(valor: number, sufixo: string): string {
  const umaCasa = Math.round(valor * 10) / 10;
  if (umaCasa < 10) return `${umaCasa.toFixed(1).replace(".", ",")}${sufixo}`;
  return `${Math.round(valor)}${sufixo}`;
}

// Variação percentual de `atual` contra `anterior`, com uma casa decimal. Sem base (anterior zero), não há variação.
export function pctChange(atual: number, anterior: number): number | null {
  if (anterior === 0) return null;
  return Math.round(((atual - anterior) / Math.abs(anterior)) * 1000) / 10;
}
