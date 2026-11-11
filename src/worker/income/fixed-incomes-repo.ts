import type {
  Arrival,
  Currency,
  ExistingFixedIncome,
  FixedIncomeDto,
  FixedIncomesResponse,
  FixedIncomeValues,
} from "../../shared/fixed-incomes";
import type { Db } from "../db/client";

// Rendas fixas do lar (TASK-0901). Uma consulta para as ativas, com as somas por moeda na mesma consulta (janela sobre
// as linhas filtradas), para o GET ser uma chamada ao D1. As somas não passam por JavaScript.
export type LinhaDaRendaFixa = {
  id: string;
  name: string;
  currency: string;
  amount_cents: number;
  usual_day: number;
  arrival: string;
  statement_text: string | null;
  kept_usd_is_investment: number;
  brl_total_cents: number;
  usd_total_cents: number;
};

const SQL_ATIVAS = `SELECT id, name, currency, amount_cents, usual_day, arrival, statement_text, kept_usd_is_investment,
    SUM(CASE WHEN currency = 'BRL' THEN amount_cents ELSE 0 END) OVER () AS brl_total_cents,
    SUM(CASE WHEN currency = 'USD' THEN amount_cents ELSE 0 END) OVER () AS usd_total_cents
  FROM fixed_incomes WHERE household_id = ? AND archived_at IS NULL
  ORDER BY name COLLATE NOCASE`;

const SQL_INSERIR = `INSERT INTO fixed_incomes (id, household_id, name, currency, amount_cents, usual_day, arrival,
    statement_text, kept_usd_is_investment, archived_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`;

const SQL_ATUALIZAR = `UPDATE fixed_incomes SET name = ?, currency = ?, amount_cents = ?, usual_day = ?, arrival = ?,
    statement_text = ?, kept_usd_is_investment = ?
  WHERE id = ? AND household_id = ? AND archived_at IS NULL`;

const SQL_ARQUIVAR = `UPDATE fixed_incomes SET archived_at = ? WHERE id = ? AND household_id = ? AND archived_at IS NULL`;

export async function lerRendasAtivas(db: Db, householdId: string): Promise<LinhaDaRendaFixa[]> {
  const resultado = await db.$client.prepare(SQL_ATIVAS).bind(householdId).all<LinhaDaRendaFixa>();
  return resultado.results ?? [];
}

export const paraExistentes = (linhas: LinhaDaRendaFixa[]): ExistingFixedIncome[] =>
  linhas.map((linha) => ({ id: linha.id, name: linha.name }));

export function paraDto(linha: {
  id: string;
  name: string;
  currency: string;
  amount_cents: number;
  usual_day: number;
  arrival: string;
  statement_text: string | null;
  kept_usd_is_investment: number;
}): FixedIncomeDto {
  return {
    id: linha.id,
    name: linha.name,
    currency: linha.currency as Currency,
    amountCents: linha.amount_cents,
    usualDay: linha.usual_day,
    arrival: linha.arrival as Arrival,
    statementText: linha.statement_text,
    keptUsdIsInvestment: linha.kept_usd_is_investment === 1,
    lastFx: null,
  };
}

export function montaResposta(linhas: LinhaDaRendaFixa[]): FixedIncomesResponse {
  // As somas são as mesmas em todas as linhas (a janela é do conjunto inteiro); sem linhas, não há soma a ler.
  const primeira = linhas[0];
  return {
    fixedIncomes: linhas.map(paraDto),
    expectedPerCycle: {
      brlCents: primeira?.brl_total_cents ?? 0,
      usdCents: primeira?.usd_total_cents ?? 0,
      usdInBrlCents: null,
    },
  };
}

export async function criarRendaFixa(
  db: Db,
  householdId: string,
  id: string,
  valores: FixedIncomeValues,
): Promise<void> {
  await db.$client
    .prepare(SQL_INSERIR)
    .bind(
      id,
      householdId,
      valores.name,
      valores.currency,
      valores.amountCents,
      valores.usualDay,
      valores.arrival,
      valores.statementText,
      valores.keptUsdIsInvestment ? 1 : 0,
    )
    .run();
}

// Falso quando a renda não existe no lar, está arquivada ou foi arquivada entre a leitura e a escrita.
export async function atualizarRendaFixa(
  db: Db,
  householdId: string,
  id: string,
  valores: FixedIncomeValues,
): Promise<boolean> {
  const resultado = await db.$client
    .prepare(SQL_ATUALIZAR)
    .bind(
      valores.name,
      valores.currency,
      valores.amountCents,
      valores.usualDay,
      valores.arrival,
      valores.statementText,
      valores.keptUsdIsInvestment ? 1 : 0,
      id,
      householdId,
    )
    .run();
  return (resultado.meta?.changes ?? 0) === 1;
}

export async function arquivarRendaFixa(
  db: Db,
  householdId: string,
  id: string,
  agora: Date,
): Promise<boolean> {
  const resultado = await db.$client.prepare(SQL_ARQUIVAR).bind(agora.toISOString(), id, householdId).run();
  return (resultado.meta?.changes ?? 0) === 1;
}
