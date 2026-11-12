import type {
  Arrival,
  Currency,
  ExistingFixedIncome,
  FixedIncomeDto,
  FixedIncomesResponse,
  FixedIncomeValues,
} from "../../shared/fixed-incomes";
import { type UltimaCotacao, ultimaCotacao, usdInBrlCents } from "../../shared/income";
import type { Db } from "../db/client";

// Cotação de cada renda: a do recebimento mais recente que tem cotação (TASK-0902). Uma leitura para o lar inteiro.
const SQL_ULTIMAS_COTACOES = `SELECT r.fixed_income_id AS fixed_income_id, r.fx_rate AS fx_rate, r.fx_date AS fx_date
  FROM fixed_income_receipts AS r
  JOIN fixed_incomes AS f ON f.id = r.fixed_income_id
  WHERE f.household_id = ? AND f.archived_at IS NULL AND r.fx_rate IS NOT NULL
  ORDER BY r.fx_date DESC, r.received_on DESC`;

type LinhaDeCotacao = { fixed_income_id: string; fx_rate: number; fx_date: string };

// A primeira linha de cada renda é a mais recente (a consulta ordena por dia de cotação).
function mapaDasCotacoes(linhas: readonly LinhaDeCotacao[]): Map<string, UltimaCotacao> {
  const porRenda = new Map<string, UltimaCotacao>();
  for (const linha of linhas) {
    if (porRenda.has(linha.fixed_income_id)) continue;
    porRenda.set(linha.fixed_income_id, ultimaCotacao(linha.fx_rate, linha.fx_date));
  }
  return porRenda;
}

export async function lerUltimasCotacoes(db: Db, householdId: string): Promise<Map<string, UltimaCotacao>> {
  const resultado = await db.$client.prepare(SQL_ULTIMAS_COTACOES).bind(householdId).all<LinhaDeCotacao>();
  return mapaDasCotacoes(resultado.results ?? []);
}

// O GET da tela: as rendas ativas e as cotações, em uma ida ao D1 (db.batch).
export async function lerTelaDeRendas(
  db: Db,
  householdId: string,
): Promise<{ linhas: LinhaDaRendaFixa[]; ultimas: Map<string, UltimaCotacao> }> {
  const [ativas, cotacoes] = await db.$client.batch([
    db.$client.prepare(SQL_ATIVAS).bind(householdId),
    db.$client.prepare(SQL_ULTIMAS_COTACOES).bind(householdId),
  ]);
  return {
    linhas: (ativas?.results ?? []) as LinhaDaRendaFixa[],
    ultimas: mapaDasCotacoes((cotacoes?.results ?? []) as LinhaDeCotacao[]),
  };
}

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

export function paraDto(
  linha: {
    id: string;
    name: string;
    currency: string;
    amount_cents: number;
    usual_day: number;
    arrival: string;
    statement_text: string | null;
    kept_usd_is_investment: number;
  },
  ultima: UltimaCotacao | null = null,
): FixedIncomeDto {
  return {
    id: linha.id,
    name: linha.name,
    currency: linha.currency as Currency,
    amountCents: linha.amount_cents,
    usualDay: linha.usual_day,
    arrival: linha.arrival as Arrival,
    statementText: linha.statement_text,
    keptUsdIsInvestment: linha.kept_usd_is_investment === 1,
    lastFx: ultima,
  };
}

// O previsto do lar: as somas por moeda vêm da consulta (janela); o dólar em real soma a cotação de cada renda.
export function montaResposta(
  linhas: LinhaDaRendaFixa[],
  ultimas: ReadonlyMap<string, UltimaCotacao> = new Map(),
): FixedIncomesResponse {
  // As somas são as mesmas em todas as linhas (a janela é do conjunto inteiro); sem linhas, não há soma a ler.
  const primeira = linhas[0];
  return {
    fixedIncomes: linhas.map((linha) => paraDto(linha, ultimas.get(linha.id) ?? null)),
    expectedPerCycle: {
      brlCents: primeira?.brl_total_cents ?? 0,
      usdCents: primeira?.usd_total_cents ?? 0,
      usdInBrlCents: usdInBrlCents(
        linhas.map((linha) => ({
          currency: linha.currency === "USD" ? "USD" : "BRL",
          amountCents: linha.amount_cents,
          ultima: ultimas.get(linha.id) ?? null,
        })),
      ),
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
