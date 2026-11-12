import { addDays, ciclosQueFaltam } from "../../shared/cycle";
import { calendarioDaLeitura, insertCyclesStmts, leituraCalendarioStmts } from "../cycle/calendar";
import type { Db } from "../db/client";
import { ORIGEM_PADRAO, TIPO_PADRAO, temTipoPadrao } from "../spend-types/derive";
import { afterIngest } from "./after-ingest";
import type { AccountRow, BillRow, CardRow, FuturaRow, MappedTransaction } from "./map";

// D1: até 100 parâmetros por comando e, aqui, até 200 linhas por chamada (quem fatia é a TASK-0204).
const MAX_LINHAS = 200;
const MAX_PARAMETROS = 100;
// 90 ids + o bank_item_id = 91 parâmetros na busca.
const IDS_POR_BUSCA = 90;
// O calendário que a gravação cria vai até este número de dias depois da última data do lote. Cobre a fatura que
// fecha depois da compra (até 35 dias); o que sobrar, o passo 2 do afterIngest completa.
const DIAS_DE_CALENDARIO_APOS_O_LOTE = 40;

// Colunas que o INSERT preenche, nesta ordem. Vinte e uma por linha. O ciclo (cycle_key) vem depois, calculado na
// própria gravação (CICLO_NA_GRAVACAO): é o que o passo 2 do afterIngest faria, sem reescrever a linha.
const COLUNAS_DA_LINHA = [
  "id",
  "household_id",
  "bank_item_id",
  "external_id",
  "account_id",
  "card_id",
  "bill_id",
  "movement",
  "occurred_at",
  "local_date",
  "amount_cents",
  "original_description",
  "establishment_key",
  "counterparty_name",
  "counterparty_doc_masked",
  "counterparty_bank",
  "installment_number",
  "installment_total",
  "provider_category",
  "provider_operation_type",
  "last_seen_at",
] as const;
// Além das 21 colunas, o ciclo usa três parâmetros: a fatura, a data do lançamento e o lar. 24 por linha: 4 por comando.
const PARAMETROS_DO_CICLO = 3;
const LINHAS_POR_COMANDO = Math.floor(MAX_PARAMETROS / (COLUNAS_DA_LINHA.length + PARAMETROS_DO_CICLO));

// Só o que vem do banco é atualizado no conflito. Nunca tocam: movement, movement_original, movement_locked,
// custom_name, category_id, spend_type*, hidden*, income_*, fixed_income_id, card_would_accept, ai_*, categorized_*,
// rule_id, fixed_bill_id, is_backfill, pix_key_masked, cycle_key, household_id e bank_item_id.
// A última leitura (last_seen_at) não entra aqui: ela anda num UPDATE à parte, para todas as linhas lidas, e não só as que
// mudaram (TASK-0205, A1). Assim a releitura sem mudança grava uma escrita por linha, e não sete.
const ATUALIZADAS_DO_BANCO = [
  "occurred_at",
  "local_date",
  "amount_cents",
  "original_description",
  "establishment_key",
  "counterparty_name",
  "counterparty_doc_masked",
  "counterparty_bank",
  "installment_number",
  "installment_total",
  "bill_id",
  "account_id",
  "card_id",
  "provider_category",
  "provider_operation_type",
] as const;

// O mesmo cálculo de cicloDaData (assign.ts), com a data que decide: a da fatura, quando a linha tem uma, ou a do dia.
// Nas contas, bill_id é nulo e o COALESCE dá a data do dia. O ciclo é nulo fora do calendário (o passo 2 completa).
// Parâmetros, nesta ordem: bill_id, local_date, household_id.
const CICLO_NA_GRAVACAO = `(SELECT CASE WHEN c.ends_on >= d.dia THEN c.key END
    FROM (SELECT COALESCE((SELECT b.closes_on FROM bills AS b WHERE b.id = ?), ?) AS dia) AS d, cycles AS c
    WHERE c.household_id = ? AND c.starts_on <= d.dia ORDER BY c.starts_on DESC LIMIT 1)`;

// O tipo padrão (spend_type e a origem) entra como literal, não como parâmetro: a linha que não tem tipo (entrada,
// pagamento de fatura, transferência) leva NULL. Cada tupla diz se é saída com tipo, então o SQL varia por tupla.
const SQL_INSERT_TRANSACAO = (temTipo: boolean[]): string =>
  `INSERT INTO transactions (${[...COLUNAS_DA_LINHA, "cycle_key", "spend_type", "spend_type_source"].join(", ")}) VALUES ${temTipo
    .map((tipado) => {
      const tipo = tipado ? `'${TIPO_PADRAO}', '${ORIGEM_PADRAO}'` : "NULL, NULL";
      return `(${[...COLUNAS_DA_LINHA.map(() => "?"), CICLO_NA_GRAVACAO, tipo].join(", ")})`;
    })
    .join(", ")} ON CONFLICT (bank_item_id, external_id) DO UPDATE SET ${[
    ...ATUALIZADAS_DO_BANCO.map((coluna) => `${coluna} = excluded.${coluna}`),
    "removed_at = NULL",
  ].join(", ")}
    WHERE ${[
      ...ATUALIZADAS_DO_BANCO.map((coluna) => `transactions.${coluna} IS NOT excluded.${coluna}`),
      "transactions.removed_at IS NOT NULL",
    ].join(" OR ")}`;

