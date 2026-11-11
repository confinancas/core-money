import { applyD1Migrations, env } from "cloudflare:test";
import { afterAll, describe, expect, it } from "vitest";

// Migração 0012 (TASK-0204, R8): acrescenta as colunas da fila e os índices a sync_runs sem recriar a tabela.
// Como o D1 de teste é compartilhado (sem armazenamento isolado), cada teste derruba o esquema e o refaz em duas partes:
// as migrações até a 0011 pelo applyD1Migrations do próprio pacote (o mesmo que o setup usa, e que grava em d1_migrations),
// uma linha de sync_runs no formato anterior, e depois a lista completa, em que só a 0012 é pendente. Assim o SQL roda
// na ordem e pelo mesmo caminho de produção, sem SQL escrito à mão e sem ler disco (o workerd não lê arquivos). No fim, o
// esquema completo volta, para os outros arquivos da suíte.

const MIGRACOES = [...env.TEST_MIGRATIONS].sort((a, b) => a.name.localeCompare(b.name));
const ANTES_DA_0012 = MIGRACOES.filter((migracao) => migracao.name < "0012_");
const MIGRACAO_0012 = MIGRACOES.find((migracao) => migracao.name.startsWith("0012_"));
const NOME_0012 = "0012_sync-queue.sql";

// Derruba todas as tabelas (e o d1_migrations). Tenta de novo o que falhou: um pai com filhos ainda com linhas não cai
// antes do filho. O setup esvazia as tabelas antes de cada teste, então quase nunca há o que tentar de novo.
async function derrubarTudo(): Promise<void> {
  let pendentes = (
    await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
    ).all<{ name: string }>()
  ).results.map((linha) => linha.name);
  while (pendentes.length > 0) {
    const falharam: string[] = [];
    for (const nome of pendentes) {
      try {
        await env.DB.prepare(`DROP TABLE "${nome}"`).run();
      } catch {
        falharam.push(nome);
      }
    }
    if (falharam.length === pendentes.length) throw new Error("derrubar: nenhuma tabela caiu");
    pendentes = falharam;
  }
}

const ids = {
  lar: crypto.randomUUID(),
  conexao: crypto.randomUUID(),
  banco: crypto.randomUUID(),
  execucao: crypto.randomUUID(),
};
const AGORA = "2026-11-10T12:00:00.000Z";

// Esquema até a 0011, com uma execução gravada no formato de antes da 0012 (oito colunas).
async function preparaAteAntesDa0012(): Promise<void> {
  await derrubarTudo();
  await applyD1Migrations(env.DB, ANTES_DA_0012);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO households (id, brand, created_at) VALUES (?, 'matrimoney', ?)").bind(
      ids.lar,
      AGORA,
    ),
    env.DB.prepare(
      `INSERT INTO pluggy_connections (id, household_id, label, cpf_masked, client_id_enc, iv, client_secret_enc,
         client_secret_iv, created_at) VALUES (?, ?, '[TEST] Conexão 0012', NULL, NULL, NULL, NULL, NULL, ?)`,
    ).bind(ids.conexao, ids.lar, AGORA),
    env.DB.prepare(
      `INSERT INTO bank_items (id, connection_id, institution_name, institution_color, consent_expires_at, last_sync_at,
         status, disconnected_at, created_at) VALUES (?, ?, '[TEST] Banco 0012', NULL, NULL, NULL, 'ativo', NULL, ?)`,
    ).bind(ids.banco, ids.conexao, AGORA),
    env.DB.prepare(
      `INSERT INTO sync_runs (id, bank_item_id, kind, started_at, finished_at, status, new_transactions, progress_pct)
       VALUES (?, ?, 'historico', ?, NULL, NULL, 7, 40)`,
    ).bind(ids.execucao, ids.banco, AGORA),
  ]);
}

afterAll(async () => {
  await derrubarTudo();
  await applyD1Migrations(env.DB, MIGRACOES);
});

