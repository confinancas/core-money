import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { addDays, cycleForDate } from "../../../src/shared/cycle";
import { reavaliarCartaoInteiro } from "../../../src/worker/bank/after-ingest";
import type { BillRow, MappedTransaction } from "../../../src/worker/bank/map";
import { ingestTransactions, upsertBillsStmts, upsertCardsStmts } from "../../../src/worker/bank/repository";
import { assignCycleKeysStmts } from "../../../src/worker/cycle/assign";
import { ensureCalendar, loadCalendar } from "../../../src/worker/cycle/calendar";
import {
  COUNTS_SQL,
  CYCLE_OUTFLOW_SQL,
  countsInCalculations,
  isCycleOutflow,
  isSpentInLimit,
  SPENT_IN_LIMIT_SQL,
} from "../../../src/worker/cycle/predicates";
import { createDb, type Db } from "../../../src/worker/db/client";
import { type Meter, newMeter } from "../../../src/worker/db/metered-d1";

const AGORA = "2026-11-10T12:00:00.000Z";
const DEPOIS = "2026-11-10T13:00:00.000Z";

const dbComMedidor = (medidor: Meter = newMeter()): Db => createDb(env.DB, medidor);

// Gerador de números com semente fixa (mulberry32): as datas sorteadas são as mesmas em toda rodada.
function geradorCom(semente: number): () => number {
  let estado = semente >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Uma data de 2025-01-01 a 2029-12-31 (1.826 dias).
const dataAleatoria = (rnd: () => number): string => addDays("2025-01-01", Math.floor(rnd() * 1826));

async function criarLar(dia = 11): Promise<{ householdId: string; connectionId: string }> {
  const householdId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO households (id, brand, cycle_start_day, created_at) VALUES (?, 'matrimoney', ?, ?)",
    ).bind(householdId, dia, AGORA),
    env.DB.prepare(
      "INSERT INTO pluggy_connections (id, household_id, label, created_at) VALUES (?, ?, '[TEST] Conexão', ?)",
    ).bind(connectionId, householdId, AGORA),
  ]);
  return { householdId, connectionId };
}

async function criarItem(connectionId: string, nome = "[TEST] Banco"): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO bank_items (id, connection_id, institution_name, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, connectionId, nome, AGORA)
    .run();
  return id;
}

async function criarCartao(db: Db, itemId: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.$client.batch(
    upsertCardsStmts(db, itemId, [
      { id, last4: "1234", name: "[TEST] Cartão", limit_cents: null, available_cents: null },
    ]),
  );
  return id;
}

async function criarConta(itemId: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO accounts (id, bank_item_id, kind, name, balance_cents, overdraft_used_cents, balance_at) VALUES (?, ?, 'corrente', '[TEST] Conta', 0, 0, ?)",
  )
    .bind(id, itemId, AGORA)
    .run();
  return id;
}

async function criarFaturas(cartaoId: string, faturas: { id: string; closesOn: string }[]): Promise<void> {
  for (let i = 0; i < faturas.length; i += 50) {
    await env.DB.batch(
      faturas
        .slice(i, i + 50)
        .map((fatura) =>
          env.DB.prepare(
            "INSERT INTO bills (id, card_id, closes_on, amount_cents, status) VALUES (?, ?, ?, 1000, 'fechada')",
          ).bind(fatura.id, cartaoId, fatura.closesOn),
        ),
    );
  }
}

