import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { addDays, cycleLabel, todayInSaoPaulo } from "../../shared/cycle";
import { investmentsPct, limitPct, type PlannedPercentages, type SpendType } from "../../shared/spend-types";
import { normalizeStatementText } from "../../shared/statement-text";
import { ensureCategorySeed } from "../categories/seed";
import type { Db } from "../db/client";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";
import { applyAutomaticKindStmtFor, revertAutomaticRuleStmts, type TipoDeRegraAutomatica } from "./derive";

// Tipos de gasto (TASK-0802): a tela TiposGasto e a seção de Configurações leem GET /api/spend-types; as regras
// automáticas (corretora e caixinha) são criadas e apagadas aqui. Sessão obrigatória; tudo do lar da sessão.

const TAMANHO_MINIMO = 3;
const TAMANHO_MAXIMO = 60;
const MENSAGEM_TEXTO = "Use de 3 a 60 letras do extrato.";
const JANELA_DE_DESTINOS_DIAS = -90;
const DESTINOS_RECENTES = 8;

const corpoDaRegraAutomatica = z.strictObject({
  kind: z.enum(["corretora", "caixinha"]),
  matchValue: z.string(),
});

const SQL_LAR = `SELECT pct_fixed, pct_comfort, pct_education, pct_extras, pct_goals, pct_pleasures FROM households WHERE id = ?`;
const SQL_CATEGORIAS = `SELECT c.id AS id, c.name AS name, c.parent_id AS parent_id, p.name AS parent_name,
    c.default_spend_type AS own_type, p.default_spend_type AS parent_type, c.sort AS sort
  FROM categories AS c LEFT JOIN categories AS p ON p.id = c.parent_id AND p.household_id = c.household_id
  WHERE c.household_id = ? AND c.archived_at IS NULL
  ORDER BY c.sort, c.name COLLATE NOCASE`;
const SQL_CICLO_ATUAL = `SELECT key, prev_income_cents, spend_limit_cents, pct_fixed, pct_comfort, pct_education, pct_extras,
    pct_pleasures
  FROM cycles WHERE household_id = ? AND starts_on <= ? AND ends_on >= ?`;
const SQL_CICLO_ANTERIOR = `SELECT key FROM cycles WHERE household_id = ?
    AND ends_on < (SELECT starts_on FROM cycles WHERE household_id = ? AND starts_on <= ? AND ends_on >= ?)
  ORDER BY ends_on DESC LIMIT 1`;
const SQL_REGRAS_AUTOMATICAS = `SELECT id, kind, match_value FROM automatic_rules WHERE household_id = ?
  ORDER BY created_at, id`;
const SQL_DESTINOS = `SELECT MAX(TRIM(counterparty_name)) AS name, MAX(counterparty_bank) AS bank
  FROM transactions WHERE household_id = ? AND movement IN ('pix_enviado', 'ted_enviada') AND removed_at IS NULL
    AND counterparty_name IS NOT NULL AND TRIM(counterparty_name) <> '' AND local_date >= ?
  GROUP BY UPPER(TRIM(counterparty_name)) ORDER BY MAX(local_date) DESC LIMIT ?`;

type LinhaDaCategoria = {
  id: string;
  name: string;
  parent_id: string | null;
  parent_name: string | null;
  own_type: string | null;
  parent_type: string | null;
  sort: number;
};
type LinhaDoCiclo = {
  key: string;
  prev_income_cents: number | null;
  spend_limit_cents: number | null;
  pct_fixed: number | null;
  pct_comfort: number | null;
  pct_education: number | null;
  pct_extras: number | null;
  pct_pleasures: number | null;
};

const primeira = <T>(resultado: D1Result<unknown> | undefined): T | undefined =>
  (resultado?.results ?? [])[0] as T | undefined;

// Uma ida ao D1: lar, categorias, ciclo atual e anterior, regras automáticas e destinos recentes.
async function lerTudo(db: Db, householdId: string, hoje: string, desde: string) {
  return db.$client.batch([
    db.$client.prepare(SQL_LAR).bind(householdId),
    db.$client.prepare(SQL_CATEGORIAS).bind(householdId),
    db.$client.prepare(SQL_CICLO_ATUAL).bind(householdId, hoje, hoje),
    db.$client.prepare(SQL_CICLO_ANTERIOR).bind(householdId, householdId, hoje, hoje),
    db.$client.prepare(SQL_REGRAS_AUTOMATICAS).bind(householdId),
    db.$client.prepare(SQL_DESTINOS).bind(householdId, desde, DESTINOS_RECENTES),
  ]);
}

