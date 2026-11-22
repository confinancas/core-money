import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  classifyMovements,
  reconcileHousehold,
  SQL_CANDIDATAS_DA_JANELA,
} from "../../../src/worker/bank/classify";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import { AGORA, criarLar, HOJE, inserirTransacao, type Lar } from "../helpers/regras";

// TASK-0208, fase 2b: a classificação lê só os candidatos (as linhas dos ids e as do lar, na janela de datas, de mesmo
// valor absoluto que alguma linha dos ids). Prova: (1) o resultado no banco é o da leitura da janela inteira (aqui, a
// conciliação, que lê a faixa toda e aplica as mesmas regras); (2) o que volta ao Worker é só o candidato, num lar com
// 1.500 linhas de valores diferentes na janela; (3) o plano da consulta usa o índice (lar, data) e a chave primária.

const FUNDO = 1500;
const COLUNAS_DA_CLASSIFICACAO =
  "id, movement, movement_original, income_kind, income_subtype, categorized_by, categorized_at, spend_type, spend_type_source";

type Estado = {
  id: string;
  movement: string;
  movement_original: string | null;
  income_kind: string | null;
  income_subtype: string | null;
  categorized_by: string | null;
  categorized_at: string | null;
  spend_type: string | null;
  spend_type_source: string | null;
};

async function estadoDoLar(householdId: string): Promise<Map<string, Estado>> {
  const { results } = await env.DB.prepare(
    `SELECT ${COLUNAS_DA_CLASSIFICACAO} FROM transactions WHERE household_id = ?`,
  )
    .bind(householdId)
    .all<Estado>();
  return new Map(results.map((linha) => [linha.id, linha]));
}

async function restaurar(estado: Map<string, Estado>, atual: Map<string, Estado>): Promise<void> {
  for (const [id, antes] of estado) {
    if (JSON.stringify(atual.get(id)) === JSON.stringify(antes)) continue;
    await env.DB.prepare(
      `UPDATE transactions SET movement = ?, movement_original = ?, income_kind = ?, income_subtype = ?,
         categorized_by = ?, categorized_at = ?, spend_type = ?, spend_type_source = ? WHERE id = ?`,
    )
      .bind(
        antes.movement,
        antes.movement_original,
        antes.income_kind,
        antes.income_subtype,
        antes.categorized_by,
        antes.categorized_at,
        antes.spend_type,
        antes.spend_type_source,
        id,
      )
      .run();
  }
}

type LarComLote = { lar: Lar; ids: string[]; casam: number };