describe("migração 0012: sync_runs ganha colunas e índices sem recriar a tabela", () => {
  it("a linha que já existia sobrevive, e as colunas novas valem o padrão (retried 0)", async () => {
    await preparaAteAntesDa0012();
    const sqlAntes = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sync_runs'",
    ).first<{
      sql: string;
    }>();
    expect(sqlAntes?.sql).not.toContain("slices_total");

    await applyD1Migrations(env.DB, MIGRACOES);

    const aplicadas = await env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{
      name: string;
    }>();
    expect(aplicadas.results.map((linha) => linha.name)).toContain(NOME_0012);
    const linha = await env.DB.prepare(
      `SELECT id, new_transactions, progress_pct, slices_total, slices_done, retried, error_code, cursor_json, heartbeat_at
       FROM sync_runs WHERE id = ?`,
    )
      .bind(ids.execucao)
      .first();
    expect(linha).toEqual({
      id: ids.execucao,
      new_transactions: 7,
      progress_pct: 40,
      slices_total: 0,
      slices_done: 0,
      retried: 0,
      error_code: null,
      cursor_json: null,
      heartbeat_at: null,
    });
  });

  it("a migração é só de acréscimo: sem DROP TABLE, sem tabela __new e com as seis colunas", () => {
    expect(MIGRACAO_0012).toBeDefined();
    const sql = (MIGRACAO_0012?.queries ?? []).join("\n");
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toContain("__new_sync_runs");
    expect(sql.match(/ALTER TABLE `sync_runs` ADD COLUMN/g)).toHaveLength(6);
  });

  it("depois da migração, o CHECK de retried recusa 2 (inserção e atualização) e aceita 0 e 1", async () => {
    await preparaAteAntesDa0012();
    await applyD1Migrations(env.DB, MIGRACOES);

    await expect(
      env.DB.prepare(
        "INSERT INTO sync_runs (id, bank_item_id, kind, started_at, retried) VALUES (?, ?, 'historico', ?, 2)",
      )
        .bind(crypto.randomUUID(), ids.banco, AGORA)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      env.DB.prepare("UPDATE sync_runs SET retried = 2 WHERE id = ?").bind(ids.execucao).run(),
    ).rejects.toThrow(/CHECK constraint failed/);

    await env.DB.prepare("UPDATE sync_runs SET retried = 1 WHERE id = ?").bind(ids.execucao).run();
    const depois = await env.DB.prepare("SELECT retried FROM sync_runs WHERE id = ?")
      .bind(ids.execucao)
      .first<{ retried: number }>();
    expect(depois?.retried).toBe(1);
  });

  it("cria os quatro índices, e os dois parciais guardam a condição (WHERE) no esquema", async () => {
    await preparaAteAntesDa0012();
    await applyD1Migrations(env.DB, MIGRACOES);

    const { results } = await env.DB.prepare(
      `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name IN
         ('sync_runs_open_idx', 'sync_runs_open_heartbeat_idx', 'bank_items_connection_idx',
          'transactions_no_cycle_local_date_idx')`,
    ).all<{ name: string; sql: string }>();
    const porNome = new Map(results.map((linha) => [linha.name, linha.sql]));
    expect([...porNome.keys()].sort()).toEqual([
      "bank_items_connection_idx",
      "sync_runs_open_heartbeat_idx",
      "sync_runs_open_idx",
      "transactions_no_cycle_local_date_idx",
    ]);
    expect(porNome.get("sync_runs_open_heartbeat_idx")).toMatch(
      /WHERE "?sync_runs"?\."?finished_at"? IS NULL/,
    );
    expect(porNome.get("transactions_no_cycle_local_date_idx")).toMatch(
      /WHERE .*cycle_key" IS NULL AND .*removed_at" IS NULL/,
    );
    expect(porNome.get("sync_runs_open_idx")).not.toMatch(/WHERE/);
  });
});
