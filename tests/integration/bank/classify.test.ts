import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { classifyMovements, reconcileHousehold } from "../../../src/worker/bank/classify";
import type { BillRow, MappedTransaction } from "../../../src/worker/bank/map";
import {
  ingestTransactions,
  upsertAccountsStmts,
  upsertBillsStmts,
  upsertCardsStmts,
} from "../../../src/worker/bank/repository";
import { createDb, type Db } from "../../../src/worker/db/client";
import { type Meter, newMeter } from "../../../src/worker/db/metered-d1";

const AGORA = "2026-11-10T12:00:00.000Z";
const NOVEMBRO_UM = "2026-11-01T12:00:00.000Z";

const dbComMedidor = (medidor: Meter = newMeter()): Db => createDb(env.DB, medidor);

// D1 que conta os parâmetros de cada comando (sem mudar o que executa). O teste de custo lê o maior número.
function d1Espiado(registro: { maiorComando: number }): D1Database {
  const d1 = env.DB;
  return {
    prepare: (sql: string) => {
      const comando = d1.prepare(sql);
      return {
        bind: (...valores: unknown[]) => {
          registro.maiorComando = Math.max(registro.maiorComando, valores.length);
          return comando.bind(...valores);
        },
      } as unknown as D1PreparedStatement;
    },
    batch: (comandos: D1PreparedStatement[]) => d1.batch(comandos),
  } as unknown as D1Database;
}

async function criarLar(): Promise<{ householdId: string; connectionId: string }> {
  const householdId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO households (id, brand, created_at) VALUES (?, 'matrimoney', ?)").bind(
      householdId,
      AGORA,
    ),
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

async function criarConta(db: Db, bankItemId: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.$client.batch(
    upsertAccountsStmts(
      db,
      bankItemId,
      [{ id, kind: "corrente", name: "[TEST] Conta", balance_cents: 100000, overdraft_used_cents: 0 }],
      AGORA,
    ),
  );
  return id;
}

// Cartão do banco "Nubank" (o nome vale para a regra de fatura com o banco do lar).
async function criarCartao(db: Db, bankItemId: string): Promise<string> {
  const cardId = crypto.randomUUID();
  await db.$client.batch(
    upsertCardsStmts(db, bankItemId, [
      { id: cardId, last4: "1234", name: "[TEST] Cartão", limit_cents: 500000, available_cents: 400000 },
    ]),
  );
  const aberta: BillRow = {
    id: `sint:${cardId}:2026-11-03`,
    closes_on: "2026-11-03",
    due_on: "2026-11-10",
    amount_cents: 12000,
    status: "aberta",
    paid_on: null,
  };
  await db.$client.batch(upsertBillsStmts(db, { id: cardId }, [], aberta));
  return cardId;
}

// Movimento completo. Conta ou cartão vêm do teste (a regra do banco exige um dos dois).
const movimento = (extra: Partial<MappedTransaction> = {}): MappedTransaction => ({
  external_id: `[TEST] ext-${crypto.randomUUID()}`,
  account_id: null,
  card_id: null,
  bill_id: null,
  futura: null,
  movement: "outro",
  occurred_at: "2026-11-05T14:00:00.000Z",
  local_date: "2026-11-05",
  amount_cents: -1000,
  original_description: "[TEST] Movimento",
  establishment_key: "[TEST] MOVIMENTO",
  counterparty_name: null,
  counterparty_doc_masked: null,
  counterparty_bank: null,
  installment_number: null,
  installment_total: null,
  provider_category: null,
  provider_operation_type: null,
  ...extra,
});

const estadoDe = (externalId: string) =>
  env.DB.prepare(
    "SELECT movement, movement_original, movement_locked, income_kind, income_subtype, categorized_by, categorized_at FROM transactions WHERE external_id = ?",
  )
    .bind(externalId)
    .first<{
      movement: string;
      movement_original: string | null;
      movement_locked: number;
      income_kind: string | null;
      income_subtype: string | null;
      categorized_by: string | null;
      categorized_at: string | null;
    }>();

const idDe = async (externalId: string): Promise<string> => {
  const linha = await env.DB.prepare("SELECT id FROM transactions WHERE external_id = ?")
    .bind(externalId)
    .first<{ id: string }>();
  if (!linha) throw new Error(`linha ${externalId} não encontrada`);
  return linha.id;
};

