import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { meteredD1, newMeter } from "../../src/worker/db/metered-d1";

// Dados fictícios ([TEST]) em duas tabelas com coluna id, para o join com ids repetidos.
beforeEach(async () => {
  await env.DB.exec("CREATE TABLE IF NOT EXISTS t_casais (id INTEGER PRIMARY KEY, nome TEXT NOT NULL)");
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS t_contas (id INTEGER PRIMARY KEY, casal_id INTEGER NOT NULL, nome TEXT NOT NULL)",
  );
});

describe("meteredD1", () => {
  it("raw() de um join devolve os dois ids certos e conta as linhas devolvidas como estimativa", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO t_casais (id, nome) VALUES (1, '[TEST] Casal A')"),
      env.DB.prepare("INSERT INTO t_contas (id, casal_id, nome) VALUES (2, 1, '[TEST] Conta A')"),
    ]);
    const meter = newMeter();
    const db = meteredD1(env.DB, meter);

    const linhas = await db
      .prepare(
        "SELECT t_casais.id, t_contas.id FROM t_casais JOIN t_contas ON t_contas.casal_id = t_casais.id",
      )
      .raw();

    expect(linhas).toEqual([[1, 2]]);
    // Uma linha devolvida por raw(): conta em rowsRead e em estimatedRows (o D1 não manda meta em raw()).
    expect(meter).toMatchObject({
      calls: 1,
      statements: 1,
      rowsRead: 1,
      estimatedRows: 1,
      unmeteredStatements: 0,
    });
  });

  it("raw() com columnNames não conta o cabeçalho como linha", async () => {
    const meter = newMeter();
    const db = meteredD1(env.DB, meter);

    const linhas = await db.prepare("SELECT id FROM t_casais WHERE id = 999").raw({ columnNames: true });

    expect(linhas).toEqual([["id"]]);
    expect(meter).toMatchObject({ calls: 1, statements: 1, rowsRead: 0, estimatedRows: 0 });
  });

  it("exec() não conta linhas: entra em calls, statements e unmeteredStatements", async () => {
    const meter = newMeter();
    const db = meteredD1(env.DB, meter);

    await db.exec("SELECT 1");

    expect(meter).toMatchObject({ calls: 1, statements: 1, unmeteredStatements: 1, rowsRead: 0 });
  });

  it("all() soma as linhas lidas", async () => {
    await env.DB.prepare("INSERT INTO t_casais (id, nome) VALUES (1, '[TEST] Casal A')").run();
    const meter = newMeter();
    const db = meteredD1(env.DB, meter);

    const resposta = await db.prepare("SELECT id FROM t_casais").all();

    expect(resposta.results).toEqual([{ id: 1 }]);
    expect(meter).toMatchObject({ calls: 1, statements: 1 });
    expect(meter.rowsRead).toBeGreaterThan(0);
  });

  it("run() de um insert soma as linhas escritas e o tamanho do banco", async () => {
    const meter = newMeter();
    const db = meteredD1(env.DB, meter);

    await db.prepare("INSERT INTO t_casais (id, nome) VALUES (?, ?)").bind(3, "[TEST] Casal C").run();

    expect(meter.rowsWritten).toBeGreaterThanOrEqual(1);
    expect(meter.sizeBytes).toBeGreaterThan(0);
  });

  it("batch() de 3 comandos conta uma ida e três comandos, e devolve os resultados das consultas", async () => {
    const meter = newMeter();
    const db = meteredD1(env.DB, meter);

    const resultados = await db.batch([
      db.prepare("INSERT INTO t_casais (id, nome) VALUES (?, ?)").bind(4, "[TEST] Casal D"),
      db.prepare("INSERT INTO t_contas (id, casal_id, nome) VALUES (?, ?, ?)").bind(5, 4, "[TEST] Conta D"),
      db.prepare("SELECT COUNT(*) AS total FROM t_contas"),
    ]);

    expect(resultados).toHaveLength(3);
    expect(resultados[2].results).toEqual([{ total: 1 }]);
    expect(meter).toMatchObject({ calls: 1, statements: 3 });
  });
});
