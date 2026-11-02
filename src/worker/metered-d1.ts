// Embrulha o binding do D1 para somar o uso que cada consulta devolve (ADR-008).
// O D1 só devolve `meta` em all(), run() e batch(); first() e raw() passam por all().
// Limite conhecido: raw() via all() junta colunas de mesmo nome (joins) — anotado no spike.

export type Meter = { queries: number; rowsRead: number; rowsWritten: number; sizeBytes: number };

export const newMeter = (): Meter => ({ queries: 0, rowsRead: 0, rowsWritten: 0, sizeBytes: 0 });

export function meteredD1(db: D1Database, meter: Meter): D1Database {
  const inner = new WeakMap<object, D1PreparedStatement>();

  const add = (meta: Partial<D1Meta> | undefined) => {
    meter.queries++;
    if (!meta) return;
    meter.rowsRead += meta.rows_read ?? 0;
    meter.rowsWritten += meta.rows_written ?? 0;
    if (meta.size_after) meter.sizeBytes = meta.size_after;
  };

  const wrap = (stmt: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = {
      bind: (...values: unknown[]) => wrap(stmt.bind(...values)),
      async all() {
        const r = await stmt.all();
        add(r.meta);
        return r;
      },
      async run() {
        const r = await stmt.run();
        add(r.meta);
        return r;
      },
      async first(column?: string) {
        const r = await stmt.all<Record<string, unknown>>();
        add(r.meta);
        const row = r.results[0] ?? null;
        return column && row ? row[column] : row;
      },
      async raw(options?: { columnNames?: boolean }) {
        const r = await stmt.all<Record<string, unknown>>();
        add(r.meta);
        const rows = r.results.map((row) => Object.values(row));
        if (options?.columnNames) return [Object.keys(r.results[0] ?? {}), ...rows];
        return rows;
      },
    };
    inner.set(wrapped, stmt);
    return wrapped as unknown as D1PreparedStatement;
  };

  return {
    prepare: (sql: string) => wrap(db.prepare(sql)),
    async batch(statements: D1PreparedStatement[]) {
      const results = await db.batch(statements.map((s) => inner.get(s) ?? s));
      for (const r of results) add(r.meta);
      return results;
    },
    exec: (sql: string) => db.exec(sql),
    withSession: (constraint?: string) => db.withSession(constraint),
    dump: () => db.dump(),
  } as unknown as D1Database;
}

// Grava o uso do dia numa linha só (uma escrita por requisição).
export async function flushUsage(db: D1Database, meter: Meter) {
  const day = new Date().toISOString().slice(0, 10);
  await db
    .prepare(
      `INSERT INTO usage (day, requests, rows_read, rows_written, size_bytes) VALUES (?1, 1, ?2, ?3, ?4)
       ON CONFLICT(day) DO UPDATE SET
         requests = requests + 1,
         rows_read = rows_read + excluded.rows_read,
         rows_written = rows_written + excluded.rows_written,
         size_bytes = CASE WHEN excluded.size_bytes > 0 THEN excluded.size_bytes ELSE size_bytes END`,
    )
    // +1 linha lida e +1 escrita: o custo da própria gravação do contador
    .bind(day, meter.rowsRead + 1, meter.rowsWritten + 1, meter.sizeBytes)
    .run();
}