// Fatura real ou sintética: uma linha por id. A aberta tem id sint: e status "aberta"; no conflito, mantém cycle_key.
const SQL_UPSERT_FATURA = `INSERT INTO bills (id, card_id, closes_on, due_on, amount_cents, status, paid_on, cycle_key)
  VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
  ON CONFLICT (id) DO UPDATE SET closes_on = excluded.closes_on, due_on = excluded.due_on,
    amount_cents = excluded.amount_cents, status = excluded.status, paid_on = excluded.paid_on`;

// Sintéticas do cartão a até 5 dias da fatura real (exceto a aberta atual).
const SQL_SINTETICAS_PROXIMAS = `substr(id, 1, 5) = 'sint:' AND card_id = ? AND id <> ?
  AND ABS(julianday(closes_on) - julianday(?)) <= 5`;

export type IngestInput = {
  householdId: string;
  bankItemId: string;
  rows: MappedTransaction[];
  now: string;
};

const emGrupos = <T>(itens: T[], tamanho: number): T[][] => {
  const grupos: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) grupos.push(itens.slice(i, i + tamanho));
  return grupos;
};

// Comandos de contas (INSERT ... ON CONFLICT pelo id): saldo, limite e nome.
export function upsertAccountsStmts(
  db: Db,
  bankItemId: string,
  contas: AccountRow[],
  now: string,
): D1PreparedStatement[] {
  return contas.map((conta) =>
    db.$client
      .prepare(
        `INSERT INTO accounts (id, bank_item_id, kind, name, balance_cents, overdraft_used_cents, balance_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, balance_cents = excluded.balance_cents,
           overdraft_used_cents = excluded.overdraft_used_cents, balance_at = excluded.balance_at`,
      )
      .bind(
        conta.id,
        bankItemId,
        conta.kind,
        conta.name,
        conta.balance_cents,
        conta.overdraft_used_cents,
        now,
      ),
  );
}

// Comandos de cartões: limite, disponível e nome. O melhor dia não vem do Pluggy: fica nulo.
export function upsertCardsStmts(db: Db, bankItemId: string, cartoes: CardRow[]): D1PreparedStatement[] {
  return cartoes.map((cartao) =>
    db.$client
      .prepare(
        `INSERT INTO cards (id, bank_item_id, last4, name, limit_cents, available_cents, best_day)
         VALUES (?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, limit_cents = excluded.limit_cents,
           available_cents = excluded.available_cents`,
      )
      .bind(cartao.id, bankItemId, cartao.last4, cartao.name, cartao.limit_cents, cartao.available_cents),
  );
}

// Grava as faturas reais e a aberta sintética de um cartão, na ordem que o banco exige.
// Real: herda as transações das sintéticas a até 5 dias e a sintética some. Aberta antiga: vira fechada até a real chegar.
// A aberta atual não é apagada nem herdada (o id dela é excluído das consultas).
export function upsertBillsStmts(
  db: Db,
  cartao: { id: string },
  faturas: BillRow[],
  aberta: BillRow | null,
): D1PreparedStatement[] {
  const d1 = db.$client;
  const abertaId = aberta?.id ?? "";
  const comandos: D1PreparedStatement[] = [];

  for (const fatura of faturas) {
    // A real entra antes da transferência de transações: a chave estrangeira exige a fatura gravada.
    comandos.push(
      d1
        .prepare(SQL_UPSERT_FATURA)
        .bind(
          fatura.id,
          cartao.id,
          fatura.closes_on,
          fatura.due_on,
          fatura.amount_cents,
          fatura.status,
          fatura.paid_on,
        ),
    );
    comandos.push(
      d1
        .prepare(
          `UPDATE transactions SET bill_id = ? WHERE bill_id IN (SELECT id FROM bills WHERE ${SQL_SINTETICAS_PROXIMAS})`,
        )
        .bind(fatura.id, cartao.id, abertaId, fatura.closes_on),
    );
    comandos.push(
      d1
        .prepare(`DELETE FROM bills WHERE ${SQL_SINTETICAS_PROXIMAS}`)
        .bind(cartao.id, abertaId, fatura.closes_on),
    );
  }

  comandos.push(
    d1
      .prepare("UPDATE bills SET status = 'fechada' WHERE card_id = ? AND status = 'aberta' AND id <> ?")
      .bind(cartao.id, abertaId),
  );
  if (aberta) {
    comandos.push(
      d1
        .prepare(SQL_UPSERT_FATURA)
        .bind(aberta.id, cartao.id, aberta.closes_on, aberta.due_on, aberta.amount_cents, "aberta", null),
    );
  }
  return comandos;
}