const contar = async (sql: string, ...valores: unknown[]): Promise<number> => {
  const linha = await env.DB.prepare(sql)
    .bind(...valores)
    .first<{ total: number }>();
  return linha?.total ?? 0;
};

describe("classificação pela gravação: o casal", () => {
  it("1. pagamento do casal: as duas são pagamento_fatura, a do cartão com transferência, sem gasto nem renda", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId, "Nubank");
    const db = dbComMedidor();
    const contaId = await criarConta(db, itemId);
    const cartaoId = await criarCartao(db, itemId);

    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [
        movimento({
          account_id: contaId,
          external_id: "[TEST] ext-saida-fatura",
          movement: "outro",
          local_date: "2026-11-05",
          amount_cents: -287040,
          original_description: "[TEST] PAG FATURA CARTAO",
        }),
        pagamentoDoCartao(cartaoId, "[TEST] ext-entrada-fatura", "2026-11-06", 287040),
      ],
      now: AGORA,
    });

    expect(await estadoDe("[TEST] ext-saida-fatura")).toMatchObject({
      movement: "pagamento_fatura",
      movement_original: "outro",
      income_kind: null,
    });
    expect(await estadoDe("[TEST] ext-entrada-fatura")).toMatchObject({
      movement: "pagamento_fatura",
      income_kind: "transferencia",
      income_subtype: null,
      categorized_by: "regra",
      categorized_at: AGORA,
    });
  });

  it("2. ordem inversa: a do cartão gravada antes ganha par quando a da conta chega dois dias depois", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId, "Nubank");
    const db = dbComMedidor();
    const contaId = await criarConta(db, itemId);
    const cartaoId = await criarCartao(db, itemId);

    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [pagamentoDoCartao(cartaoId, "[TEST] ext-cartao-antes", "2026-11-08", 287040)],
      now: AGORA,
    });
    expect(await estadoDe("[TEST] ext-cartao-antes")).toMatchObject({
      movement: "pagamento_fatura",
      income_kind: null,
    });

    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [
        movimento({
          account_id: contaId,
          external_id: "[TEST] ext-conta-depois",
          movement: "pix_enviado",
          local_date: "2026-11-10",
          amount_cents: -287040,
          original_description: "[TEST] PIX ENVIADO",
        }),
      ],
      now: AGORA,
    });

    expect(await estadoDe("[TEST] ext-cartao-antes")).toMatchObject({
      movement: "pagamento_fatura",
      income_kind: "transferencia",
      categorized_by: "regra",
    });
    expect(await estadoDe("[TEST] ext-conta-depois")).toMatchObject({ movement: "pagamento_fatura" });
  });

  it("3. terceiro paga a fatura: pix_recebido sem renda no quinto dia (conciliação), pagamento_fatura no quarto", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId, "Nubank");
    const db = dbComMedidor();
    const cartaoId = await criarCartao(db, itemId);

    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [pagamentoDoCartao(cartaoId, "[TEST] ext-terceiro", "2026-11-01", 150000)],
      now: NOVEMBRO_UM,
    });
    expect(await estadoDe("[TEST] ext-terceiro")).toMatchObject({
      movement: "pagamento_fatura",
      income_kind: null,
    });

    // Quarto dia depois: ainda é pagamento de fatura.
    await reconcileHousehold(db, householdId, "2026-11-05", NOVEMBRO_UM);
    expect(await estadoDe("[TEST] ext-terceiro")).toMatchObject({
      movement: "pagamento_fatura",
      income_kind: null,
    });

    // Quinto dia: pagamento por terceiro, na fila de entradas (contrato com a TASK-0902).
    const mudou = await reconcileHousehold(db, householdId, "2026-11-06", NOVEMBRO_UM);
    expect(mudou).toBe(1);
    expect(await estadoDe("[TEST] ext-terceiro")).toMatchObject({
      movement: "pix_recebido",
      income_kind: null,
      categorized_by: null,
    });
    const naFila = await contar(
      "SELECT COUNT(*) AS total FROM transactions WHERE external_id = ? AND movement IN ('pix_recebido','ted_recebida','outro') AND amount_cents > 0 AND income_kind IS NULL",
      "[TEST] ext-terceiro",
    );
    expect(naFila).toBe(1);
  });

  it("4. terceiro, mas chegou o par: volta a pagamento_fatura e transferência, e a movement_original fica", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId, "Nubank");
    const db = dbComMedidor();
    const contaId = await criarConta(db, itemId);
    const cartaoId = await criarCartao(db, itemId);

    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [pagamentoDoCartao(cartaoId, "[TEST] ext-volta", "2026-11-01", 150000)],
      now: NOVEMBRO_UM,
    });
    await reconcileHousehold(db, householdId, "2026-11-06", NOVEMBRO_UM);
    expect(await estadoDe("[TEST] ext-volta")).toMatchObject({ movement: "pix_recebido" });

    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [
        movimento({
          account_id: contaId,
          external_id: "[TEST] ext-saida-volta",
          movement: "pix_enviado",
          local_date: "2026-11-03",
          amount_cents: -150000,
          original_description: "[TEST] PIX ENVIADO NU",
        }),
      ],
      now: AGORA,
    });

    expect(await estadoDe("[TEST] ext-volta")).toMatchObject({
      movement: "pagamento_fatura",
      movement_original: "pagamento_fatura",
      income_kind: "transferencia",
      categorized_by: "regra",
    });
    expect(await estadoDe("[TEST] ext-saida-volta")).toMatchObject({ movement: "pagamento_fatura" });
  });

  it("6. Pix entre o casal: as duas são transferência interna, e a entrada tem a marca de transferência", async () => {
    const { householdId, connectionId } = await criarLar();
    await env.DB.prepare("UPDATE pluggy_connections SET cpf_masked = '***.111.222-**' WHERE id = ?")
      .bind(connectionId)
      .run();
    const conexaoB = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO pluggy_connections (id, household_id, label, cpf_masked, created_at) VALUES (?, ?, '[TEST] Conexão B', '***.456.789-**', ?)",
    )
      .bind(conexaoB, householdId, AGORA)
      .run();
    const itemA = await criarItem(connectionId, "[TEST] Banco A");
    const itemB = await criarItem(conexaoB, "[TEST] Banco B");
    const db = dbComMedidor();
    const contaA = await criarConta(db, itemA);
    const contaB = await criarConta(db, itemB);

    await ingestTransactions(db, {
      householdId,
      bankItemId: itemA,
      rows: [
        movimento({
          account_id: contaA,
          external_id: "[TEST] ext-pix-casal-saida",
          movement: "pix_enviado",
          local_date: "2026-11-05",
          amount_cents: -50000,
          counterparty_doc_masked: "***.456.789-**",
        }),
      ],
      now: AGORA,
    });
    await ingestTransactions(db, {
      householdId,
      bankItemId: itemB,
      rows: [
        movimento({
          account_id: contaB,
          external_id: "[TEST] ext-pix-casal-entrada",
          movement: "pix_recebido",
          local_date: "2026-11-05",
          amount_cents: 50000,
          counterparty_doc_masked: "***.111.222-**",
        }),
      ],
      now: AGORA,
    });

    expect(await estadoDe("[TEST] ext-pix-casal-saida")).toMatchObject({ movement: "transferencia_interna" });
    expect(await estadoDe("[TEST] ext-pix-casal-entrada")).toMatchObject({
      movement: "transferencia_interna",
      income_kind: "transferencia",
      categorized_by: "regra",
    });
  });

  it("11. o casal manda: a entrada categorizada por membro não muda quando chega o par", async () => {
    const { householdId, connectionId } = await criarLar();
    const conexaoB = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO pluggy_connections (id, household_id, label, cpf_masked, created_at) VALUES (?, ?, '[TEST] Conexão B', '***.456.789-**', ?)",
    )
      .bind(conexaoB, householdId, AGORA)
      .run();
    const itemA = await criarItem(connectionId, "[TEST] Banco A");
    const itemB = await criarItem(conexaoB, "[TEST] Banco B");
    const db = dbComMedidor();
    const contaA = await criarConta(db, itemA);
    const contaB = await criarConta(db, itemB);

    await ingestTransactions(db, {
      householdId,
      bankItemId: itemB,
      rows: [
        movimento({
          account_id: contaB,
          external_id: "[TEST] ext-casal-manda",
          movement: "pix_recebido",
          local_date: "2026-11-05",
          amount_cents: 50000,
          counterparty_doc_masked: "***.111.222-**",
        }),
      ],
      now: AGORA,
    });
    await env.DB.prepare(
      "UPDATE transactions SET income_kind = 'variavel', income_subtype = 'venda', categorized_by = 'membro-1', categorized_at = ? WHERE external_id = ?",
    )
      .bind(AGORA, "[TEST] ext-casal-manda")
      .run();

    await ingestTransactions(db, {
      householdId,
      bankItemId: itemA,
      rows: [
        movimento({
          account_id: contaA,
          external_id: "[TEST] ext-casal-manda-saida",
          movement: "pix_enviado",
          local_date: "2026-11-05",
          amount_cents: -50000,
          counterparty_doc_masked: "***.456.789-**",
        }),
      ],
      now: AGORA,
    });

    expect(await estadoDe("[TEST] ext-casal-manda")).toMatchObject({
      movement: "pix_recebido",
      income_kind: "variavel",
      income_subtype: "venda",
      categorized_by: "membro-1",
    });
    expect(await estadoDe("[TEST] ext-casal-manda-saida")).toMatchObject({
      movement: "transferencia_interna",
    });
  });

  it("13. Pix que paga a fatura: sai do gasto com movement_original pix_enviado, e nada vira pagamento por terceiro", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId, "Nubank");
    const db = dbComMedidor();
    const contaId = await criarConta(db, itemId);
    const cartaoId = await criarCartao(db, itemId);

    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [
        movimento({
          account_id: contaId,
          external_id: "[TEST] ext-pix-fatura",
          movement: "pix_enviado",
          local_date: "2026-11-05",
          amount_cents: -287040,
          original_description: "[TEST] PIX ENVIADO NU PAGAMENTOS",
        }),
        pagamentoDoCartao(cartaoId, "[TEST] ext-pix-fatura-cartao", "2026-11-06", 287040),
      ],
      now: AGORA,
    });

    expect(await estadoDe("[TEST] ext-pix-fatura")).toMatchObject({
      movement: "pagamento_fatura",
      movement_original: "pix_enviado",
    });
    expect(await estadoDe("[TEST] ext-pix-fatura-cartao")).toMatchObject({
      movement: "pagamento_fatura",
      income_kind: "transferencia",
    });
    expect(await contar("SELECT COUNT(*) AS total FROM transactions WHERE movement = 'pix_recebido'")).toBe(
      0,
    );
  });
});

