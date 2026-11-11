import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { classifyMovements, reconcileHousehold } from "../../../src/worker/bank/classify";
import { somaDias } from "../../../src/worker/bank/classify-rules";
import { processNewTransactions } from "../../../src/worker/categorization/pipeline";
import { assignCycleKeysStmts, faixaDeDatasStmts } from "../../../src/worker/cycle/assign";
import { assignCycleKeys, ensureCalendar } from "../../../src/worker/cycle/calendar";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import { AGORA, HOJE, inserirTransacao, type Lar } from "../helpers/regras";

// TASK-0302 (correção): as leituras da classificação e do ciclo não podem crescer com o lar. Um lar de 200 e um de
// 5.000 transações recebem o mesmo lote de ids; as linhas lidas têm que ser quase iguais e da ordem do lote e da
// vizinhança de ±10 dias. O EXPLAIN de cada comando (o que o teste executa) não pode ler o lar inteiro.

// D1 que anota o SQL e os parâmetros de cada comando preparado e executa tudo no D1 de teste (o medidor conta).
type Captura = { sql: string; params: unknown[] };
function d1Gravador(registro: Captura[]): D1Database {
  const d1 = env.DB;
  return {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => {
        registro.push({ sql, params });
        return d1.prepare(sql).bind(...params);
      },
    }),
    batch: (comandos: D1PreparedStatement[]) => d1.batch(comandos),
  } as unknown as D1Database;
}

const LOTE = 100;
const VIZINHANCA = 50;
// Limites por linha da janela e por linha tocada, com folga sobre o medido. A classificação lê a janela de ±10 dias
// (cada linha umas poucas vezes: índice e linha). O ciclo calcula a chave de cada lançamento tocado por subconsultas
// (cerca de 20 leituras por linha tocada), então o limite é por linha tocada, não pelo lar.
const LIMITE_DA_CLASSIFICACAO = 10 * (LOTE + VIZINHANCA);
const LIMITE_DO_CICLO = 30 * (LOTE + VIZINHANCA);
const NOME_DO_CARTAO_DE_FUNDO = "[TEST] Cartão de fundo";

type LarMedido = { lar: Lar; ids: string[] };

// Um lar direto no D1 (createHousehold recusa um segundo lar na instalação): titular, conexão, banco, conta e cartão.
// Sem a semente de categorias, que a classificação e o ciclo não leem.
async function criarLarDireto(): Promise<Lar> {
  const householdId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const bankItemId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const cardId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO households (id, brand, created_at) VALUES (?, 'matrimoney', ?)").bind(
      householdId,
      AGORA,
    ),
    env.DB.prepare(
      "INSERT INTO members (id, household_id, name, role, created_at) VALUES (?, ?, '[TEST] Pessoa A', 'titular', ?)",
    ).bind(memberId, householdId, AGORA),
    env.DB.prepare(
      "INSERT INTO pluggy_connections (id, household_id, label, created_at) VALUES (?, ?, '[TEST] Conexão', ?)",
    ).bind(connectionId, householdId, AGORA),
    env.DB.prepare(
      "INSERT INTO bank_items (id, connection_id, institution_name, created_at) VALUES (?, ?, '[TEST] Banco', ?)",
    ).bind(bankItemId, connectionId, AGORA),
    env.DB.prepare(
      "INSERT INTO accounts (id, bank_item_id, kind, name, balance_cents, overdraft_used_cents, balance_at) VALUES (?, ?, 'corrente', '[TEST] Conta', 0, 0, ?)",
    ).bind(accountId, bankItemId, AGORA),
    env.DB.prepare(
      "INSERT INTO cards (id, bank_item_id, last4, name) VALUES (?, ?, '1234', '[TEST] Cartão')",
    ).bind(cardId, bankItemId),
  ]);
  return { householdId, memberId, bankItemId, accountId, cardId };
}

