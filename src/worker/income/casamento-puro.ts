// Casamento de entradas com as rendas pelo texto do extrato (TASK-0902), puro: sem tipos do Worker, para o teste de
// unidade. As consultas e a escrita ficam em statement-match.ts.

import { normalizeStatementText } from "../../shared/statement-text";

export type RendaDoExtrato = { id: string; statementText: string };

export type CandidataDeEntrada = {
  id: string;
  description: string;
  receivedOn: string;
  cycleKey: string | null;
  amountCents: number;
};

export type Casamento = {
  transactionId: string;
  fixedIncomeId: string;
  cycleKey: string;
  receivedOn: string;
  amountCents: number;
};

// Movimentos que podem ser parte de uma renda: o Pix e a TED recebidos, e o que o banco trouxe sem categoria.
export const MOVIMENTOS_DE_ENTRADA = ["pix_recebido", "ted_recebida", "outro"] as const;

// Quem casa com um texto de extrato: a renda cujo texto aparece nele e é o mais longo. Empate (ou nenhuma) é nulo.
export function casaRendaPeloExtrato(descricao: string, rendas: readonly RendaDoExtrato[]): string | null {
  const texto = normalizeStatementText(descricao);
  const casam = rendas
    .map((renda) => ({ id: renda.id, normal: normalizeStatementText(renda.statementText) }))
    .filter((renda) => renda.normal.length > 0 && texto.includes(renda.normal));
  if (casam.length === 0) return null;
  const maior = Math.max(...casam.map((renda) => renda.normal.length));
  const vencedoras = casam.filter((renda) => renda.normal.length === maior);
  return vencedoras.length === 1 ? (vencedoras[0]?.id ?? null) : null;
}

// Entradas casadas com uma renda, com o ciclo e a data que a transação já tem (o passo 2 do afterIngest vem antes).
export function casamentosDoExtrato(
  candidatas: readonly CandidataDeEntrada[],
  rendas: readonly RendaDoExtrato[],
): Casamento[] {
  const saida: Casamento[] = [];
  for (const candidata of candidatas) {
    if (candidata.cycleKey === null) continue;
    const fixedIncomeId = casaRendaPeloExtrato(candidata.description, rendas);
    if (fixedIncomeId === null) continue;
    saida.push({
      transactionId: candidata.id,
      fixedIncomeId,
      cycleKey: candidata.cycleKey,
      receivedOn: candidata.receivedOn,
      amountCents: candidata.amountCents,
    });
  }
  return saida;
}
