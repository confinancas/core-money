import {
  type Ciclo,
  ciclosQueFaltam,
  cycleForDate,
  exigeDiaDeInicio,
  isYmd,
  planejarReconstrucao,
} from "../../shared/cycle";
import type { Db } from "../db/client";
import { assignCycleKeysStmts, type EscopoDeCiclo, faixaDeDatasStmts } from "./assign";

// Calendário do lar (TASK-0801): a tabela cycles, uma linha por ciclo. Tudo filtrado pelo lar.

type LinhaDoCiclo = { key: string; starts_on: string; ends_on: string };

const SQL_CICLOS = "SELECT key, starts_on, ends_on FROM cycles WHERE household_id = ? ORDER BY starts_on";
const SQL_DIA_DO_LAR = "SELECT cycle_start_day FROM households WHERE id = ?";

export const ciclosDoBanco = (linhas: readonly unknown[]): Ciclo[] =>
  (linhas as LinhaDoCiclo[]).map((linha) => ({
    key: linha.key,
    startsOn: linha.starts_on,
    endsOn: linha.ends_on,
  }));

// Duas leituras (calendário e dia de início do lar) que podem entrar em qualquer db.batch do lar.
export function leituraCalendarioStmts(db: Db, householdId: string): D1PreparedStatement[] {
  return [
    db.$client.prepare(SQL_CICLOS).bind(householdId),
    db.$client.prepare(SQL_DIA_DO_LAR).bind(householdId),
  ];
}

// Interpreta o resultado das duas leituras de leituraCalendarioStmts (na ordem dela).
export function calendarioDaLeitura(
  calendario: D1Result<unknown> | undefined,
  lar: D1Result<unknown> | undefined,
): { ciclos: Ciclo[]; diaDoLar: number | null } {
  const linha = lar?.results[0] as { cycle_start_day: number } | undefined;
  return { ciclos: ciclosDoBanco(calendario?.results ?? []), diaDoLar: linha?.cycle_start_day ?? null };
}

export function insertCyclesStmts(
  db: Db,
  householdId: string,
  ciclos: readonly Ciclo[],
  ignorarExistentes: boolean,
): D1PreparedStatement[] {
  const verbo = ignorarExistentes ? "INSERT OR IGNORE" : "INSERT";
  return ciclos.map((ciclo) =>
    db.$client
      .prepare(`${verbo} INTO cycles (household_id, key, starts_on, ends_on) VALUES (?, ?, ?, ?)`)
      .bind(householdId, ciclo.key, ciclo.startsOn, ciclo.endsOn),
  );
}

// Calendário e dia de início do lar, numa ida só.
async function lerCalendarioEDia(
  db: Db,
  householdId: string,
): Promise<{ ciclos: Ciclo[]; diaDoLar: number | null }> {
  const [calendario, lar] = await db.$client.batch(leituraCalendarioStmts(db, householdId));
  return calendarioDaLeitura(calendario, lar);
}

export async function loadCalendar(db: Db, householdId: string): Promise<Ciclo[]> {
  const resultado = await db.$client.prepare(SQL_CICLOS).bind(householdId).all();
  return ciclosDoBanco(resultado.results);
}

export async function getCycleForDate(db: Db, householdId: string, data: string): Promise<Ciclo | null> {
  return cycleForDate(data, await loadCalendar(db, householdId));
}

// Cria (INSERT OR IGNORE) os ciclos que faltam para cobrir [de, ate]. Idempotente. Uma ida se o calendário cobre;
// duas se cria.
export async function ensureCalendar(db: Db, householdId: string, de: string, ate: string): Promise<void> {
  const { ciclos, diaDoLar } = await lerCalendarioEDia(db, householdId);
  if (diaDoLar === null) throw new Error("lar inexistente ao garantir o calendário");
  const faltam = ciclosQueFaltam(ciclos, diaDoLar, de, ate);
  if (faltam.length > 0) await db.$client.batch(insertCyclesStmts(db, householdId, faltam, true));
}

// Muda o dia de início: o ciclo que contém hoje fica como estava; os futuros são apagados e refeitos com o dia novo;
// as transações e faturas são reatribuídas (só o que muda é escrito). Tudo num db.batch(). Sem calendário, só o dia.
export async function rebuildFutureCalendar(
  db: Db,
  householdId: string,
  novoDia: number,
  hoje: string,
): Promise<void> {
  exigeDiaDeInicio(novoDia);
  if (!isYmd(hoje)) throw new RangeError("hoje precisa ser AAAA-MM-DD");
  const { ciclos, diaDoLar } = await lerCalendarioEDia(db, householdId);
  if (diaDoLar === null || diaDoLar === novoDia) return;

  const comandos: D1PreparedStatement[] = [];
  if (ciclos.length > 0) {
    const plano = planejarReconstrucao(ciclos, diaDoLar, novoDia, hoje);
    // Apaga antes de gravar: um ciclo novo pode ter a chave de um apagado (os meses se repetem), e isso só cabe depois.
    comandos.push(
      db.$client
        .prepare("DELETE FROM cycles WHERE household_id = ? AND starts_on > ?")
        .bind(householdId, plano.fimDoAtual),
    );
    comandos.push(...insertCyclesStmts(db, householdId, plano.acrescentar, true));
    comandos.push(...insertCyclesStmts(db, householdId, plano.novosFuturos, false));
    // Lançamentos que apontavam para um ciclo apagado são reatribuídos no mesmo batch.
    if (plano.mudaCalendario) comandos.push(...assignCycleKeysStmts(db, householdId, { all: true }));
  }
  comandos.push(
    db.$client.prepare("UPDATE households SET cycle_start_day = ? WHERE id = ?").bind(novoDia, householdId),
  );
  await db.$client.batch(comandos);
}

// Passo 2 do afterIngest: garante o calendário que cobre as datas decididas pelos lançamentos e pelas faturas dos
// ids, e atribui o ciclo deles. Uma ida ao D1 se o calendário já cobre (leitura e escrita no mesmo batch); duas se
// precisa criar ciclos. Os UPDATE do primeiro batch são idempotentes e não apagam chaves existentes.
export async function assignCycleKeys(db: Db, householdId: string, ids: readonly string[]): Promise<void> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return;
  await assignCycleKeysDoEscopo(db, householdId, { ids: unicos });
}

// O mesmo passo para um escopo qualquer (ids, cartões ou o lar). Quem chama com cardIds é a reavaliação do cartão
// inteiro (after-ingest.ts), que roda uma vez por execução depois das faturas.
export async function assignCycleKeysDoEscopo(
  db: Db,
  householdId: string,
  escopo: EscopoDeCiclo,
): Promise<void> {
  const [calendario, lar, faixa] = await db.$client.batch([
    ...leituraCalendarioStmts(db, householdId),
    faixaDeDatasStmts(db, householdId, escopo),
    ...assignCycleKeysStmts(db, householdId, escopo),
  ]);
  const { minimo, maximo } = (faixa?.results[0] ?? {}) as { minimo?: unknown; maximo?: unknown };
  const { ciclos, diaDoLar } = calendarioDaLeitura(calendario, lar);
  if (typeof minimo !== "string" || typeof maximo !== "string" || diaDoLar === null) return;

  const faltam = ciclosQueFaltam(ciclos, diaDoLar, minimo, maximo);
  if (faltam.length === 0) return;
  await db.$client.batch([
    ...insertCyclesStmts(db, householdId, faltam, true),
    ...assignCycleKeysStmts(db, householdId, escopo),
  ]);
}