// Lar com N transações: o lote (100 ids, de 2026-11-03 a 09, em conta e em cartão), a vizinhança (50 compras de
// 2026-10-26 a 11-14, a até 10 dias do lote, fora dele) e o fundo (N - 150 compras de 2022 a 2025, num segundo
// cartão). O fundo fica fora da janela do lote e fora do cartão do lote, então só o tamanho do lar muda.
async function montarLar(total: number): Promise<LarMedido> {
  const lar = await criarLarDireto();
  const cartaoDeFundo = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO cards (id, bank_item_id, last4, name) VALUES (?, ?, '5678', ?)")
    .bind(cartaoDeFundo, lar.bankItemId, NOME_DO_CARTAO_DE_FUNDO)
    .run();
  await ensureCalendar(createDb(env.DB, newMeter()), lar.householdId, "2026-01-01", "2027-12-31");

  const ids: string[] = [];
  for (let i = 0; i < LOTE; i++) {
    const localDate = somaDias("2026-11-03", i % 7);
    if (i % 4 === 0) {
      ids.push(
        await inserirTransacao(lar, {
          na: "conta",
          movement: "outro",
          amountCents: 2000 + i,
          descricao: `[TEST] RENDIMENTO POUPANCA ${i}`,
          localDate,
        }),
      );
    } else if (i % 4 === 1) {
      ids.push(
        await inserirTransacao(lar, {
          na: "conta",
          movement: "pix_enviado",
          amountCents: -(500 + i),
          descricao: `[TEST] Pix ${i}`,
          localDate,
        }),
      );
    } else {
      ids.push(
        await inserirTransacao(lar, {
          na: "cartao",
          movement: "compra",
          amountCents: -(1000 + i),
          descricao: `[TEST] Compra ${i}`,
          localDate,
        }),
      );
    }
  }
  for (let j = 0; j < VIZINHANCA; j++) {
    await inserirTransacao(lar, {
      na: "cartao",
      movement: "compra",
      amountCents: -(700 + j),
      descricao: `[TEST] Vizinha ${j}`,
      localDate: somaDias("2026-10-26", j % 20),
    });
  }
  const fundo = total - LOTE - VIZINHANCA;
  if (fundo > 0) {
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
       INSERT INTO transactions (id, household_id, external_id, bank_item_id, card_id, movement, occurred_at, local_date,
         amount_cents, original_description, establishment_key, last_seen_at)
       SELECT ? || '-fundo-' || i, ?, 'fundo-ext-' || i, ?, ?, 'compra',
         date('2022-01-01', '+' || (i % 1200) || ' days') || 'T12:00:00.000Z',
         date('2022-01-01', '+' || (i % 1200) || ' days'), -1000, '[TEST] Fundo', 'TEST FUNDO', ? FROM n`,
    )
      .bind(fundo, lar.householdId, lar.householdId, lar.bankItemId, cartaoDeFundo, AGORA)
      .run();
  }
  return { lar, ids };
}

type Medidas = { classificacao: number; reconciliacao: number; ciclo: number };
type Capturas = Record<string, Captura[]>;

// Roda a classificação, a conciliação e o ciclo do lote, cada um com o seu medidor e o seu registro de SQL. Os escopos
// que não são da importação (cartões e lar inteiro) só montam os comandos, para o EXPLAIN.
async function rodar(medido: LarMedido): Promise<{ medidas: Medidas; capturas: Capturas }> {
  const { lar, ids } = medido;
  const capturas: Capturas = {
    classificacao: [],
    reconciliacao: [],
    pipeline: [],
    ciclo: [],
    escopoCartao: [],
    escopoLar: [],
  };
  const medidorClassificacao = newMeter();
  await classifyMovements(
    createDb(d1Gravador(capturas.classificacao), medidorClassificacao),
    lar.householdId,
    ids,
    AGORA,
  );
  const medidorConciliacao = newMeter();
  await reconcileHousehold(
    createDb(d1Gravador(capturas.reconciliacao), medidorConciliacao),
    lar.householdId,
    HOJE,
    AGORA,
  );
  await processNewTransactions(
    createDb(d1Gravador(capturas.pipeline), newMeter()),
    lar.householdId,
    ids,
    AGORA,
  );
  const medidorCiclo = newMeter();
  await assignCycleKeys(createDb(d1Gravador(capturas.ciclo), medidorCiclo), lar.householdId, ids);

  const dbCartao = createDb(d1Gravador(capturas.escopoCartao), newMeter());
  faixaDeDatasStmts(dbCartao, lar.householdId, { cardIds: [lar.cardId] });
  assignCycleKeysStmts(dbCartao, lar.householdId, { cardIds: [lar.cardId] });
  assignCycleKeysStmts(createDb(d1Gravador(capturas.escopoLar), newMeter()), lar.householdId, { all: true });

  return {
    medidas: {
      classificacao: medidorClassificacao.rowsRead,
      reconciliacao: medidorConciliacao.rowsRead,
      ciclo: medidorCiclo.rowsRead,
    },
    capturas,
  };
}

async function planoDe(captura: Captura): Promise<string[]> {
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${captura.sql}`)
    .bind(...captura.params)
    .all<{ detail: string }>();
  return results.map((linha) => linha.detail);
}

