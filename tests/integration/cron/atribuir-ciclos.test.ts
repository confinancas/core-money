import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { atribuirCiclos, SQL_SEM_CICLO } from "../../../src/worker/cron/tarefas";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import type { Env } from "../../../src/worker/env";
import { semearLar } from "../helpers/sessao";

// atribuir-ciclos (TASK-0204, R1): a consulta usa o índice parcial dos lançamentos sem ciclo. Com o lar parado (tudo com
// ciclo), a tarefa lê perto de zero linhas, e não a tabela inteira. Medido pelo rowsRead do D1 (meta.rows_read).
const AMBIENTE = env as unknown as Env;
const AGORA = new Date("2026-11-10T12:00:00.000Z");
const AGORA_ISO = AGORA.toISOString();

type Lar = { householdId: string; bankItemId: string; accountId: string };

// Lar, conexão, banco e conta [TEST]. Sem lançamentos ainda.
async function semeiaLar(): Promise<Lar> {
  const lar = await semearLar(env.DB, {
    memberId: crypto.randomUUID(),
    passkeyId: `cred-TEST-0205-${crypto.randomUUID()}`,
    email: `${crypto.randomUUID()}@example.com`,
  });
  const connectionId = crypto.randomUUID();
  const bankItemId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO pluggy_connections (id, household_id, label, cpf_masked, client_id_enc, iv, client_secret_enc,
         client_secret_iv, created_at) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)`,
    ).bind(connectionId, lar.householdId, `[TEST] Conexão ${connectionId.slice(0, 6)}`, AGORA_ISO),
    env.DB.prepare(
      `INSERT INTO bank_items (id, connection_id, institution_name, institution_color, consent_expires_at, last_sync_at,
         status, disconnected_at, created_at) VALUES (?, ?, '[TEST] Banco', NULL, NULL, NULL, 'ativo', NULL, ?)`,
    ).bind(bankItemId, connectionId, AGORA_ISO),
    env.DB.prepare(
      "INSERT INTO accounts (id, bank_item_id, kind, name, balance_cents, overdraft_used_cents, balance_at) VALUES (?, ?, 'corrente', '[TEST] Conta', 0, 0, ?)",
    ).bind(accountId, bankItemId, AGORA_ISO),
  ]);
  return { householdId: lar.householdId, bankItemId, accountId };
}

// Lançamentos em massa (uma instrução): as primeiras `comCiclo` com ciclo, as seguintes sem. Datas espalhadas em 300 dias.
async function semeiaLancamentos(lar: Lar, total: number, comCiclo: number): Promise<void> {
  const prefixo = crypto.randomUUID().slice(0, 8);
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
     INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, movement, occurred_at,
       local_date, amount_cents, original_description, last_seen_at, cycle_key, removed_at)
     SELECT ?2 || '-' || i, ?3, ?2 || '-ext-' || i, ?4, ?5, NULL, 'compra', '2026-10-01T12:00:00.000Z',
       date('2026-10-01', '-' || (i % 300) || ' day'), -1000, '[TEST] compra', '2026-10-01T12:00:00.000Z',
       CASE WHEN i <= ?6 THEN '2026-10' ELSE NULL END, NULL
     FROM n`,
  )
    .bind(total, prefixo, lar.householdId, lar.bankItemId, lar.accountId, comCiclo)
    .run();
}

