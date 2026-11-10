import type { RespostaDeCartao, RespostaDeCartoes } from "../../shared/api/cards";
import type { LinhaParcelada } from "../../shared/cards/installments";
import type { Ciclo } from "../../shared/cycle";
import { displayName } from "../../shared/transactions/display-name";
import { COUNTS_SQL } from "../cycle/predicates";
import type { Db } from "../db/client";
import {
  cicloDaData,
  type FaturaDoBanco,
  faturaAtual,
  type LancamentoDoBanco,
  mediaDasSeis,
  melhorDia,
  montarSerie,
  paraCompra,
  rotuloDoCartao,
  selo,
  totalDaNovaAberta,
} from "./montagem";

// Cartões (TASK-0402): as duas rotas leem tudo num único db.batch(). Toda consulta passa pelo escopo de cartões do
// lar, porque a fatura não tem household_id: o lar vem do cartão, pela conexão. As somas vão para o SQL, sobre o
// índice transactions(card_id, bill_id) e os de bills.

const COLUNAS_DO_LANCAMENTO = `t.id AS id, t.original_description AS original_description, t.custom_name AS custom_name,
  t.movement AS movement, t.counterparty_name AS counterparty_name, t.local_date AS local_date,
  t.amount_cents AS amount_cents, t.installment_number AS installment_number, t.installment_total AS installment_total,
  t.hidden AS hidden, t.category_id AS category_id, cat.name AS category_name`;

// Escopo: os cartões conectados do lar. Com cardId, só esse cartão.
type Escopo = { sql: string; params: unknown[] };

function escopoDeCartoes(householdId: string, cardId?: string): Escopo {
  const porCartao = cardId === undefined ? "" : " AND c.id = ?";
  return {
    sql: `(SELECT c.id FROM cards AS c JOIN bank_items AS bi ON bi.id = c.bank_item_id JOIN pluggy_connections AS pc ON pc.id = bi.connection_id WHERE pc.household_id = ? AND bi.disconnected_at IS NULL${porCartao})`,
    params: cardId === undefined ? [householdId] : [householdId, cardId],
  };
}

const SQL_CARTOES = `SELECT c.id AS id, c.last4 AS last4, c.limit_cents AS limit_cents, c.available_cents AS available_cents,
    c.best_day AS best_day, bi.institution_name AS institution_name, bi.institution_color AS institution_color
  FROM cards AS c JOIN bank_items AS bi ON bi.id = c.bank_item_id JOIN pluggy_connections AS pc ON pc.id = bi.connection_id
  WHERE pc.household_id = ? AND bi.disconnected_at IS NULL
  ORDER BY bi.institution_name, c.last4`;

const sqlFaturas = (
  escopo: Escopo,
) => `SELECT b.id AS id, b.card_id AS card_id, b.closes_on AS closes_on, b.due_on AS due_on,
    b.status AS status, b.paid_on AS paid_on, b.cycle_key AS cycle_key
  FROM bills AS b WHERE b.card_id IN ${escopo.sql} ORDER BY b.card_id, b.closes_on`;

// Total de cada fatura: as saídas que contam, com o sinal invertido (a compra é negativa; o estorno abate).
const sqlTotais = (escopo: Escopo) => `SELECT t.bill_id AS bill_id, -SUM(t.amount_cents) AS total_cents
  FROM transactions AS t
  WHERE t.card_id IN ${escopo.sql} AND t.bill_id IS NOT NULL AND ${COUNTS_SQL} AND t.movement IN ('compra', 'estorno')
  GROUP BY t.bill_id`;

// Parcelas da fatura-base: a aberta, ou a última fechada quando não há aberta. Só compras parceladas que contam.
const sqlParcelasDaBase = (
  escopo: Escopo,
) => `SELECT t.id AS id, b.card_id AS card_id, t.original_description AS original_description,
    t.custom_name AS custom_name, t.movement AS movement, t.counterparty_name AS counterparty_name,
    t.amount_cents AS amount_cents, t.installment_number AS installment_number, t.installment_total AS installment_total,
    t.hidden AS hidden
  FROM transactions AS t JOIN bills AS b ON b.id = t.bill_id
  WHERE b.card_id IN ${escopo.sql} AND ${COUNTS_SQL} AND t.movement = 'compra' AND t.installment_total > t.installment_number
    AND (b.status = 'aberta' OR (b.status = 'fechada'
      AND b.id = (SELECT f.id FROM bills AS f WHERE f.card_id = b.card_id AND f.status = 'fechada' ORDER BY f.closes_on DESC LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM bills AS a WHERE a.card_id = b.card_id AND a.status = 'aberta')))`;

