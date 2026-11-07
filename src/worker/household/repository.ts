import { eq, sql } from "drizzle-orm";
import {
  type BrandId,
  type HouseholdDto,
  type HouseholdPatch,
  investmentsPct,
  type MemberRole,
  memberNameSchema,
  type PlannedPercentages,
} from "../../shared/household";
import type { Db } from "../db/client";
import { households, members } from "../db/schema";

export class HouseholdExistsError extends Error {
  constructor() {
    super("Esta instalação já tem um lar.");
    this.name = "HouseholdExistsError";
  }
}

export class MemberRoleTakenError extends Error {
  constructor() {
    super("O lar já tem uma pessoa com esse papel.");
    this.name = "MemberRoleTakenError";
  }
}

export class HouseholdNotFoundError extends Error {
  constructor() {
    super("Lar não encontrado.");
    this.name = "HouseholdNotFoundError";
  }
}

export class InvalidInputError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "InvalidInputError";
  }
}

export type MemberRow = {
  id: string;
  name: string;
  email: string | null;
  role: MemberRole;
  createdAt: string;
};

type HouseholdRow = typeof households.$inferSelect;

const paraLar = (row: HouseholdRow): HouseholdDto => {
  const percentuais: PlannedPercentages = {
    fixos: row.pctFixed,
    conforto: row.pctComfort,
    educacao: row.pctEducation,
    extras: row.pctExtras,
    metas: row.pctGoals,
    prazeres: row.pctPleasures,
  };
  return {
    id: row.id,
    brand: row.brand as BrandId,
    cycleStartDay: row.cycleStartDay,
    percentages: { ...percentuais, investimentos: investmentsPct(percentuais) },
    paidPlan: row.paidPlan,
    createdAt: row.createdAt,
  };
};

// O CHECK do banco garante que o papel é titular ou conjuge.
const paraMembros = (linhas: (Omit<MemberRow, "role"> & { role: string })[]): MemberRow[] =>
  linhas.map((linha) => ({ ...linha, role: linha.role as MemberRole }));

const nomeValido = (nome: unknown): string => {
  const resultado = memberNameSchema.safeParse(nome);
  if (!resultado.success) throw new InvalidInputError(resultado.error.issues[0]?.message ?? "Nome inválido.");
  return resultado.data;
};

// Mensagem do erro e da causa (o Drizzle pode embrulhar o erro do D1).
const textoDoErro = (erro: unknown): string => {
  if (!(erro instanceof Error)) return String(erro);
  const causa = erro.cause instanceof Error ? erro.cause.message : "";
  return `${erro.message} ${causa}`;
};

// As duas leituras do lar, para entrar num batch.
const leituraDoLar = (db: Db, householdId: string) =>
  db.select().from(households).where(eq(households.id, householdId)).limit(1);

const leituraDosMembros = (db: Db, householdId: string) =>
  db
    .select({
      id: members.id,
      name: members.name,
      email: members.email,
      role: members.role,
      createdAt: members.createdAt,
    })
    .from(members)
    .where(eq(members.householdId, householdId))
    .orderBy(sql`CASE ${members.role} WHEN 'titular' THEN 0 ELSE 1 END`);

export async function createHousehold(
  db: Db,
  entrada: { brand: BrandId; titular: { name: string; email?: string | null } },
  agora: Date = new Date(),
): Promise<{ householdId: string; memberId: string }> {
  const nome = nomeValido(entrada.titular.name);
  const householdId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const criadoEm = agora.toISOString();
  const email = entrada.titular.email ?? null;

  // Um batch (uma transação) no binding medido: o segundo INSERT só grava se o primeiro gravou.
  // (O batch do Drizzle não aceita db.run() no D1; por isso o SQL vai direto ao binding.)
  const d1 = db.$client;
  const [lar] = await d1.batch([
    d1
      .prepare(
        "INSERT INTO households (id, brand, created_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM households)",
      )
      .bind(householdId, entrada.brand, criadoEm),
    d1
      .prepare(
        "INSERT INTO members (id, household_id, name, email, role, created_at) SELECT ?, ?, ?, ?, 'titular', ? WHERE EXISTS (SELECT 1 FROM households WHERE id = ?)",
      )
      .bind(memberId, householdId, nome, email, criadoEm, householdId),
  ]);
  if (lar.meta.changes !== 1) throw new HouseholdExistsError();

  return { householdId, memberId };
}

export async function addMember(
  db: Db,
  householdId: string,
  entrada: { name: string; email?: string | null; role: "conjuge" },
  agora: Date = new Date(),
): Promise<{ memberId: string }> {
  const nome = nomeValido(entrada.name);
  const memberId = crypto.randomUUID();
  try {
    await db.insert(members).values({
      id: memberId,
      householdId,
      name: nome,
      email: entrada.email ?? null,
      role: entrada.role,
      createdAt: agora.toISOString(),
    });
  } catch (erro) {
    const texto = textoDoErro(erro);
    if (texto.includes("UNIQUE constraint failed")) throw new MemberRoleTakenError();
    if (texto.includes("FOREIGN KEY constraint failed")) throw new HouseholdNotFoundError();
    throw erro;
  }
  return { memberId };
}

export async function getHousehold(
  db: Db,
  householdId: string,
): Promise<{ household: HouseholdDto; members: MemberRow[] } | null> {
  const [lares, pessoas] = await db.batch([
    leituraDoLar(db, householdId),
    leituraDosMembros(db, householdId),
  ]);
  const lar = lares[0];
  if (!lar) return null;
  return { household: paraLar(lar), members: paraMembros(pessoas) };
}

export async function updateHousehold(
  db: Db,
  householdId: string,
  patch: HouseholdPatch,
): Promise<{ household: HouseholdDto; members: MemberRow[] } | null> {
  const valores: Partial<typeof households.$inferInsert> = {};
  if (patch.cycleStartDay !== undefined) valores.cycleStartDay = patch.cycleStartDay;
  if (patch.percentages !== undefined) {
    valores.pctFixed = patch.percentages.fixos;
    valores.pctComfort = patch.percentages.conforto;
    valores.pctEducation = patch.percentages.educacao;
    valores.pctExtras = patch.percentages.extras;
    valores.pctGoals = patch.percentages.metas;
    valores.pctPleasures = patch.percentages.prazeres;
  }
  if (Object.keys(valores).length === 0) throw new InvalidInputError("Nada para salvar.");

  const [, lares, pessoas] = await db.batch([
    db.update(households).set(valores).where(eq(households.id, householdId)),
    leituraDoLar(db, householdId),
    leituraDosMembros(db, householdId),
  ]);
  const lar = lares[0];
  if (!lar) return null;
  return { household: paraLar(lar), members: paraMembros(pessoas) };
}