export function tiposDeGastoRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  rotas.get("/", async (c) => {
    const { householdId } = getSession(c);
    const db = c.var.db;
    const hoje = todayInSaoPaulo(agora());
    const desde = addDays(hoje, JANELA_DE_DESTINOS_DIAS);

    let leitura = await lerTudo(db, householdId, hoje, desde);
    // Lar sem categorias: a semente entra uma vez (como na lista de categorias) e lê de novo.
    if ((leitura[1]?.results ?? []).length === 0) {
      await ensureCategorySeed(db, householdId);
      leitura = await lerTudo(db, householdId, hoje, desde);
    }

    const lar = primeira<Record<string, number>>(leitura[0]);
    const percentuais: PlannedPercentages = {
      fixos: lar?.pct_fixed ?? 0,
      conforto: lar?.pct_comfort ?? 0,
      educacao: lar?.pct_education ?? 0,
      extras: lar?.pct_extras ?? 0,
      metas: lar?.pct_goals ?? 0,
      prazeres: lar?.pct_pleasures ?? 0,
    };

    const atual = primeira<LinhaDoCiclo>(leitura[2]);
    const anterior = primeira<{ key: string }>(leitura[3]);
    const base =
      atual && atual.prev_income_cents !== null && anterior
        ? {
            cycleKey: anterior.key,
            label: cycleLabel(anterior.key).toLowerCase(),
            prevIncomeCents: atual.prev_income_cents,
          }
        : null;
    const limiteDoCiclo =
      atual && atual.spend_limit_cents !== null
        ? {
            cycleKey: atual.key,
            spendLimitCents: atual.spend_limit_cents,
            pct: [
              atual.pct_fixed,
              atual.pct_comfort,
              atual.pct_education,
              atual.pct_extras,
              atual.pct_pleasures,
            ]
              .map((valor) => valor ?? 0)
              .reduce((total, valor) => total + valor, 0),
          }
        : null;

    // Principal e, logo abaixo, as subcategorias dela (na ordem da lista de categorias).
    const linhas = (leitura[1]?.results ?? []) as LinhaDaCategoria[];
    const principais = linhas.filter((linha) => linha.parent_id === null);
    const ordenadas = [
      ...principais.flatMap((principal) => [
        principal,
        ...linhas.filter((linha) => linha.parent_id === principal.id),
      ]),
      ...linhas.filter(
        (linha) => linha.parent_id !== null && !principais.some((p) => p.id === linha.parent_id),
      ),
    ];
    const categorias = ordenadas.map((linha) => {
      const origin = linha.own_type !== null ? "categoria" : linha.parent_type !== null ? "mae" : "padrao";
      return {
        id: linha.id,
        name: linha.name,
        parentId: linha.parent_id,
        parentName: linha.parent_name,
        defaultSpendType: linha.own_type,
        effectiveSpendType: (linha.own_type ?? linha.parent_type ?? "prazeres") as SpendType,
        origin,
      };
    });
    const automaticas = (leitura[4]?.results ?? []) as { id: string; kind: string; match_value: string }[];
    const destinos = (leitura[5]?.results ?? []) as { name: string; bank: string | null }[];

    return c.json(
      {
        percentages: { ...percentuais },
        investmentsPct: investmentsPct(percentuais),
        limitPct: limitPct(percentuais),
        base,
        currentLimit: limiteDoCiclo,
        categories: categorias,
        automaticRules: automaticas.map((regra) => ({
          id: regra.id,
          kind: regra.kind,
          matchValue: regra.match_value,
        })),
        recentDestinations: destinos.map((destino) => ({ name: destino.name, bank: destino.bank })),
      },
      200,
    );
  });

  return rotas;
}

// Regras automáticas: POST cria (e aplica ao histórico do lar); DELETE desfaz (volta as linhas à categoria/padrão).
export function regrasAutomaticasRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  rotas.post("/", async (c) => {
    const { householdId, memberId } = getSession(c);
    const corpo = await lerCorpo(c, corpoDaRegraAutomatica);
    if (!corpo) return apiError(c, 400, "dados_invalidos", "Dados inválidos.");
    const texto = normalizeStatementText(corpo.matchValue);
    if (texto.length < TAMANHO_MINIMO || texto.length > TAMANHO_MAXIMO) {
      return apiError(c, 400, "validacao", MENSAGEM_TEXTO, { fields: { matchValue: MENSAGEM_TEXTO } });
    }
    const db = c.var.db;
    const id = crypto.randomUUID();
    const resultados = await db.$client.batch([
      db.$client
        .prepare(
          "INSERT INTO automatic_rules (id, household_id, kind, match_value, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(id, householdId, corpo.kind, texto, memberId, agora().toISOString()),
      applyAutomaticKindStmtFor(db, householdId, corpo.kind, "all"),
    ]);
    return c.json(
      {
        rule: { id, kind: corpo.kind, matchValue: texto },
        applied: resultados[1]?.meta?.changes ?? 0,
      },
      201,
    );
  });

  rotas.delete("/:id", async (c) => {
    const { householdId } = getSession(c);
    const db = c.var.db;
    const regra = await db.$client
      .prepare("SELECT id, kind, match_value FROM automatic_rules WHERE id = ? AND household_id = ?")
      .bind(c.req.param("id"), householdId)
      .first<{ id: string; kind: string; match_value: string }>();
    if (!regra) return apiError(c, 404, "nao_encontrada");

    const resultados = await db.$client.batch(
      revertAutomaticRuleStmts(db, householdId, {
        id: regra.id,
        kind: regra.kind as TipoDeRegraAutomatica,
        matchValue: regra.match_value,
      }),
    );
    // Reversão menos reaplicação: as linhas que outra regra do mesmo tipo ainda cobre não saem da regra.
    const reversao = resultados[0]?.meta?.changes ?? 0;
    const reaplicacao = resultados[2]?.meta?.changes ?? 0;
    return c.json({ reverted: Math.max(0, reversao - reaplicacao) }, 200);
  });

  return rotas;
}

async function lerCorpo<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T | undefined> {
  let corpo: unknown;
  try {
    corpo = await c.req.json();
  } catch {
    return undefined;
  }
  const lido = schema.safeParse(corpo);
  return lido.success ? lido.data : undefined;
}
