import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Lar: um por instalação. Os percentuais são as colunas dos seis tipos de gasto planejados; investimentos é a sobra.
export const households = sqliteTable(
  "households",
  {
    id: text("id").primaryKey(),
    brand: text("brand").notNull(),
    cycleStartDay: integer("cycle_start_day").notNull().default(11),
    pctFixed: integer("pct_fixed").notNull().default(35),
    pctComfort: integer("pct_comfort").notNull().default(10),
    pctEducation: integer("pct_education").notNull().default(5),
    pctExtras: integer("pct_extras").notNull().default(5),
    pctGoals: integer("pct_goals").notNull().default(10),
    pctPleasures: integer("pct_pleasures").notNull().default(10),
    paidPlan: integer("paid_plan", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check("households_brand_ck", sql`${t.brand} IN ('matrimoney', 'meumoney')`),
    check("households_cycle_start_day_ck", sql`${t.cycleStartDay} BETWEEN 1 AND 28`),
    check("households_pct_fixed_ck", sql`${t.pctFixed} BETWEEN 0 AND 100`),
    check("households_pct_comfort_ck", sql`${t.pctComfort} BETWEEN 0 AND 100`),
    check("households_pct_education_ck", sql`${t.pctEducation} BETWEEN 0 AND 100`),
    check("households_pct_extras_ck", sql`${t.pctExtras} BETWEEN 0 AND 100`),
    check("households_pct_goals_ck", sql`${t.pctGoals} BETWEEN 0 AND 100`),
    check("households_pct_pleasures_ck", sql`${t.pctPleasures} BETWEEN 0 AND 100`),
    check(
      "households_pct_sum_ck",
      sql`${t.pctFixed} + ${t.pctComfort} + ${t.pctEducation} + ${t.pctExtras} + ${t.pctGoals} + ${t.pctPleasures} <= 100`,
    ),
  ],
);

// Pessoas do lar: no máximo um titular e um cônjuge por lar (o índice único garante).
export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    name: text("name").notNull(),
    email: text("email"),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check("members_role_ck", sql`${t.role} IN ('titular', 'conjuge')`),
    uniqueIndex("members_household_role_uq").on(t.householdId, t.role),
  ],
);
