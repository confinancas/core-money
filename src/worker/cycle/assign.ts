import type { Db } from "../db/client";

// Em que ciclo cada lançamento conta (TASK-0801). A data que decide é a da fatura (closes_on) no cartão, e o
// local_date no resto. A chave é a do ciclo do lar que contém essa data; fora do calendário, a subconsulta dá NULL.
// Os UPDATE só escrevem o que mudou (IS NOT) e nunca apagam uma chave por falta de calendário (IS NOT NULL).
// Os ids e os cartões vão num único parâmetro JSON (json_each), então não há grupos de 90: um comando por escopo.

// Escopos: { ids } são os lançamentos da gravação e os cartões que eles tocam; { cardIds } são os cartões inteiros;
// { all: true } é o lar inteiro.
export type EscopoDeCiclo = { ids: string[] } | { cardIds: string[] } | { all: true };

type Filtro = { sql: string; params: unknown[] };
type Par = { t: Filtro; b: Filtro | null };

// Cartões do lar: bills não tem household_id, então a fatura é do lar pelo cartão.
const CARTOES_DO_LAR =
  "SELECT c.id FROM cards c JOIN bank_items bi ON bi.id = c.bank_item_id JOIN pluggy_connections pc ON pc.id = bi.connection_id WHERE pc.household_id = ?";

// Data que decide o ciclo de um lançamento (alias t).
const DATA_DA_TRANSACAO = `CASE WHEN t.card_id IS NOT NULL THEN COALESCE((SELECT b.closes_on FROM bills b WHERE b.id = t.bill_id), t.local_date) ELSE t.local_date END`;

// Chave do ciclo que contém a data: o último ciclo que começa até a data, e só vale se a data não passou do fim dele.
const cicloDaData = (data: string, lar: string): string =>
  `(SELECT CASE WHEN c.ends_on >= ${data} THEN c.key END FROM cycles c WHERE c.household_id = ${lar} AND c.starts_on <= ${data} ORDER BY c.starts_on DESC LIMIT 1)`;

const CHAVE_DA_TRANSACAO = cicloDaData(DATA_DA_TRANSACAO, "t.household_id");

// As partes de transactions leem pela chave (id ou card_id). A lista de ids ou de cartões entra por json_each como
// laço de fora de uma subconsulta (CROSS JOIN), e o household_id fica dentro dela. No WHERE de fora, o household_id
// faz o planejador escolher o índice do lar e ler o lar inteiro a cada comando (TASK-0302). Na subconsulta do cartão,
// o household_id ainda pode levar o planejador ao índice do lar: INDEXED BY fixa o índice do cartão.
function paresDoEscopo(householdId: string, escopo: EscopoDeCiclo): Par[] {
  if ("all" in escopo) {
    return [
      {
        t: { sql: "t.household_id = ?", params: [householdId] },
        b: { sql: `b.card_id IN (${CARTOES_DO_LAR})`, params: [householdId] },
      },
    ];
  }
  if ("cardIds" in escopo) {
    const json = JSON.stringify(escopo.cardIds);
    return [
      {
        t: {
          sql: "t.id IN (SELECT y.id FROM json_each(?) AS j CROSS JOIN transactions AS y INDEXED BY transactions_card_local_date_idx ON y.card_id = j.value AND y.household_id = ?)",
          params: [json, householdId],
        },
        b: {
          sql: `b.card_id IN (SELECT value FROM json_each(?)) AND b.card_id IN (${CARTOES_DO_LAR})`,
          params: [json, householdId],
        },
      },
    ];
  }
  // Só os lançamentos gravados e as faturas em que eles caem. O cartão inteiro não entra aqui: a cada gravação, reler
  // os lançamentos do cartão custava cerca de 10 leituras por lançamento dele (TASK-0801, item 3). A fatura de um
  // lançamento só muda de data nas faturas (upsertBillsStmts), e isso a reavaliação do cartão cobre (cardIds).
  const json = JSON.stringify(escopo.ids);
  return [
    {
      t: {
        sql: "t.id IN (SELECT x.id FROM json_each(?) AS j CROSS JOIN transactions AS x ON x.id = j.value AND x.household_id = ?)",
        params: [json, householdId],
      },
      b: {
        sql: `b.id IN (SELECT x.bill_id FROM json_each(?) AS j CROSS JOIN transactions AS x ON x.id = j.value AND x.household_id = ? WHERE x.bill_id IS NOT NULL) AND b.card_id IN (${CARTOES_DO_LAR})`,
        params: [json, householdId, householdId],
      },
    },
  ];
}

function atualizaTransacoes(db: Db, filtro: Filtro): D1PreparedStatement {
  return db.$client
    .prepare(
      `UPDATE transactions AS t SET cycle_key = ${CHAVE_DA_TRANSACAO} WHERE ${filtro.sql}
        AND t.cycle_key IS NOT ${CHAVE_DA_TRANSACAO} AND ${CHAVE_DA_TRANSACAO} IS NOT NULL`,
    )
    .bind(...filtro.params);
}

function atualizaFaturas(db: Db, householdId: string, filtro: Filtro): D1PreparedStatement {
  const chave = cicloDaData("b.closes_on", "?");
  // Ordem dos parâmetros: a chave do SET (lar), o filtro, e a chave de novo na comparação e na guarda.
  return db.$client
    .prepare(
      `UPDATE bills AS b SET cycle_key = ${chave} WHERE ${filtro.sql}
        AND b.cycle_key IS NOT ${chave} AND ${chave} IS NOT NULL`,
    )
    .bind(householdId, ...filtro.params, householdId, householdId);
}

// Comandos que atribuem o ciclo: os lançamentos do escopo, e as faturas dos cartões tocados (com os lançamentos deles).
// Não lê nada antes; escreve só o que mudou. Os parâmetros dos ids vão em JSON, então cabem em 100.
export function assignCycleKeysStmts(
  db: Db,
  householdId: string,
  escopo: EscopoDeCiclo,
): D1PreparedStatement[] {
  return paresDoEscopo(householdId, escopo).flatMap((par) => [
    atualizaTransacoes(db, par.t),
    ...(par.b ? [atualizaFaturas(db, householdId, par.b)] : []),
  ]);
}

// Uma leitura só: a menor e a maior data que o escopo decide (a do lançamento, e a da fatura dos cartões).
// Serve para saber se o calendário cobre o escopo antes de gravar.
export function faixaDeDatasStmts(db: Db, householdId: string, escopo: EscopoDeCiclo): D1PreparedStatement {
  const partes: string[] = [];
  const params: unknown[] = [];
  for (const par of paresDoEscopo(householdId, escopo)) {
    partes.push(`SELECT ${DATA_DA_TRANSACAO} AS d FROM transactions AS t WHERE ${par.t.sql}`);
    params.push(...par.t.params);
    if (par.b) {
      partes.push(`SELECT b.closes_on AS d FROM bills AS b WHERE ${par.b.sql}`);
      params.push(...par.b.params);
    }
  }
  return db.$client
    .prepare(`SELECT MIN(d) AS minimo, MAX(d) AS maximo FROM (${partes.join(" UNION ALL ")})`)
    .bind(...params);
}
