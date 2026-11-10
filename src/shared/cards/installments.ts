// Parcelas futuras e janela do gráfico de faturas (TASK-0402). Puro: sem banco, sem relógio. O cálculo que soma as
// faturas futuras é este; a tela e a API só o usam.

import { addMonthsClamped } from "../cycle";

// Uma compra parcelada da fatura-base. amountCents é o do banco (negativo na saída); o valor da parcela é o módulo.
export type LinhaParcelada = {
  name: string;
  installmentNumber: number;
  installmentTotal: number;
  amountCents: number;
  // Oculto (gasto de terceiros) não projeta parcela: não entra em nenhum cálculo.
  hidden: boolean;
};

export type ItemDeParcela = { name: string; installment: number; of: number };

export type FaturaProjetada = {
  cycleKey: string;
  closesOn: string;
  dueOn: string | null;
  totalCents: number;
  items: ItemDeParcela[];
};

export type FaturaBase = { closesOn: string; dueOn: string | null };

// Parcelas que caem nas faturas seguintes à base. Para a parcela k de n na base, as parcelas k+1 … n caem nas faturas
// base+1 … base+(n−k), com o mesmo valor. Fatura j: fecha e vence no mesmo dia da base, j meses depois (preso ao último
// dia do mês). cicloDe diz a chave do ciclo de uma data de fechamento (o calendário do lar, com o padrão por trás).
export function projectFutureBills(
  base: FaturaBase | null,
  linhas: readonly LinhaParcelada[],
  cicloDe: (data: string) => string,
): FaturaProjetada[] {
  if (base === null) return [];

  const porMes = new Map<number, { totalCents: number; items: ItemDeParcela[] }>();
  for (const linha of linhas) {
    const { installmentNumber: k, installmentTotal: n } = linha;
    if (linha.hidden || !(n > k)) continue;
    const valor = Math.abs(linha.amountCents);
    for (let j = 1; j <= n - k; j++) {
      const grupo = porMes.get(j) ?? { totalCents: 0, items: [] };
      grupo.totalCents += valor;
      grupo.items.push({ name: linha.name, installment: k + j, of: n });
      porMes.set(j, grupo);
    }
  }

  return [...porMes.keys()]
    .sort((a, b) => a - b)
    .map((j) => {
      const grupo = porMes.get(j);
      const closesOn = addMonthsClamped(base.closesOn, j);
      return {
        cycleKey: cicloDe(closesOn),
        closesOn,
        dueOn: base.dueOn === null ? null : addMonthsClamped(base.dueOn, j),
        totalCents: grupo?.totalCents ?? 0,
        items: (grupo?.items ?? []).sort(
          (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || a.installment - b.installment,
        ),
      };
    });
}

// As 5 posições do gráfico: a selecionada no meio, duas antes e duas depois. Fora da série vira null (posição vazia).
export function billsWindow<T>(bills: readonly T[], selected: number): (T | null)[] {
  return [-2, -1, 0, 1, 2].map((deslocamento) => bills[selected + deslocamento] ?? null);
}