// Passos de transactions que leem o lar inteiro: um SCAN sem chave, ou uma busca só pelo índice do lar
// (household_id=?). Busca por id, por cartão ou por intervalo de data tem chave e não entra aqui. Os aliases são os
// do SQL de bank/classify.ts, categorization/pipeline.ts e cycle/assign.ts.
const PASSO_EM_TRANSACOES = /^(SEARCH|SCAN) (transactions|t|x|y)( |$)/;
const SO_O_INDICE_DO_LAR = /\(household_id=\?\)$/;
function passosQueLeemOLar(plano: string[], escopoLar: boolean): string[] {
  return plano.filter((passo) => {
    if (!PASSO_EM_TRANSACOES.test(passo)) return false;
    if (passo.startsWith("SCAN ")) return true;
    return !escopoLar && SO_O_INDICE_DO_LAR.test(passo);
  });
}

describe("classificação e ciclo não leem o lar inteiro (lar de 200 e de 5.000 transações)", () => {
  it("EXPLAIN de cada comando sem leitura do lar, e rowsRead quase igual nos dois lares", async () => {
    const pequeno = await montarLar(200);
    const grande = await montarLar(5000);
    const medidasPequeno = await rodar(pequeno);
    const medidasGrande = await rodar(grande);

    console.info(
      `[medicao] rowsRead 200 transações: classificacao=${medidasPequeno.medidas.classificacao} reconciliacao=${medidasPequeno.medidas.reconciliacao} ciclo=${medidasPequeno.medidas.ciclo}`,
    );
    console.info(
      `[medicao] rowsRead 5.000 transações: classificacao=${medidasGrande.medidas.classificacao} reconciliacao=${medidasGrande.medidas.reconciliacao} ciclo=${medidasGrande.medidas.ciclo}`,
    );

    // EXPLAIN: cada comando que o lar de 5.000 executou ou montou. O escopo do lar inteiro (rebuildFutureCalendar)
    // lê o lar por desenho; nele só se confere que não há SCAN sem chave.
    const violacoes: string[] = [];
    for (const [nome, lista] of Object.entries(medidasGrande.capturas)) {
      const escopoLar = nome === "escopoLar";
      for (const captura of lista) {
        const plano = await planoDe(captura);
        const sqlCurto = captura.sql.replace(/\s+/g, " ").slice(0, 110);
        console.info(`[plano] ${nome} :: ${sqlCurto} => ${plano.join(" | ")}`);
        const lendo = passosQueLeemOLar(plano, escopoLar);
        if (lendo.length > 0) violacoes.push(`${nome} :: ${sqlCurto} => ${lendo.join(" | ")}`);
      }
    }
    expect(violacoes, "comandos que leem o lar inteiro").toEqual([]);

    // rowsRead: a mesma classificação, conciliação e ciclo, com o lar de 200 e o de 5.000.
    const razao = (chave: keyof Medidas): number =>
      medidasGrande.medidas[chave] / medidasPequeno.medidas[chave];
    expect(razao("classificacao")).toBeLessThan(1.5);
    expect(razao("reconciliacao")).toBeLessThan(1.5);
    expect(razao("ciclo")).toBeLessThan(1.5);

    // Não lê o lar inteiro: as linhas lidas são da ordem do lote e da vizinhança, não das 5.000 transações.
    expect(medidasGrande.medidas.classificacao).toBeLessThanOrEqual(LIMITE_DA_CLASSIFICACAO);
    expect(medidasGrande.medidas.ciclo).toBeLessThanOrEqual(LIMITE_DO_CICLO);
  });
});