const SQL_CALENDARIO = `SELECT k.key AS key, k.starts_on AS starts_on, k.ends_on AS ends_on FROM cycles AS k
  WHERE k.household_id = ? ORDER BY k.starts_on`;

const SQL_DIA_DO_LAR = `SELECT cycle_start_day FROM households WHERE id = ?`;

// Compras e estornos dos dois últimos ciclos (o atual e o anterior), com o cartão em que foram feitos.
const sqlRecentes = (escopo: Escopo) => `SELECT ${COLUNAS_DO_LANCAMENTO}, t.card_id AS card_id,
    bi.institution_name AS institution_name, c.last4 AS last4
  FROM transactions AS t JOIN cards AS c ON c.id = t.card_id JOIN bank_items AS bi ON bi.id = c.bank_item_id
    LEFT JOIN categories AS cat ON cat.id = t.category_id AND cat.household_id = ?
  WHERE t.card_id IN ${escopo.sql} AND t.removed_at IS NULL AND t.movement IN ('compra', 'estorno')
    AND t.cycle_key IN (SELECT k.key FROM cycles AS k WHERE k.household_id = ? AND k.starts_on <= ? ORDER BY k.starts_on DESC LIMIT 2)
  ORDER BY t.occurred_at DESC, t.id DESC LIMIT 10`;

// Compras e estornos da fatura aberta do cartão, com os ocultos (a tela mostra os dois).
const sqlAbertas = (escopo: Escopo) => `SELECT ${COLUNAS_DO_LANCAMENTO}
  FROM transactions AS t LEFT JOIN categories AS cat ON cat.id = t.category_id AND cat.household_id = ?
  WHERE t.card_id IN ${escopo.sql} AND t.removed_at IS NULL AND t.movement IN ('compra', 'estorno')
    AND t.bill_id IN (SELECT b.id FROM bills AS b WHERE b.card_id = ? AND b.status = 'aberta')
  ORDER BY t.occurred_at DESC, t.id DESC`;

type LinhaDeCartao = {
  id: string;
  last4: string;
  limit_cents: number | null;
  available_cents: number | null;
  best_day: number | null;
  institution_name: string;
  institution_color: string | null;
};
type LinhaDeFatura = {
  id: string;
  card_id: string;
  closes_on: string;
  due_on: string | null;
  status: string;
  paid_on: string | null;
  cycle_key: string | null;
};
type LinhaDeLancamento = {
  id: string;
  original_description: string;
  custom_name: string | null;
  movement: string;
  counterparty_name: string | null;
  local_date: string;
  amount_cents: number;
  installment_number: number | null;
  installment_total: number | null;
  hidden: number;
  category_id: string | null;
  category_name: string | null;
  card_id?: string;
  institution_name?: string;
  last4?: string;
};
type LinhaDeParcela = {
  id: string;
  card_id: string;
  original_description: string;
  custom_name: string | null;
  movement: string;
  counterparty_name: string | null;
  amount_cents: number;
  installment_number: number;
  installment_total: number;
  hidden: number;
};
type LinhaDeTotal = { bill_id: string; total_cents: number };
type LinhaDeCiclo = { key: string; starts_on: string; ends_on: string };

function linhas<T>(resultado: D1Result<unknown> | undefined): T[] {
  return (resultado?.results ?? []) as T[];
}

function lancamentoDe(linha: LinhaDeLancamento): LancamentoDoBanco {
  return {
    id: linha.id,
    originalDescription: linha.original_description,
    customName: linha.custom_name,
    movement: linha.movement,
    counterpartyName: linha.counterparty_name,
    localDate: linha.local_date,
    amountCents: linha.amount_cents,
    installmentNumber: linha.installment_number,
    installmentTotal: linha.installment_total,
    hidden: linha.hidden === 1,
    categoryName: linha.category_name,
    uncategorized: linha.category_id === null,
  };
}