describe("classificação pela gravação: travas, reconciliação e custo", () => {
  // Cada trava: a linha de estorno é classificada, depois se põe o estado e a trava, e a classificação roda de novo.
  // O controle (sem trava) muda; a linha com a trava não muda.
  const casos: { nome: string; externo: string; sql: string; protegida: boolean }[] = [
    { nome: "oculta", externo: "[TEST] ext-oculta", sql: "hidden = 1", protegida: true },
    { nome: "sem trava (controle)", externo: "[TEST] ext-livre", sql: "hidden = 0", protegida: false },
    { nome: "travada", externo: "[TEST] ext-travada", sql: "movement_locked = 1", protegida: true },
    {
      nome: "categorizada por membro",
      externo: "[TEST] ext-membro",
      sql: "categorized_by = 'membro-1', categorized_at = '2026-11-09T20:00:00.000Z'",
      protegida: true,
    },
    {
      nome: "categorizada pela IA (não protegida)",
      externo: "[TEST] ext-ia",
      sql: "categorized_by = 'ia'",
      protegida: false,
    },
    {
      nome: "removida",
      externo: "[TEST] ext-removida",
      sql: "removed_at = '2026-11-09T00:00:00.000Z'",
      protegida: true,
    },
  ];

  it("as travas (oculta, travada, de membro, removida) não mudam; sem a trava, muda", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId);
    const db = dbComMedidor();
    const contaId = await criarConta(db, itemId);

    for (const caso of casos) {
      await ingestTransactions(db, {
        householdId,
        bankItemId: itemId,
        rows: [
          movimento({
            account_id: contaId,
            external_id: caso.externo,
            movement: "pix_recebido",
            amount_cents: 6000,
            original_description: "[TEST] PIX DEVOLVIDO",
            local_date: "2026-11-05",
          }),
        ],
        now: AGORA,
      });
    }
    // Estado de partida: todas voltam a pix_recebido, e a trava de cada caso é posta.
    for (const caso of casos) {
      await env.DB.prepare(
        `UPDATE transactions SET movement = 'pix_recebido', movement_original = NULL, income_kind = NULL, ${caso.sql} WHERE external_id = ?`,
      )
        .bind(caso.externo)
        .run();
    }
    const ids = await Promise.all(casos.map((caso) => idDe(caso.externo)));
    await classifyMovements(db, householdId, ids, AGORA);

    for (const caso of casos) {
      const atual = await estadoDe(caso.externo);
      if (caso.protegida) {
        expect(atual?.movement, caso.nome).toBe("pix_recebido");
      } else {
        expect(atual?.movement, caso.nome).toBe("estorno");
      }
    }
  });

  it("12. idempotência: rodar de novo não muda nada, e a linha oculta fica como está", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId);
    const db = dbComMedidor();
    const contaId = await criarConta(db, itemId);
    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [
        movimento({
          account_id: contaId,
          external_id: "[TEST] ext-idem-oculta",
          movement: "pix_recebido",
          amount_cents: 6000,
          original_description: "[TEST] PIX DEVOLVIDO",
          local_date: "2026-11-05",
        }),
        movimento({
          account_id: contaId,
          external_id: "[TEST] ext-idem-rendimento",
          movement: "outro",
          amount_cents: 1234,
          original_description: "[TEST] RENDIMENTO CAIXINHA",
          local_date: "2026-11-05",
        }),
      ],
      now: AGORA,
    });
    await env.DB.prepare(
      "UPDATE transactions SET hidden = 1, movement = 'pix_recebido' WHERE external_id = ?",
    )
      .bind("[TEST] ext-idem-oculta")
      .run();
    const ids = await Promise.all(["[TEST] ext-idem-oculta", "[TEST] ext-idem-rendimento"].map(idDe));

    const primeira = await classifyMovements(db, householdId, ids, AGORA);
    const segunda = await classifyMovements(db, householdId, ids, AGORA);

    expect(primeira).toBe(0);
    expect(segunda).toBe(0);
    expect(await estadoDe("[TEST] ext-idem-oculta")).toMatchObject({ movement: "pix_recebido" });
    expect(await estadoDe("[TEST] ext-idem-rendimento")).toMatchObject({
      movement: "rendimento",
      income_kind: "variavel",
      income_subtype: "rendimento",
    });
  });

  it("classificação de 200 linhas: até 2 idas ao D1 e nenhum comando com mais de 100 parâmetros", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId, "Nubank");
    const db = dbComMedidor();
    const contaId = await criarConta(db, itemId);
    const cartaoId = await criarCartao(db, itemId);

    // 100 saídas da conta e 100 entradas no cartão de mesmo valor, com a data em 1 a 9 de novembro: 100 pares.
    const duzentas: MappedTransaction[] = Array.from({ length: 200 }, (_, i) => {
      const par = i % 100;
      const dia = `2026-11-${String(1 + (par % 9)).padStart(2, "0")}`;
      return i < 100
        ? movimento({
            account_id: contaId,
            external_id: `[TEST] lote-c-${i}`,
            movement: "outro",
            local_date: dia,
            amount_cents: -(1000 + par),
            original_description: "[TEST] PAG FATURA CARTAO",
          })
        : pagamentoDoCartao(cartaoId, `[TEST] lote-c-${i}`, dia, 1000 + par);
    });
    await ingestTransactions(db, { householdId, bankItemId: itemId, rows: duzentas, now: AGORA });

    // Volta ao estado da gravação (sem classificação) para que a classificação medida tenha o que escrever.
    await env.DB.prepare(
      "UPDATE transactions SET movement = COALESCE(movement_original, movement), movement_original = NULL, income_kind = NULL, income_subtype = NULL, categorized_by = NULL, categorized_at = NULL WHERE household_id = ?",
    )
      .bind(householdId)
      .run();
    const ids = await Promise.all(duzentas.map((linha) => idDe(linha.external_id)));

    const registro = { maiorComando: 0 };
    const medidor = newMeter();
    const dbMedido = createDb(d1Espiado(registro), medidor);
    const escritas = await classifyMovements(dbMedido, householdId, ids, AGORA);

    expect(escritas).toBe(200);
    expect(medidor.calls).toBe(2);
    expect(registro.maiorComando).toBeLessThanOrEqual(100);
    expect(
      await contar("SELECT COUNT(*) AS total FROM transactions WHERE movement = 'pagamento_fatura'"),
    ).toBe(200);
    expect(
      await contar("SELECT COUNT(*) AS total FROM transactions WHERE income_kind = 'transferencia'"),
    ).toBe(100);

    // Segunda passada: nada a escrever, uma ida só.
    const medidorDois = newMeter();
    expect(
      await classifyMovements(createDb(d1Espiado({ maiorComando: 0 }), medidorDois), householdId, ids, AGORA),
    ).toBe(0);
    expect(medidorDois.calls).toBe(1);
  });

  it("a conciliação dos 15 dias: até 2 idas ao D1 e nenhum comando com mais de 100 parâmetros", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId, "Nubank");
    const db = dbComMedidor();
    const cartaoId = await criarCartao(db, itemId);
    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [pagamentoDoCartao(cartaoId, "[TEST] ext-conc", "2026-11-01", 150000)],
      now: NOVEMBRO_UM,
    });

    const registro = { maiorComando: 0 };
    const medidor = newMeter();
    const mudou = await reconcileHousehold(
      createDb(d1Espiado(registro), medidor),
      householdId,
      "2026-11-06",
      AGORA,
    );
    expect(mudou).toBe(1);
    expect(medidor.calls).toBeLessThanOrEqual(2);
    expect(registro.maiorComando).toBeLessThanOrEqual(100);
  });
});