// Grava os movimentos do item sem duplicar: (bank_item_id, external_id) é a chave. Duas chamadas ao D1: a leitura
// (os existentes, e o calendário do lar, no mesmo lote) e a gravação (ciclos que faltam, faturas sintéticas futuras e
// os movimentos, nessa ordem, no mesmo lote). Devolve os ids inseridos e os atualizados, e chama afterIngest com eles.
export async function ingestTransactions(
  db: Db,
  entrada: IngestInput,
): Promise<{ insertedIds: string[]; updatedIds: string[] }> {
  const { householdId, bankItemId, now } = entrada;
  if (entrada.rows.length > MAX_LINHAS) {
    throw new RangeError(`ingestTransactions aceita até ${MAX_LINHAS} linhas por chamada.`);
  }

  // Mesmo external_id duas vezes na página: vale a última ocorrência.
  const linhas = [...new Map(entrada.rows.map((linha) => [linha.external_id, linha])).values()];
  const insertedIds: string[] = [];
  const updatedIds: string[] = [];

  if (linhas.length > 0) {
    // Os existentes por external_id, em grupos de 90 ids, e o calendário do lar: tudo numa ida ao D1.
    const buscas = emGrupos(
      linhas.map((linha) => linha.external_id),
      IDS_POR_BUSCA,
    ).map((grupo) =>
      db.$client
        .prepare(
          `SELECT id, external_id FROM transactions WHERE bank_item_id = ? AND external_id IN (${grupo.map(() => "?").join(", ")})`,
        )
        .bind(bankItemId, ...grupo),
    );
    const leitura = await db.$client.batch([...buscas, ...leituraCalendarioStmts(db, householdId)]);
    const existentes = new Map<string, string>();
    for (const resultado of leitura.slice(0, buscas.length)) {
      for (const linha of resultado.results as { id: string; external_id: string }[]) {
        existentes.set(linha.external_id, linha.id);
      }
    }
    const { ciclos, diaDoLar } = calendarioDaLeitura(leitura[buscas.length], leitura[buscas.length + 1]);

    // Sempre um id novo no INSERT: reusar o id existente faria o conflito de chave primária escapar do ON CONFLICT.
    const ids = linhas.map(() => crypto.randomUUID());

    const comandos: D1PreparedStatement[] = [];
    if (diaDoLar !== null) {
      const datas = linhas.map((linha) => linha.local_date).sort();
      const faltam = ciclosQueFaltam(
        ciclos,
        diaDoLar,
        datas[0] ?? "",
        addDays(datas[datas.length - 1] ?? "", DIAS_DE_CALENDARIO_APOS_O_LOTE),
      );
      comandos.push(...insertCyclesStmts(db, householdId, faltam, true));
    }

    const futuras = new Map<string, FuturaRow>();
    for (const linha of linhas) {
      if (linha.futura) futuras.set(linha.futura.id, linha.futura);
    }
    comandos.push(
      ...[...futuras.values()].map((futura) =>
        db.$client
          .prepare(
            "INSERT INTO bills (id, card_id, closes_on, due_on, amount_cents, status, paid_on, cycle_key) VALUES (?, ?, ?, NULL, NULL, 'futura', NULL, NULL) ON CONFLICT (id) DO NOTHING",
          )
          .bind(futura.id, futura.card_id, futura.closes_on),
      ),
    );

    const indicadas = linhas.map((linha, i) => ({ linha, id: ids[i] ?? "" }));
    for (const grupo of emGrupos(indicadas, LINHAS_POR_COMANDO)) {
      const temTipo = grupo.map(({ linha }) => temTipoPadrao(linha.movement, linha.amount_cents));
      const valores = grupo.flatMap(({ linha, id }) => [
        id,
        householdId,
        bankItemId,
        linha.external_id,
        linha.account_id,
        linha.card_id,
        linha.bill_id,
        linha.movement,
        linha.occurred_at,
        linha.local_date,
        linha.amount_cents,
        linha.original_description,
        linha.establishment_key,
        linha.counterparty_name,
        linha.counterparty_doc_masked,
        linha.counterparty_bank,
        linha.installment_number,
        linha.installment_total,
        linha.provider_category,
        linha.provider_operation_type,
        now,
        // Os três parâmetros do ciclo: a fatura, a data e o lar.
        linha.bill_id,
        linha.local_date,
        householdId,
      ]);
      comandos.push(db.$client.prepare(SQL_INSERT_TRANSACAO(temTipo)).bind(...valores));
    }
    // A última leitura de cada linha que já existia: uma escrita por linha, sem depender de o conflito ter mudado algo.
    const jaExistiam = [...existentes.values()];
    if (jaExistiam.length > 0) {
      comandos.push(
        db.$client
          .prepare("UPDATE transactions SET last_seen_at = ? WHERE id IN (SELECT value FROM json_each(?))")
          .bind(now, JSON.stringify(jaExistiam)),
      );
    }
    await db.$client.batch(comandos);

    linhas.forEach((linha, i) => {
      const existente = existentes.get(linha.external_id);
      if (existente !== undefined) updatedIds.push(existente);
      else insertedIds.push(ids[i] ?? "");
    });
  }

  await afterIngest(db, { householdId, bankItemId, insertedIds, updatedIds, now });
  return { insertedIds, updatedIds };
}
