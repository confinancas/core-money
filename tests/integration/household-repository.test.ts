import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { HOUSEHOLD_DEFAULTS } from "../../src/shared/household";
import { createDb } from "../../src/worker/db/client";
import { newMeter } from "../../src/worker/db/metered-d1";
import {
  addMember,
  createHousehold,
  getHousehold,
  HouseholdExistsError,
  HouseholdNotFoundError,
  InvalidInputError,
  MemberRoleTakenError,
} from "../../src/worker/household/repository";
import { limparBanco } from "./helpers/app";

const db = createDb(env.DB, newMeter());

const contar = async (tabela: "households" | "members"): Promise<number> => {
  const linha = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${tabela}`).first<{ total: number }>();
  return linha?.total ?? 0;
};

beforeEach(async () => {
  await limparBanco(env.DB);
});

describe("repositório do lar", () => {
  it("cria o lar com os padrões do manual e um titular", async () => {
    const { householdId, memberId } = await createHousehold(db, {
      brand: "matrimoney",
      titular: { name: "[TEST] Pessoa A" },
    });

    const lar = await getHousehold(db, householdId);

    expect(lar?.household).toMatchObject({
      id: householdId,
      brand: "matrimoney",
      cycleStartDay: 11,
      percentages: {
        fixos: 35,
        conforto: 10,
        educacao: 5,
        extras: 5,
        metas: 10,
        prazeres: 10,
        investimentos: 25,
      },
      paidPlan: false,
    });
    expect(lar?.members).toEqual([
      expect.objectContaining({ id: memberId, name: "[TEST] Pessoa A", role: "titular", email: null }),
    ]);
  });

  it("um INSERT mínimo nasce com as colunas de configuração iguais a HOUSEHOLD_DEFAULTS", async () => {
    await env.DB.prepare("INSERT INTO households (id, brand, created_at) VALUES (?, ?, ?)")
      .bind("[TEST] lar-minimo", "matrimoney", "2026-11-06T12:00:00.000Z")
      .run();

    const linha = await env.DB.prepare(
      "SELECT cycle_start_day, pct_fixed, pct_comfort, pct_education, pct_extras, pct_goals, pct_pleasures, paid_plan FROM households WHERE id = ?",
    )
      .bind("[TEST] lar-minimo")
      .first<Record<string, number>>();

    const { fixos, conforto, educacao, extras, metas, prazeres } = HOUSEHOLD_DEFAULTS.percentages;
    expect(linha).toEqual({
      cycle_start_day: HOUSEHOLD_DEFAULTS.cycleStartDay,
      pct_fixed: fixos,
      pct_comfort: conforto,
      pct_education: educacao,
      pct_extras: extras,
      pct_goals: metas,
      pct_pleasures: prazeres,
      paid_plan: 0,
    });
  });

  it("recusa um segundo lar na instalação e não grava membro novo", async () => {
    await createHousehold(db, { brand: "matrimoney", titular: { name: "[TEST] Pessoa A" } });

    await expect(
      createHousehold(db, { brand: "matrimoney", titular: { name: "[TEST] Pessoa C" } }),
    ).rejects.toBeInstanceOf(HouseholdExistsError);

    expect(await contar("households")).toBe(1);
    expect(await contar("members")).toBe(1);
  });

  it("adiciona o cônjuge e o lar passa a ter duas pessoas", async () => {
    const { householdId } = await createHousehold(db, {
      brand: "matrimoney",
      titular: { name: "[TEST] Pessoa A" },
    });

    await addMember(db, householdId, { name: "[TEST] Pessoa B", role: "conjuge" });

    const lar = await getHousehold(db, householdId);
    expect(lar?.members.map((m) => m.role)).toEqual(["titular", "conjuge"]);
  });

  it("recusa a terceira pessoa com MemberRoleTakenError e continua com duas", async () => {
    const { householdId } = await createHousehold(db, {
      brand: "matrimoney",
      titular: { name: "[TEST] Pessoa A" },
    });
    await addMember(db, householdId, { name: "[TEST] Pessoa B", role: "conjuge" });

    await expect(
      addMember(db, householdId, { name: "[TEST] Pessoa C", role: "conjuge" }),
    ).rejects.toBeInstanceOf(MemberRoleTakenError);

    expect(await contar("members")).toBe(2);
  });

  it("a barreira do banco recusa um INSERT com soma de percentuais acima de 100", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO households (id, brand, created_at, pct_fixed) VALUES (?, 'matrimoney', ?, 61)",
      )
        .bind("[TEST] lar-soma-101", "2026-11-06T12:00:00.000Z")
        .run(),
    ).rejects.toThrow();

    expect(await contar("households")).toBe(0);
  });

  it("a barreira do banco recusa papel fora da lista e um terceiro membro", async () => {
    const { householdId } = await createHousehold(db, {
      brand: "matrimoney",
      titular: { name: "[TEST] Pessoa A" },
    });
    await addMember(db, householdId, { name: "[TEST] Pessoa B", role: "conjuge" });

    await expect(
      env.DB.prepare(
        "INSERT INTO members (id, household_id, name, role, created_at) VALUES (?, ?, ?, 'outro', ?)",
      )
        .bind("[TEST] membro-outro", householdId, "[TEST] Pessoa D", "2026-11-06T12:00:00.000Z")
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "INSERT INTO members (id, household_id, name, role, created_at) VALUES (?, ?, ?, 'conjuge', ?)",
      )
        .bind("[TEST] membro-extra", householdId, "[TEST] Pessoa E", "2026-11-06T12:00:00.000Z")
        .run(),
    ).rejects.toThrow();
  });

  it("recusa nome vazio, só com espaços ou com 41 caracteres, sem gravar nada", async () => {
    for (const nome of ["", "   ", "a".repeat(41)]) {
      await expect(
        createHousehold(db, { brand: "matrimoney", titular: { name: nome } }),
      ).rejects.toBeInstanceOf(InvalidInputError);
    }

    expect(await contar("households")).toBe(0);
    expect(await contar("members")).toBe(0);
  });

  it("grava o nome sem os espaços das pontas", async () => {
    const { householdId } = await createHousehold(db, {
      brand: "matrimoney",
      titular: { name: "  [TEST] Pessoa A  " },
    });

    const lar = await getHousehold(db, householdId);
    expect(lar?.members[0]?.name).toBe("[TEST] Pessoa A");
  });

  it("adicionar pessoa a um lar inexistente lança HouseholdNotFoundError", async () => {
    await expect(
      addMember(db, "[TEST] lar-que-nao-existe", { name: "[TEST] Pessoa B", role: "conjuge" }),
    ).rejects.toBeInstanceOf(HouseholdNotFoundError);

    expect(await contar("members")).toBe(0);
  });
});
