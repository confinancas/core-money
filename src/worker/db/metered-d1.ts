// Embrulha o binding do D1 e conta o uso de cada consulta (ADR-008).
// calls: idas ao D1 (all, run, first, raw, exec, dump e batch; um batch conta 1).
// statements: comandos executados (um batch de 3 conta 3).
// rowsRead / rowsWritten / sizeBytes: o `meta` que o D1 devolve em all(), run() e batch() (e em first(), que passa por all()).
// estimatedRows: as linhas que raw() devolveu. O D1 não manda `meta` em raw(), então cada linha devolvida conta como lida
// (uma estimativa por baixo, marcada na API). O Drizzle lê por raw() em todo select (TASK-0109).
// unmeteredStatements: exec e dump, que não devolvem linhas nem `meta` (entram em calls e statements).

export type Meter = {
  calls: number;
  statements: number;
  rowsRead: number;
  rowsWritten: number;
  sizeBytes: number;
  estimatedRows: number;
  unmeteredStatements: number;
};

export const newMeter = (): Meter => ({
  calls: 0,
  statements: 0,
  rowsRead: 0,
  rowsWritten: 0,
  sizeBytes: 0,
  estimatedRows: 0,
  unmeteredStatements: 0,
});

export function meteredD1(db: D1Database, meter: Meter): D1Database {
  // Liga o objeto embrulhado à consulta de verdade, para o batch receber as consultas originais.
  const inner = new WeakMap<object, D1PreparedStatement>();

  const ida = () => {
    meter.calls++;
  };

  const medido = (meta: Partial<D1Meta> | undefined) => {
    meter.statements++;
    meter.rowsRead += meta?.rows_read ?? 0;
    meter.rowsWritten += meta?.rows_written ?? 0;
    if (meta?.size_after) meter.sizeBytes = meta.size_after;
  };

  const semMedida = () => {
    meter.statements++;
    meter.unmeteredStatements++;
  };

  const wrap = (stmt: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = {
      bind: (...values: unknown[]) => wrap(stmt.bind(...values)),
      async all() {
        ida();
        const r = await stmt.all();
        medido(r.meta);
        return r;
      },
      async run() {
        ida();
        const r = await stmt.run();
        medido(r.meta);
        return r;
      },
      async first(column?: string) {
        ida();
        const r = await stmt.all<Record<string, unknown>>();
        medido(r.meta);
        const row = r.results[0] ?? null;
        return column && row ? row[column] : row;
      },
      async raw(options?: { columnNames?: boolean }) {
        ida();
        meter.statements++;
        const linhas = options?.columnNames ? await stmt.raw({ columnNames: true }) : await stmt.raw();
        // Com columnNames, a primeira linha é o cabeçalho: não é linha lida.
        const quantas = options?.columnNames ? Math.max(linhas.length - 1, 0) : linhas.length;
        meter.rowsRead += quantas;
        meter.estimatedRows += quantas;
        return linhas;
      },
    };
    inner.set(wrapped, stmt);
    return wrapped as unknown as D1PreparedStatement;
  };

  return {
    prepare: (sql: string) => wrap(db.prepare(sql)),
    async batch(statements: D1PreparedStatement[]) {
      ida();
      const results = await db.batch(statements.map((s) => inner.get(s) ?? s));
      for (const r of results) medido(r.meta);
      return results;
    },
    async exec(sql: string) {
      ida();
      semMedida();
      return db.exec(sql);
    },
    // Não é medido; nada do núcleo usa withSession().
    withSession: (constraint?: string) => db.withSession(constraint),
    async dump() {
      ida();
      semMedida();
      return db.dump();
    },
  } as unknown as D1Database;
}