// Um lançamento explícito (para os testes de comportamento).
async function insereLancamento(
  lar: Lar,
  id: string,
  dataLocal: string,
  cicloDaLinha: string | null,
  removido = false,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, movement, occurred_at,
       local_date, amount_cents, original_description, last_seen_at, cycle_key, removed_at)
     VALUES (?, ?, ?, ?, ?, NULL, 'compra', ?, ?, -1000, '[TEST] compra', ?, ?, ?)`,
  )
    .bind(
      id,
      lar.householdId,
      `ext-${id}`,
      lar.bankItemId,
      lar.accountId,
      `${dataLocal}T12:00:00.000Z`,
      dataLocal,
      AGORA_ISO,
      cicloDaLinha,
      removido ? AGORA_ISO : null,
    )
    .run();
}

// Roda a tarefa com um medidor próprio e devolve o que ela trabalhou e quantas linhas leu.
async function rodaMedido(): Promise<{ trabalhou: boolean; linhasLidas: number }> {
  const medidor = newMeter();
  const trabalhou = await atribuirCiclos.executar(AMBIENTE, AGORA, createDb(env.DB, medidor));
  return { trabalhou: Boolean(trabalhou), linhasLidas: medidor.rowsRead };
}

describe("atribuir-ciclos: leituras com o lar parado", () => {
  it("5.000 lançamentos, todos com ciclo: a tarefa lê perto de zero e não trabalha", async () => {
    const lar = await semeiaLar();
    await semeiaLancamentos(lar, 5000, 5000);

    const medido = await rodaMedido();

    expect(medido.trabalhou).toBe(false);
    // Medido: 1 linha (o índice parcial está vazio). Antes desta task: 5.001 (a tabela inteira).
    expect(medido.linhasLidas).toBeLessThanOrEqual(5);
  });

  it("11.000 lançamentos, todos com ciclo: a tarefa lê perto de zero e não trabalha", async () => {
    const lar = await semeiaLar();
    await semeiaLancamentos(lar, 11000, 11000);

    const medido = await rodaMedido();

    expect(medido.trabalhou).toBe(false);
    // Medido: 1 linha. Antes desta task: 11.001.
    expect(medido.linhasLidas).toBeLessThanOrEqual(5);
  });

  it("5.000 com ciclo e 200 sem: a consulta lê só as 200 sem ciclo, e a tarefa trabalha", async () => {
    const lar = await semeiaLar();
    await semeiaLancamentos(lar, 5200, 5000);
    const medidorDaConsulta = newMeter();
    const consulta = await createDb(env.DB, medidorDaConsulta).$client.prepare(SQL_SEM_CICLO).all();
    expect(consulta.results).toHaveLength(200);
    // Medido: 200 linhas. Antes desta task: 5.400 (a tabela inteira mais as 200 do resultado).
    expect(consulta.meta.rows_read).toBe(200);

    const medido = await rodaMedido();

    expect(medido.trabalhou).toBe(true);
    const restantes = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM transactions WHERE cycle_key IS NULL AND removed_at IS NULL",
    ).first<{ n: number }>();
    expect(restantes?.n).toBe(0);
  });
});

describe("atribuir-ciclos: o que a tarefa faz", () => {
  it("atribui ciclo às linhas sem ciclo, não toca as que já têm, ignora as removidas e só devolve verdadeiro se trabalhou", async () => {
    const lar = await semeiaLar();
    await insereLancamento(lar, "[TEST]-sem-ciclo-1", "2026-10-20", null);
    await insereLancamento(lar, "[TEST]-sem-ciclo-2", "2026-09-05", null);
    await insereLancamento(lar, "[TEST]-com-ciclo", "2026-10-21", "2026-08");
    await insereLancamento(lar, "[TEST]-removido", "2026-10-22", null, true);

    const primeira = await rodaMedido();
    expect(primeira.trabalhou).toBe(true);

    const apos = await env.DB.prepare(
      "SELECT id, cycle_key FROM transactions WHERE household_id = ? ORDER BY id",
    )
      .bind(lar.householdId)
      .all<{ id: string; cycle_key: string | null }>();
    const porId = new Map(apos.results.map((linha) => [linha.id, linha.cycle_key]));
    expect(porId.get("[TEST]-sem-ciclo-1")).not.toBeNull();
    expect(porId.get("[TEST]-sem-ciclo-2")).not.toBeNull();
    // A que já tinha ciclo continua com o dela, mesmo que o calendário dissesse outro.
    expect(porId.get("[TEST]-com-ciclo")).toBe("2026-08");
    // A removida não entra na varredura.
    expect(porId.get("[TEST]-removido")).toBeNull();

    const segunda = await rodaMedido();
    expect(segunda.trabalhou).toBe(false);
  });
});