// Lar com 1.500 linhas de fundo (valores todos diferentes, de 28/10 a 08/11), 30 pagamentos de fatura do cartão (lote)
// com a saída de mesmo valor já no lar, 10 transferências com prova (lote) com a entrada de mesmo valor em outra conta, e
// 20 compras sem par (lote). O lar fica estável (conciliado) antes de o lote entrar.
async function montarLarComLote(): Promise<LarComLote> {
  const lar = await criarLar();
  const outraConta = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO accounts (id, bank_item_id, kind, name, balance_cents, overdraft_used_cents, balance_at) VALUES (?, ?, 'corrente', '[TEST] Conta 2', 0, 0, ?)",
  )
    .bind(outraConta, lar.bankItemId, AGORA)
    .run();
  const lar2: Lar = { ...lar, accountId: outraConta };

  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
     INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, movement, occurred_at,
       local_date, amount_cents, original_description, establishment_key, last_seen_at)
     SELECT ? || '-fundo-' || i, ?, 'fundo-ext-' || i, ?, CASE WHEN i % 2 = 0 THEN ? END, CASE WHEN i % 2 = 1 THEN ? END,
       CASE WHEN i % 2 = 0 THEN 'pix_enviado' ELSE 'compra' END,
       date('2026-10-28', '+' || (i % 12) || ' days') || 'T12:00:00.000Z', date('2026-10-28', '+' || (i % 12) || ' days'),
       -(20000 + i), '[TEST] Fundo ' || i, 'TEST FUNDO', ? FROM n`,
  )
    .bind(FUNDO, lar.householdId, lar.householdId, lar.bankItemId, lar.accountId, lar.cardId, AGORA)
    .run();
  // Já no lar: as saídas de mesmo valor dos pagamentos de fatura e as entradas das transferências.
  for (let k = 0; k < 30; k++) {
    await inserirTransacao(lar, {
      movement: "pix_enviado",
      amountCents: -(5000 + k),
      descricao: `[TEST] PIX ENVIADO ${k}`,
      localDate: "2026-11-01",
    });
  }
  for (let k = 0; k < 10; k++) {
    await inserirTransacao(lar2, {
      movement: "pix_recebido",
      amountCents: 7000 + k,
      descricao: `[TEST] PIX RECEBIDO ${k}`,
      localDate: "2026-11-03",
    });
  }
  const db = createDb(env.DB, newMeter());
  await reconcileHousehold(db, lar.householdId, HOJE, AGORA);

  const ids: string[] = [];
  for (let k = 0; k < 30; k++) {
    ids.push(
      await inserirTransacao(lar, {
        na: "cartao",
        movement: "pagamento_fatura",
        amountCents: 5000 + k,
        descricao: `[TEST] PAGAMENTO FATURA ${k}`,
        localDate: `2026-11-0${2 + (k % 4)}`,
      }),
    );
  }
  for (let k = 0; k < 10; k++) {
    ids.push(
      await inserirTransacao(lar, {
        movement: "pix_enviado",
        amountCents: -(7000 + k),
        descricao: `[TEST] PIX PARA OUTRA CONTA ${k}`,
        localDate: "2026-11-03",
      }),
    );
  }
  for (let k = 0; k < 20; k++) {
    ids.push(
      await inserirTransacao(lar, {
        na: "cartao",
        movement: "compra",
        amountCents: -(900 + k),
        descricao: `[TEST] COMPRA ${k}`,
        localDate: "2026-11-04",
      }),
    );
  }
  await env.DB.prepare(
    "UPDATE transactions SET provider_operation_type = 'PAGAMENTO_FATURA' WHERE id IN (SELECT value FROM json_each(?))",
  )
    .bind(JSON.stringify(ids.slice(0, 30)))
    .run();
  await env.DB.prepare(
    "UPDATE transactions SET provider_category = 'Same person transfer - PIX' WHERE id IN (SELECT value FROM json_each(?))",
  )
    .bind(JSON.stringify(ids.slice(30, 40)))
    .run();
  return { lar, ids, casam: 40 };
}

describe("classificação lê só os candidatos (TASK-0208, fase 2b)", () => {
  it("dá o mesmo estado do banco que a leitura da janela inteira, num lar de 1.500 linhas de valores diferentes", async () => {
    const { lar, ids } = await montarLarComLote();
    const antes = await estadoDoLar(lar.householdId);

    const db = createDb(env.DB, newMeter());
    const mudaram = await classifyMovements(db, lar.householdId, ids, AGORA);
    const filtrada = await estadoDoLar(lar.householdId);

    // O caminho de antes: a janela inteira (a conciliação lê a faixa toda e aplica as mesmas regras).
    await restaurar(antes, filtrada);
    expect(await estadoDoLar(lar.householdId)).toEqual(antes);
    await reconcileHousehold(createDb(env.DB, newMeter()), lar.householdId, HOJE, AGORA);
    const inteira = await estadoDoLar(lar.householdId);

    expect(filtrada).toEqual(inteira);
    // Não passou em branco: os pagamentos de fatura e as transferências do lote e as saídas pareadas mudaram.
    expect(mudaram).toBe(30 + 30 + 10 + 10);
    const pagamentos = [...filtrada.values()].filter((linha) => linha.movement === "pagamento_fatura");
    expect(pagamentos).toHaveLength(60);
    const internas = [...filtrada.values()].filter((linha) => linha.movement === "transferencia_interna");
    expect(internas).toHaveLength(20);
    // O fundo (valores sem par) não mudou.
    for (const [id, linha] of filtrada) {
      if (id.includes("-fundo-")) expect(linha).toEqual(antes.get(id));
    }
  });

  it("o que volta ao Worker são os candidatos (dezenas), não a janela de 1.500 linhas; o plano usa índice", async () => {
    const { lar, ids } = await montarLarComLote();
    const devolvidas: number[] = [];
    const d1 = {
      prepare: (sql: string) => ({ bind: (...params: unknown[]) => env.DB.prepare(sql).bind(...params) }),
      batch: async (comandos: D1PreparedStatement[]) => {
        const resultados = await env.DB.batch(comandos);
        devolvidas.push(resultados[0]?.results.length ?? -1);
        return resultados;
      },
    } as unknown as D1Database;
    const medidor = newMeter();
    await classifyMovements(createDb(d1, medidor), lar.householdId, ids, AGORA);

    const janela = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM transactions WHERE household_id = ? AND removed_at IS NULL
         AND local_date BETWEEN date('2026-11-02', '-10 days') AND date('2026-11-05', '+10 days')`,
    )
      .bind(lar.householdId)
      .first<{ n: number }>();
    const naJanela = janela?.n ?? 0;
    expect(naJanela).toBeGreaterThan(FUNDO);

    // Dois grupos de ids (45 por janela, 60 ids): a primeira leitura cobre 45 ids; o total devolvido é o dos candidatos.
    const candidatas = devolvidas[0] ?? -1;
    console.info(
      `[medicao] classificacao: janela=${naJanela} linhas; candidatas devolvidas na 1a janela=${candidatas}; rowsRead do medidor=${medidor.rowsRead}`,
    );
    expect(candidatas).toBeGreaterThan(0);
    // Antes, a primeira janela devolvia as 1.500+ linhas; agora, só o lote e as de mesmo valor.
    expect(candidatas).toBeLessThanOrEqual(ids.length + 60);
    expect(candidatas).toBeLessThan(naJanela / 10);

    // EXPLAIN: a janela de datas pelo índice (household_id, local_date) e a busca dos ids pela chave primária; nenhum
    // SCAN de transactions sem chave (o SCAN de json_each é o laço de fora do lote, de poucos ids).
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${SQL_CANDIDATAS_DA_JANELA}`)
      .bind(JSON.stringify(ids.slice(0, 45)), lar.householdId, "-10 days", "+10 days")
      .all<{ detail: string }>();
    const plano = results.map((linha) => linha.detail);
    console.info(`[plano] ${plano.join(" | ")}`);
    expect(plano.some((passo) => /transactions_household_local_date_idx/.test(passo))).toBe(true);
    expect(plano.filter((passo) => /^SCAN transactions/.test(passo))).toEqual([]);
  });
});