const SQL_LINHA = `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, bill_id,
  movement, occurred_at, local_date, amount_cents, original_description, last_seen_at, spend_type, hidden, removed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

type LinhaSemente = {
  household: string;
  item: string;
  conta: string | null;
  cartao: string | null;
  fatura: string | null;
  movement: string;
  localDate: string;
  amount: number;
  spend?: string | null;
  hidden?: number;
  removed?: string | null;
  id?: string;
};

// Insere lançamentos direto (sem a gravação), em lotes de 50 comandos, com cycle_key nulo.
async function inserirLinhas(db: Db, linhas: LinhaSemente[]): Promise<string[]> {
  const ids = linhas.map((linha) => linha.id ?? crypto.randomUUID());
  const comandos = linhas.map((linha, i) =>
    db.$client
      .prepare(SQL_LINHA)
      .bind(
        ids[i] ?? "",
        linha.household,
        `[TEST] ext-${crypto.randomUUID()}`,
        linha.item,
        linha.conta,
        linha.cartao,
        linha.fatura,
        linha.movement,
        `${linha.localDate}T12:00:00.000Z`,
        linha.localDate,
        linha.amount,
        "[TEST] Lançamento",
        AGORA,
        linha.spend ?? null,
        linha.hidden ?? 0,
        linha.removed ?? null,
      ),
  );
  for (let i = 0; i < comandos.length; i += 50) await db.$client.batch(comandos.slice(i, i + 50));
  return ids;
}

// Pelo id ou pelo external_id (os testes de gravação usam o external_id).
const cicloDe = async (chave: string): Promise<string | null> => {
  const linha = await env.DB.prepare("SELECT cycle_key FROM transactions WHERE id = ? OR external_id = ?")
    .bind(chave, chave)
    .first<{ cycle_key: string | null }>();
  return linha?.cycle_key ?? null;
};

const mapeada = (extra: Partial<MappedTransaction> = {}): MappedTransaction => ({
  external_id: `[TEST] ext-${crypto.randomUUID()}`,
  account_id: null,
  card_id: null,
  bill_id: null,
  futura: null,
  movement: "compra",
  occurred_at: "2026-11-05T14:00:00.000Z",
  local_date: "2026-11-05",
  amount_cents: -1000,
  original_description: "[TEST] Compra",
  establishment_key: "[TEST] COMPRA",
  counterparty_name: null,
  counterparty_doc_masked: null,
  counterparty_bank: null,
  installment_number: null,
  installment_total: null,
  provider_category: null,
  provider_operation_type: null,
  ...extra,
});

const MOVIMENTOS = [
  "compra",
  "estorno",
  "pix_enviado",
  "pix_recebido",
  "ted_enviada",
  "ted_recebida",
  "pagamento_fatura",
  "transferencia_interna",
  "rendimento",
  "debito",
  "boleto",
  "outro",
];
const TIPOS_DE_GASTO = [
  null,
  "fixos",
  "conforto",
  "educacao",
  "extras",
  "prazeres",
  "metas",
  "investimentos",
];

describe("cycle_key: SQL e TypeScript dão o mesmo ciclo", () => {
  it("500 datas sorteadas com semente fixa, em cada dia de início 1, 10, 11 e 28: o cycle_key do SQL é o de cycleForDate, nos lançamentos e nas faturas", async () => {
    const falhas: string[] = [];
    for (const dia of [1, 10, 11, 28]) {
      const { householdId, connectionId } = await criarLar(dia);
      const itemId = await criarItem(connectionId);
      const db = dbComMedidor();
      const contaId = await criarConta(itemId);
      const cartaoId = await criarCartao(db, itemId);
      await ensureCalendar(db, householdId, "2025-01-01", "2029-12-31");

      const rnd = geradorCom(801);
      const linhas: LinhaSemente[] = [];
      const faturas: { id: string; closesOn: string }[] = [];
      for (let i = 0; i < 500; i++) {
        const data = dataAleatoria(rnd);
        if (i % 2 === 0) {
          linhas.push({
            household: householdId,
            item: itemId,
            conta: contaId,
            cartao: null,
            fatura: null,
            movement: "pix_enviado",
            localDate: data,
            amount: -100,
          });
        } else {
          // Um quarto das compras de cartão não tem fatura: o ciclo vem da data.
          let fatura: string | null = null;
          if (i % 4 === 1) {
            fatura = `[TEST] fatura-${dia}-${i}`;
            faturas.push({ id: fatura, closesOn: dataAleatoria(rnd) });
          }
          linhas.push({
            household: householdId,
            item: itemId,
            conta: null,
            cartao: cartaoId,
            fatura,
            movement: "compra",
            localDate: data,
            amount: -100,
          });
        }
      }
      await criarFaturas(cartaoId, faturas);
      await inserirLinhas(db, linhas);
      await db.$client.batch(assignCycleKeysStmts(db, householdId, { all: true }));

      const calendario = await loadCalendar(db, householdId);
      const lancamentos = await env.DB.prepare(
        "SELECT t.id, t.local_date, t.cycle_key, b.closes_on FROM transactions t LEFT JOIN bills b ON b.id = t.bill_id WHERE t.household_id = ?",
      )
        .bind(householdId)
        .all<{ id: string; local_date: string; cycle_key: string | null; closes_on: string | null }>();
      expect(lancamentos.results.length).toBe(500);
      for (const linha of lancamentos.results) {
        const data = linha.closes_on ?? linha.local_date;
        const esperado = cycleForDate(data, calendario)?.key ?? null;
        if (linha.cycle_key !== esperado)
          falhas.push(`dia ${dia} lançamento ${linha.id}: ${linha.cycle_key} ≠ ${esperado}`);
      }
      const contas = await env.DB.prepare("SELECT id, closes_on, cycle_key FROM bills WHERE card_id = ?")
        .bind(cartaoId)
        .all<{ id: string; closes_on: string; cycle_key: string | null }>();
      for (const fatura of contas.results) {
        const esperado = cycleForDate(fatura.closes_on, calendario)?.key ?? null;
        if (fatura.cycle_key !== esperado)
          falhas.push(`dia ${dia} fatura ${fatura.id}: ${fatura.cycle_key} ≠ ${esperado}`);
      }
    }
    expect(falhas).toEqual([]);
  });

  it("os predicados SQL dão, na matriz inteira (movimento, sinal, oculta, removida, tipo de gasto, inclusive nulo), o que o espelho dá", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId);
    const db = dbComMedidor();
    const contaId = await criarConta(itemId);
    const linhas: LinhaSemente[] = [];
    for (const movement of MOVIMENTOS) {
      for (const amount of [-100, 100]) {
        for (const hidden of [0, 1]) {
          for (const removed of [null, AGORA]) {
            for (const spend of TIPOS_DE_GASTO) {
              linhas.push({
                household: householdId,
                item: itemId,
                conta: contaId,
                cartao: null,
                fatura: null,
                movement,
                localDate: "2026-11-05",
                amount,
                spend,
                hidden,
                removed,
              });
            }
          }
        }
      }
    }
    await inserirLinhas(db, linhas);

    const ids = async (condicao: string): Promise<Set<string>> => {
      const resultado = await env.DB.prepare(`SELECT t.id AS id FROM transactions t WHERE ${condicao}`).all<{
        id: string;
      }>();
      return new Set(resultado.results.map((linha) => linha.id));
    };
    const naSqlContam = await ids(COUNTS_SQL);
    const naSqlSaida = await ids(CYCLE_OUTFLOW_SQL);
    const naSqlAnel = await ids(SPENT_IN_LIMIT_SQL);
    const todas = await env.DB.prepare(
      "SELECT id, movement, amount_cents, hidden, removed_at, spend_type FROM transactions WHERE household_id = ?",
    )
      .bind(householdId)
      .all<{
        id: string;
        movement: string;
        amount_cents: number;
        hidden: number;
        removed_at: string | null;
        spend_type: string | null;
      }>();

    expect(todas.results.length).toBe(linhas.length);
    const divergencias: string[] = [];
    for (const linha of todas.results) {
      const espelho = {
        movement: linha.movement,
        amount_cents: linha.amount_cents,
        hidden: linha.hidden,
        removed_at: linha.removed_at,
        spend_type: linha.spend_type,
      };
      if (countsInCalculations(espelho) !== naSqlContam.has(linha.id)) divergencias.push(`conta ${linha.id}`);
      if (isCycleOutflow(espelho) !== naSqlSaida.has(linha.id)) divergencias.push(`saída ${linha.id}`);
      if (isSpentInLimit(espelho) !== naSqlAnel.has(linha.id)) divergencias.push(`anel ${linha.id}`);
    }
    expect(divergencias).toEqual([]);
    // O conjunto do anel é não vazio e menor que o da saída (Metas e Investimentos ficam de fora).
    expect(naSqlAnel.size).toBeGreaterThan(0);
    expect(naSqlAnel.size).toBeLessThan(naSqlSaida.size);
  });
});

describe("cycle_key: os cenários de fatura e de cálculo", () => {
  it("3, 6, 7 e 8: compra de 05/10 numa fatura de 03/11; parcelas 3/10 e 4/10; estorno de 03/12; oculta recebe chave e não conta", async () => {
    const { householdId, connectionId } = await criarLar(11);
    const itemId = await criarItem(connectionId);
    const db = dbComMedidor();
    const cartaoId = await criarCartao(db, itemId);
    const faturaNov = `[TEST] fatura-nov-${cartaoId}`;
    const faturaDez = `[TEST] fatura-dez-${cartaoId}`;
    await criarFaturas(cartaoId, [
      { id: faturaNov, closesOn: "2026-11-03" },
      { id: faturaDez, closesOn: "2026-12-03" },
    ]);
    await ensureCalendar(db, householdId, "2026-09-01", "2027-01-31");
    const ids = await inserirLinhas(db, [
      {
        household: householdId,
        item: itemId,
        conta: null,
        cartao: cartaoId,
        fatura: faturaNov,
        movement: "compra",
        localDate: "2026-10-05",
        amount: -5000,
        id: "[TEST] c3",
      },
      {
        household: householdId,
        item: itemId,
        conta: null,
        cartao: cartaoId,
        fatura: faturaNov,
        movement: "compra",
        localDate: "2026-10-28",
        amount: -3000,
        spend: "fixos",
        id: "[TEST] p3",
      },
      {
        household: householdId,
        item: itemId,
        conta: null,
        cartao: cartaoId,
        fatura: faturaDez,
        movement: "compra",
        localDate: "2026-11-28",
        amount: -3000,
        id: "[TEST] p4",
      },
      {
        household: householdId,
        item: itemId,
        conta: null,
        cartao: cartaoId,
        fatura: faturaDez,
        movement: "estorno",
        localDate: "2026-11-20",
        amount: 2000,
        id: "[TEST] est",
      },
      {
        household: householdId,
        item: itemId,
        conta: null,
        cartao: cartaoId,
        fatura: faturaNov,
        movement: "compra",
        localDate: "2026-10-15",
        amount: -700,
        hidden: 1,
        id: "[TEST] oculta",
      },
    ]);
    await db.$client.batch(assignCycleKeysStmts(db, householdId, { all: true }));

    expect(await cicloDe("[TEST] c3")).toBe("2026-10");
    expect(await cicloDe("[TEST] p3")).toBe("2026-10");
    expect(await cicloDe("[TEST] p4")).toBe("2026-11");
    expect(await cicloDe("[TEST] est")).toBe("2026-11");
    expect(await cicloDe("[TEST] oculta")).toBe("2026-10");

    const naSqlAnel = await env.DB.prepare(
      `SELECT t.id AS id FROM transactions t WHERE ${SPENT_IN_LIMIT_SQL}`,
    ).all<{ id: string }>();
    const contadas = new Set(naSqlAnel.results.map((linha) => linha.id));
    expect(contadas.has("[TEST] oculta")).toBe(false);
    expect(ids.length).toBe(5);
  });

  it("9. fatura sintética vira real: a compra passa para a real, e o cycle_key acompanha na reavaliação do cartão", async () => {
    const { householdId, connectionId } = await criarLar(11);
    const itemId = await criarItem(connectionId, "Nubank");
    const db = dbComMedidor();
    const cartaoId = await criarCartao(db, itemId);
    const aberta: BillRow = {
      id: `sint:${cartaoId}:2026-11-10`,
      closes_on: "2026-11-10",
      due_on: "2026-11-17",
      amount_cents: 12000,
      status: "aberta",
      paid_on: null,
    };
    await db.$client.batch(upsertBillsStmts(db, { id: cartaoId }, [], aberta));
    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [
        mapeada({
          card_id: cartaoId,
          bill_id: aberta.id,
          external_id: "[TEST] ext-antes",
          local_date: "2026-11-05",
        }),
      ],
      now: AGORA,
    });
    expect(await cicloDe("[TEST] ext-antes")).toBe("2026-10");

    // A fatura real fecha em 13/11, três dias depois da aberta: herda as compras e a sintética some.
    const real: BillRow = {
      id: "[TEST] fatura-real-nov",
      closes_on: "2026-11-13",
      due_on: "2026-11-20",
      amount_cents: 12000,
      status: "fechada",
      paid_on: null,
    };
    await db.$client.batch(upsertBillsStmts(db, { id: cartaoId }, [real], null));
    const herdou = await env.DB.prepare("SELECT bill_id FROM transactions WHERE external_id = ?")
      .bind("[TEST] ext-antes")
      .first<{ bill_id: string }>();
    expect(herdou?.bill_id).toBe(real.id);
    // Ainda sem reavaliação: a chave é a antiga (a data que decide mudou, mas o ciclo ainda não foi refeito).
    expect(await cicloDe("[TEST] ext-antes")).toBe("2026-10");
    // A reavaliação do cartão, que a fase de faturas roda depois de upsertBillsStmts, refaz o ciclo dele.
    await reavaliarCartaoInteiro(db, householdId, cartaoId);
    expect(await cicloDe("[TEST] ext-antes")).toBe("2026-11");

    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [
        mapeada({
          card_id: cartaoId,
          bill_id: real.id,
          external_id: "[TEST] ext-depois",
          local_date: "2026-11-12",
        }),
      ],
      now: DEPOIS,
    });
    expect(await cicloDe("[TEST] ext-antes")).toBe("2026-11");
    expect(await cicloDe("[TEST] ext-depois")).toBe("2026-11");
    const faturaReal = await env.DB.prepare("SELECT cycle_key FROM bills WHERE id = ?")
      .bind(real.id)
      .first<{ cycle_key: string | null }>();
    expect(faturaReal?.cycle_key).toBe("2026-11");
  });

  it("11. reatribuir de novo não escreve nenhuma linha", async () => {
    const { householdId, connectionId } = await criarLar(11);
    const itemId = await criarItem(connectionId);
    const db = dbComMedidor();
    const contaId = await criarConta(itemId);
    await inserirLinhas(db, [
      {
        household: householdId,
        item: itemId,
        conta: contaId,
        cartao: null,
        fatura: null,
        movement: "pix_enviado",
        localDate: "2026-11-05",
        amount: -100,
      },
      {
        household: householdId,
        item: itemId,
        conta: contaId,
        cartao: null,
        fatura: null,
        movement: "compra",
        localDate: "2026-11-20",
        amount: -200,
      },
    ]);
    await ensureCalendar(db, householdId, "2026-10-01", "2026-12-31");

    // Os comandos são preparados e executados pelo mesmo Db (o medidor da chamada é o do próprio Db).
    const primeiro = newMeter();
    const dbPrimeiro = dbComMedidor(primeiro);
    await dbPrimeiro.$client.batch(assignCycleKeysStmts(dbPrimeiro, householdId, { all: true }));
    // rows_written do D1 conta também as entradas dos índices (duas linhas com a chave nova dão 8, medido).
    expect(primeiro.rowsWritten).toBeGreaterThan(0);

    const segundo = newMeter();
    const dbSegundo = dbComMedidor(segundo);
    await dbSegundo.$client.batch(assignCycleKeysStmts(dbSegundo, householdId, { all: true }));
    expect(segundo.rowsWritten).toBe(0);
  });
});

describe("lançamento fora do calendário: a subconsulta dá NULL e a gravação não apaga chave", () => {
  // Calendário do dia 11 criado de 01/09/2026 a 31/12/2026: começa em 11/08/2026 e termina em 10/01/2027.
  async function larComCalendario(): Promise<{
    householdId: string;
    db: Db;
    contaId: string;
    itemId: string;
  }> {
    const { householdId, connectionId } = await criarLar(11);
    const itemId = await criarItem(connectionId);
    const contaId = await criarConta(itemId);
    const db = dbComMedidor();
    await ensureCalendar(db, householdId, "2026-09-01", "2026-12-31");
    return { householdId, db, contaId, itemId };
  }

  const linhaDeConta = (
    lar: { householdId: string; contaId: string; itemId: string },
    id: string,
    localDate: string,
  ): LinhaSemente => ({
    household: lar.householdId,
    item: lar.itemId,
    conta: lar.contaId,
    cartao: null,
    fatura: null,
    movement: "compra",
    localDate,
    amount: -100,
    id,
  });

  it("(i) lançamento depois do fim do calendário fica com cycle_key NULL, e a gravação não escreve nada", async () => {
    const lar = await larComCalendario();
    const id = "[TEST] depois-do-fim";
    // O último ciclo é de 12/12/2026 a 10/01/2027: 20/01/2027 passa do fim, mas a subconsulta acharia o último ciclo que começa antes.
    await inserirLinhas(lar.db, [linhaDeConta(lar, id, "2027-01-20")]);

    const medidor = newMeter();
    const gravador = dbComMedidor(medidor);
    await gravador.$client.batch(assignCycleKeysStmts(gravador, lar.householdId, { ids: [id] }));

    expect(await cicloDe(id)).toBeNull();
    expect(medidor.rowsWritten).toBe(0);
  });

  it("(ii) lançamento antes do começo do calendário também fica com cycle_key NULL, e a gravação não escreve nada", async () => {
    const lar = await larComCalendario();
    const id = "[TEST] antes-do-inicio";
    // O primeiro ciclo começa em 11/08/2026: 20/07/2026 é antes, e nenhum ciclo começa até essa data.
    await inserirLinhas(lar.db, [linhaDeConta(lar, id, "2026-07-20")]);

    const medidor = newMeter();
    const gravador = dbComMedidor(medidor);
    await gravador.$client.batch(assignCycleKeysStmts(gravador, lar.householdId, { ids: [id] }));

    expect(await cicloDe(id)).toBeNull();
    expect(medidor.rowsWritten).toBe(0);
  });

  it("(iii) lançamento fora do calendário que já tem chave guarda a chave: a gravação não a troca por NULL", async () => {
    const lar = await larComCalendario();
    const depois = "[TEST] fora-depois";
    const antes = "[TEST] fora-antes";
    await inserirLinhas(lar.db, [
      linhaDeConta(lar, depois, "2027-01-20"),
      linhaDeConta(lar, antes, "2026-07-20"),
    ]);
    // Chaves que já estavam gravadas, de um calendário anterior que cobria essas datas.
    await env.DB.batch([
      env.DB.prepare("UPDATE transactions SET cycle_key = ? WHERE id = ?").bind("2026-12", depois),
      env.DB.prepare("UPDATE transactions SET cycle_key = ? WHERE id = ?").bind("2026-08", antes),
    ]);

    const medidor = newMeter();
    const gravador = dbComMedidor(medidor);
    await gravador.$client.batch(assignCycleKeysStmts(gravador, lar.householdId, { ids: [depois, antes] }));

    expect(await cicloDe(depois)).toBe("2026-12");
    expect(await cicloDe(antes)).toBe("2026-08");
    expect(medidor.rowsWritten).toBe(0);
  });
});