// Rótulo de cada cartão: o banco, e o final junto quando o lar tem dois cartões do mesmo banco.
function rotulosDosCartoes(cartoes: readonly LinhaDeCartao[]): Map<string, string> {
  const contagem = new Map<string, number>();
  for (const cartao of cartoes) {
    contagem.set(cartao.institution_name, (contagem.get(cartao.institution_name) ?? 0) + 1);
  }
  return new Map(
    cartoes.map((cartao) => [
      cartao.id,
      rotuloDoCartao(cartao.institution_name, cartao.last4, (contagem.get(cartao.institution_name) ?? 0) > 1),
    ]),
  );
}

function faturasDe(linhasDeFatura: readonly LinhaDeFatura[]): FaturaDoBanco[] {
  return linhasDeFatura.map((linha) => ({
    id: linha.id,
    cardId: linha.card_id,
    closesOn: linha.closes_on,
    dueOn: linha.due_on,
    status: linha.status,
    paidOn: linha.paid_on,
    cycleKey: linha.cycle_key,
  }));
}

function parcelasDe(linhasDeParcela: readonly LinhaDeParcela[]): (LinhaParcelada & { cardId: string })[] {
  return linhasDeParcela.map((linha) => ({
    cardId: linha.card_id,
    name: displayName({
      customName: linha.custom_name,
      movement: linha.movement,
      counterpartyName: linha.counterparty_name,
      originalDescription: linha.original_description,
    }),
    installmentNumber: linha.installment_number,
    installmentTotal: linha.installment_total,
    amountCents: linha.amount_cents,
    hidden: linha.hidden === 1,
  }));
}

function totaisDe(linhasDeTotal: readonly LinhaDeTotal[]): Map<string, number> {
  return new Map(linhasDeTotal.map((linha) => [linha.bill_id, linha.total_cents]));
}

function calendarioDe(linhasDeCiclo: readonly LinhaDeCiclo[]): Ciclo[] {
  return linhasDeCiclo.map((linha) => ({ key: linha.key, startsOn: linha.starts_on, endsOn: linha.ends_on }));
}

const DIA_PADRAO_DO_LAR = 11;

// GET /api/cards: os cartões do lar, o total das faturas abertas, as parcelas futuras e as últimas compras.
export async function lerCartoes(db: Db, householdId: string, hoje: string): Promise<RespostaDeCartoes> {
  const escopo = escopoDeCartoes(householdId);
  const resultados = await db.$client.batch([
    db.$client.prepare(SQL_CARTOES).bind(householdId),
    db.$client.prepare(sqlFaturas(escopo)).bind(...escopo.params),
    db.$client.prepare(sqlTotais(escopo)).bind(...escopo.params),
    db.$client.prepare(sqlParcelasDaBase(escopo)).bind(...escopo.params),
    db.$client.prepare(SQL_CALENDARIO).bind(householdId),
    db.$client.prepare(SQL_DIA_DO_LAR).bind(householdId),
    db.$client.prepare(sqlRecentes(escopo)).bind(householdId, ...escopo.params, householdId, hoje),
  ]);

  const cartoes = linhas<LinhaDeCartao>(resultados[0]);
  const faturas = faturasDe(linhas<LinhaDeFatura>(resultados[1]));
  const totais = totaisDe(linhas<LinhaDeTotal>(resultados[2]));
  const parcelas = parcelasDe(linhas<LinhaDeParcela>(resultados[3]));
  const cicloDe = cicloDaData(
    calendarioDe(linhas<LinhaDeCiclo>(resultados[4])),
    linhas<{ cycle_start_day: number }>(resultados[5])[0]?.cycle_start_day ?? DIA_PADRAO_DO_LAR,
  );
  const rotulos = rotulosDosCartoes(cartoes);

  let abertasCents = 0;
  let futurasCents = 0;
  const cards = cartoes.map((cartao) => {
    const serie = montarSerie(
      faturas.filter((fatura) => fatura.cardId === cartao.id),
      totais,
      parcelas.filter((parcela) => parcela.cardId === cartao.id),
      cicloDe,
    );
    const atual = faturaAtual(serie);
    abertasCents += serie.aberta?.totalCents ?? 0;
    futurasCents += serie.futurasCents;
    return {
      id: cartao.id,
      label: rotulos.get(cartao.id) ?? cartao.institution_name,
      bankName: cartao.institution_name,
      last4: cartao.last4,
      color: cartao.institution_color ?? "#0E9A63",
      limitCents: cartao.limit_cents,
      availableCents: cartao.available_cents,
      badge: selo(serie),
      current: atual,
      openTotalCents: atual?.state === "fechada" ? totalDaNovaAberta(serie) : null,
    };
  });

  const recent = linhas<LinhaDeLancamento>(resultados[6]).map((linha) =>
    paraCompra(
      lancamentoDe(linha),
      rotulos.get(linha.card_id ?? "") ??
        rotuloDoCartao(linha.institution_name ?? "", linha.last4 ?? "", false),
    ),
  );

  return { openBillsCents: abertasCents, futureInstallmentsCents: futurasCents, cards, recent };
}

