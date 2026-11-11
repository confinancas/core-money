import { type RendaNoCiclo, summarizeCycleIncome, ultimaCotacao } from "../../shared/income";
import type { Db } from "../db/client";

// Renda do ciclo (TASK-0902): um lote de quatro leituras (o ciclo, as rendas do ciclo, os recebimentos com a transação
// e a soma da variável) e a conta pura de src/shared/income.ts. Nada de soma por JavaScript sobre o lar inteiro: só o
// que é do ciclo entra nas leituras.

const SQL_CICLO = "SELECT key, starts_on, ends_on FROM cycles WHERE household_id = ? AND key = ?";

// Rendas ativas, e as arquivadas que têm recebimento no ciclo (o que já foi recebido continua contando no seu ciclo).
const SQL_RENDAS = `SELECT f.id AS id, f.name AS name, f.currency AS currency, f.amount_cents AS amount_cents,
    f.usual_day AS usual_day, f.arrival AS arrival, f.statement_text AS statement_text,
    f.kept_usd_is_investment AS kept_usd_is_investment
  FROM fixed_incomes AS f
  WHERE f.household_id = ? AND (f.archived_at IS NULL OR f.id IN (
    SELECT r.fixed_income_id FROM fixed_income_receipts AS r WHERE r.cycle_key = ?))
  ORDER BY f.name COLLATE NOCASE`;

const SQL_RECEBIMENTOS = `SELECT r.id AS id, r.fixed_income_id AS fixed_income_id, r.received_on AS received_on,
    CASE WHEN r.transaction_id IS NULL THEN r.amount_cents ELSE t.amount_cents END AS amount_cents,
    r.transaction_id AS transaction_id, r.confirmed_by AS confirmed_by,
    r.fx_rate AS fx_rate, r.fx_date AS fx_date, t.movement AS movement, t.custom_name AS custom_name,
    t.counterparty_name AS counterparty_name, bi.institution_name AS card_institution
  FROM fixed_income_receipts AS r
  JOIN fixed_incomes AS f ON f.id = r.fixed_income_id AND f.household_id = ?
  LEFT JOIN transactions AS t ON t.id = r.transaction_id
  LEFT JOIN cards AS c ON c.id = t.card_id
  LEFT JOIN bank_items AS bi ON bi.id = c.bank_item_id
  WHERE r.cycle_key = ?
    AND (r.transaction_id IS NULL OR (t.hidden = 0 AND t.removed_at IS NULL))
  ORDER BY r.received_on, r.id`;

const SQL_VARIAVEL = `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM transactions
  WHERE household_id = ? AND cycle_key = ? AND hidden = 0 AND removed_at IS NULL
    AND (income_kind = 'variavel' OR (income_kind IS NULL AND movement = 'rendimento'))`;

export type ReciboDaRenda = {
  id: string;
  receivedOn: string;
  amountCents: number;
  confirmedBy: "extrato" | "regra" | "pessoa";
  manual: boolean;
  transactionId: string | null;
  movement: string | null;
  customName: string | null;
  counterpartyName: string | null;
  cardInstitution: string | null;
};

export type RendaDoCiclo = {
  id: string;
  name: string;
  currency: "BRL" | "USD";
  amountCents: number;
  usualDay: number;
  arrival: string;
  statementText: string | null;
  keptUsdIsInvestment: boolean;
  received: boolean;
  expectedBrlCents: number | null;
  broughtCents: number;
  keptCents: number;
  fx: { rateE4: number; rate: string; date: string } | null;
  fxPending: boolean;
  receipts: ReciboDaRenda[];
};

export type RendaDoCicloResposta = {
  cycleKey: string;
  startsOn: string;
  endsOn: string;
  totalCents: number;
  brazilSalariesCents: number;
  variableCents: number;
  keptUsdInvestedCents: number;
  fixedIncomes: RendaDoCiclo[];
};

type LinhaDeRenda = {
  id: string;
  name: string;
  currency: string;
  amount_cents: number;
  usual_day: number;
  arrival: string;
  statement_text: string | null;
  kept_usd_is_investment: number;
};

type LinhaDeRecebimento = {
  id: string;
  fixed_income_id: string;
  received_on: string;
  amount_cents: number;
  transaction_id: string | null;
  confirmed_by: string;
  fx_rate: number | null;
  fx_date: string | null;
  movement: string | null;
  custom_name: string | null;
  counterparty_name: string | null;
  card_institution: string | null;
};

