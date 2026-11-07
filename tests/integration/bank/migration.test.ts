import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const TABELAS = [
  "accounts",
  "bank_items",
  "bills",
  "cards",
  "pluggy_connections",
  "sync_runs",
  "transactions",
];

const INDICES = [
  "accounts_bank_item_idx",
  "bills_card_closes_idx",
  "pluggy_connections_household_label_uq",
  "sync_runs_bank_item_started_idx",
  "transactions_account_local_date_idx",
  "transactions_bank_item_external_uq",
  "transactions_bill_idx",
  "transactions_card_bill_idx",
  "transactions_card_local_date_idx",
  "transactions_household_cycle_idx",
  "transactions_household_category_cycle_idx",
  "transactions_household_categorized_idx",
  "transactions_household_establishment_idx",
  "transactions_household_fixed_bill_cycle_idx",
  "transactions_household_local_date_idx",
];

describe("migração 0001_bank", () => {
  it("cria as sete tabelas do EPIC-02", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?, ?, ?, ?, ?) ORDER BY name",
    )
      .bind(...TABELAS)
      .all<{ name: string }>();

    expect(results.map((tabela) => tabela.name)).toEqual([...TABELAS].sort());
  });

  it("cria todos os índices pelo nome", async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (${INDICES.map(() => "?").join(", ")})`,
    )
      .bind(...INDICES)
      .all<{ name: string }>();

    expect(results.map((indice) => indice.name).sort()).toEqual([...INDICES].sort());
  });

  it("transactions tem removed_at e last_seen_at", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(transactions)").all<{ name: string }>();
    const colunas = results.map((coluna) => coluna.name);

    expect(colunas).toContain("removed_at");
    expect(colunas).toContain("last_seen_at");
  });

  it("bank_items nasce 'ativo' quando ninguém informa o status", async () => {
    const conexao = crypto.randomUUID();
    const lar = crypto.randomUUID();
    const item = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO households (id, brand, created_at) VALUES (?, 'matrimoney', ?)").bind(
        lar,
        "2026-11-10T12:00:00.000Z",
      ),
      env.DB.prepare(
        "INSERT INTO pluggy_connections (id, household_id, label, created_at) VALUES (?, ?, '[TEST] Conexão', ?)",
      ).bind(conexao, lar, "2026-11-10T12:00:00.000Z"),
    ]);

    await env.DB.prepare(
      "INSERT INTO bank_items (id, connection_id, institution_name, created_at) VALUES (?, ?, '[TEST] Banco', ?)",
    )
      .bind(item, conexao, "2026-11-10T12:00:00.000Z")
      .run();

    const linha = await env.DB.prepare("SELECT status FROM bank_items WHERE id = ?")
      .bind(item)
      .first<{ status: string }>();
    expect(linha?.status).toBe("ativo");
  });

  it("o índice único recusa a mesma external_id no mesmo item", async () => {
    const lar = crypto.randomUUID();
    const conexao = crypto.randomUUID();
    const item = crypto.randomUUID();
    const conta = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO households (id, brand, created_at) VALUES (?, 'matrimoney', ?)").bind(
        lar,
        "2026-11-10T12:00:00.000Z",
      ),
      env.DB.prepare(
        "INSERT INTO pluggy_connections (id, household_id, label, created_at) VALUES (?, ?, '[TEST] Conexão', ?)",
      ).bind(conexao, lar, "2026-11-10T12:00:00.000Z"),
      env.DB.prepare(
        "INSERT INTO bank_items (id, connection_id, institution_name, created_at) VALUES (?, ?, '[TEST] Banco', ?)",
      ).bind(item, conexao, "2026-11-10T12:00:00.000Z"),
      env.DB.prepare(
        "INSERT INTO accounts (id, bank_item_id, kind, name, balance_cents, balance_at) VALUES (?, ?, 'corrente', '[TEST] Conta', 0, ?)",
      ).bind(conta, item, "2026-11-10T12:00:00.000Z"),
    ]);

    const inserir = (id: string) =>
      env.DB.prepare(
        `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, movement,
          occurred_at, local_date, amount_cents, original_description, last_seen_at)
         VALUES (?, ?, '[TEST] ext-unica', ?, ?, 'outro', '2026-11-10T12:00:00.000Z', '2026-11-10', -100,
          '[TEST] Movimento', '2026-11-10T12:00:00.000Z')`,
      ).bind(id, lar, item, conta);

    await inserir(crypto.randomUUID()).run();
    await expect(inserir(crypto.randomUUID()).run()).rejects.toThrow(/UNIQUE constraint failed/);
  });
});