// GET /api/cards/:cardId: o cartão, a série de faturas, a média e as compras da fatura aberta. null quando o cartão
// não é do lar (a rota responde 404).
export async function lerCartao(
  db: Db,
  householdId: string,
  cardId: string,
): Promise<RespostaDeCartao | null> {
  const escopo = escopoDeCartoes(householdId, cardId);
  const resultados = await db.$client.batch([
    db.$client.prepare(SQL_CARTOES).bind(householdId),
    db.$client.prepare(sqlFaturas(escopo)).bind(...escopo.params),
    db.$client.prepare(sqlTotais(escopo)).bind(...escopo.params),
    db.$client.prepare(sqlParcelasDaBase(escopo)).bind(...escopo.params),
    db.$client.prepare(SQL_CALENDARIO).bind(householdId),
    db.$client.prepare(SQL_DIA_DO_LAR).bind(householdId),
    db.$client.prepare(sqlAbertas(escopo)).bind(householdId, ...escopo.params, cardId),
  ]);

  const cartoes = linhas<LinhaDeCartao>(resultados[0]);
  const cartao = cartoes.find((linha) => linha.id === cardId);
  if (!cartao) return null;

  const serie = montarSerie(
    faturasDe(linhas<LinhaDeFatura>(resultados[1])),
    totaisDe(linhas<LinhaDeTotal>(resultados[2])),
    parcelasDe(linhas<LinhaDeParcela>(resultados[3])),
    cicloDaData(
      calendarioDe(linhas<LinhaDeCiclo>(resultados[4])),
      linhas<{ cycle_start_day: number }>(resultados[5])[0]?.cycle_start_day ?? DIA_PADRAO_DO_LAR,
    ),
  );
  const media = mediaDasSeis(serie);
  const itens = linhas<LinhaDeLancamento>(resultados[6]).map(lancamentoDe);
  const aberta = serie.aberta;

  return {
    card: {
      id: cartao.id,
      label: rotulosDosCartoes(cartoes).get(cardId) ?? cartao.institution_name,
      bankName: cartao.institution_name,
      last4: cartao.last4,
      color: cartao.institution_color ?? "#0E9A63",
      limitCents: cartao.limit_cents,
      availableCents: cartao.available_cents,
      bestDayOn: melhorDia(cartao.best_day, aberta),
    },
    badge: selo(serie),
    open: aberta
      ? {
          billId: aberta.billId ?? "",
          cycleKey: aberta.cycleKey,
          closesOn: aberta.closesOn,
          dueOn: aberta.dueOn,
          totalCents: aberta.totalCents,
        }
      : null,
    futureInstallmentsCents: serie.futurasCents,
    avg6Cents: media.avgCents,
    avgMonths: media.meses,
    bills: serie.faturas.map((fatura) => ({
      billId: fatura.billId,
      cycleKey: fatura.cycleKey,
      closesOn: fatura.closesOn,
      dueOn: fatura.dueOn,
      status: fatura.status,
      paidOn: fatura.paidOn,
      totalCents: fatura.totalCents,
      futureItems: fatura.futureItems,
    })),
    openItems: itens.map((lancamento) => paraCompra(lancamento)),
    openCount: itens.filter((lancamento) => !lancamento.hidden).length,
    openHiddenCount: itens.filter((lancamento) => lancamento.hidden).length,
  };
}