describe("classificação: só se escreve onde a vizinhança está inteira", () => {
  it("uma linha que só entra na leitura (a mais de 5 dias do lote) não muda, mesmo sem o par na leitura", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId, "Nubank");
    const db = dbComMedidor();
    const contaId = await criarConta(db, itemId);
    const cartaoId = await criarCartao(db, itemId);

    // Saída de 27/10 e cartão de 01/11, mesmo valor: pareados (5 dias).
    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [
        movimento({
          account_id: contaId,
          external_id: "[TEST] ext-guarda-saida",
          movement: "pix_enviado",
          local_date: "2026-10-27",
          amount_cents: -150000,
          original_description: "[TEST] PIX ENVIADO NU",
        }),
        pagamentoDoCartao(cartaoId, "[TEST] ext-guarda-cartao", "2026-11-01", 150000),
      ],
      now: AGORA,
    });
    expect(await estadoDe("[TEST] ext-guarda-cartao")).toMatchObject({ income_kind: "transferencia" });

    // Compra de 08/11: o cartão de 01/11 está a 7 dias do lote, então é só leitura. O par (27/10) fica fora da leitura.
    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [
        movimento({
          account_id: contaId,
          external_id: "[TEST] ext-guarda-nova",
          movement: "debito",
          local_date: "2026-11-08",
          amount_cents: -500,
          original_description: "[TEST] MERCADO",
        }),
      ],
      now: AGORA,
    });
    expect(await estadoDe("[TEST] ext-guarda-cartao")).toMatchObject({
      movement: "pagamento_fatura",
      income_kind: "transferencia",
      categorized_by: "regra",
    });
  });

  it("a conciliação dos últimos 15 dias não mexe em linha mais antiga, mesmo que a leitura a traga", async () => {
    const { householdId, connectionId } = await criarLar();
    const itemId = await criarItem(connectionId, "Nubank");
    const db = dbComMedidor();
    const cartaoId = await criarCartao(db, itemId);
    // Cartão de 22/10: a leitura da conciliação (de 21/10) o traz, mas a janela de escrita (15 dias) não.
    await ingestTransactions(db, {
      householdId,
      bankItemId: itemId,
      rows: [pagamentoDoCartao(cartaoId, "[TEST] ext-antigo", "2026-10-22", 150000)],
      now: "2026-10-22T12:00:00.000Z",
    });

    const mudou = await reconcileHousehold(db, householdId, "2026-11-10", AGORA);

    expect(mudou).toBe(0);
    expect(await estadoDe("[TEST] ext-antigo")).toMatchObject({
      movement: "pagamento_fatura",
      income_kind: null,
    });
  });
});

// Linha de cartão: pagamento de fatura do cartão (valor positivo no lar, como o mapeamento grava).
function pagamentoDoCartao(
  cartaoId: string,
  externalId: string,
  localDate: string,
  centavos: number,
): MappedTransaction {
  return movimento({
    card_id: cartaoId,
    external_id: externalId,
    movement: "pagamento_fatura",
    local_date: localDate,
    occurred_at: `${localDate}T14:00:00.000Z`,
    amount_cents: centavos,
    original_description: "[TEST] PAGAMENTO RECEBIDO",
    provider_operation_type: "PAGAMENTO_FATURA",
  });
}