const quemConfirmou = (confirmadoPor: string): ReciboDaRenda["confirmedBy"] =>
  confirmadoPor === "extrato" || confirmadoPor === "regra" ? confirmadoPor : "pessoa";

export async function computeCycleIncome(
  db: Db,
  householdId: string,
  cycleKey: string,
): Promise<RendaDoCicloResposta | null> {
  const [cicloLido, rendasLidas, recebimentosLidos, variavelLida] = await db.$client.batch([
    db.$client.prepare(SQL_CICLO).bind(householdId, cycleKey),
    db.$client.prepare(SQL_RENDAS).bind(householdId, cycleKey),
    db.$client.prepare(SQL_RECEBIMENTOS).bind(householdId, cycleKey),
    db.$client.prepare(SQL_VARIAVEL).bind(householdId, cycleKey),
  ]);
  const ciclo = (cicloLido?.results ?? [])[0] as
    | { key: string; starts_on: string; ends_on: string }
    | undefined;
  if (!ciclo) return null;

  const recebimentos = (recebimentosLidos?.results ?? []) as LinhaDeRecebimento[];
  const porRenda = new Map<string, LinhaDeRecebimento[]>();
  for (const recebimento of recebimentos) {
    const grupo = porRenda.get(recebimento.fixed_income_id) ?? [];
    grupo.push(recebimento);
    porRenda.set(recebimento.fixed_income_id, grupo);
  }

  const rendas = (rendasLidas?.results ?? []) as LinhaDeRenda[];
  const entradas: RendaNoCiclo[] = rendas.map((renda) => {
    const grupo = porRenda.get(renda.id) ?? [];
    const comCotacao = grupo.find((recebimento) => recebimento.fx_rate !== null);
    return {
      id: renda.id,
      currency: renda.currency === "USD" ? "USD" : "BRL",
      amountCents: renda.amount_cents,
      keptUsdIsInvestment: renda.kept_usd_is_investment === 1,
      recebidoCents: grupo.reduce((soma, recebimento) => soma + recebimento.amount_cents, 0),
      recebimentos: grupo.length,
      fxRate: comCotacao?.fx_rate ?? null,
    };
  });

  const variavel = (variavelLida?.results?.[0] as { total?: number } | undefined)?.total ?? 0;
  const resumo = summarizeCycleIncome(entradas, variavel);
  const resumoPorId = new Map(resumo.fixedIncomes.map((item) => [item.id, item]));

  const fixedIncomes = rendas.map((renda): RendaDoCiclo => {
    const grupo = porRenda.get(renda.id) ?? [];
    const item = resumoPorId.get(renda.id);
    const comCotacao = grupo.find((recebimento) => recebimento.fx_rate !== null);
    const fx =
      comCotacao && comCotacao.fx_rate !== null && comCotacao.fx_date !== null
        ? ultimaCotacao(comCotacao.fx_rate, comCotacao.fx_date)
        : null;
    return {
      id: renda.id,
      name: renda.name,
      currency: renda.currency === "USD" ? "USD" : "BRL",
      amountCents: renda.amount_cents,
      usualDay: renda.usual_day,
      arrival: renda.arrival,
      statementText: renda.statement_text,
      keptUsdIsInvestment: renda.currency === "USD" && renda.kept_usd_is_investment === 1,
      received: item?.received ?? false,
      expectedBrlCents: item?.expectedBrlCents ?? null,
      broughtCents: item?.broughtCents ?? 0,
      keptCents: item?.keptCents ?? 0,
      fx,
      fxPending: item?.fxPending ?? false,
      receipts: grupo.map(
        (recebimento): ReciboDaRenda => ({
          id: recebimento.id,
          receivedOn: recebimento.received_on,
          amountCents: recebimento.amount_cents,
          confirmedBy: quemConfirmou(recebimento.confirmed_by),
          manual: recebimento.transaction_id === null,
          transactionId: recebimento.transaction_id,
          movement: recebimento.movement,
          customName: recebimento.custom_name,
          counterpartyName: recebimento.counterparty_name,
          cardInstitution: recebimento.card_institution,
        }),
      ),
    };
  });

  return {
    cycleKey: ciclo.key,
    startsOn: ciclo.starts_on,
    endsOn: ciclo.ends_on,
    totalCents: resumo.totalCents,
    brazilSalariesCents: resumo.brazilSalariesCents,
    variableCents: resumo.variableCents,
    keptUsdInvestedCents: resumo.keptUsdInvestedCents,
    fixedIncomes,
  };
}
