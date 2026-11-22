import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { Hono } from "hono";
import { createApp } from "../../../src/worker/app";
import { ensureCalendar } from "../../../src/worker/cycle/calendar";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import type { AppEnv } from "../../../src/worker/env";
import { AGORA, inserirTransacao, type Lar } from "./regras";

// Auxiliares dos testes do Pix recebido (TASK-0903). Dados [TEST]. O ciclo 2026-10 (início 11/10) é o de AGORA.

// biome-ignore lint/suspicious/noExplicitAny: corpo de resposta de teste, conferido pelas asserções
export type Corpo = Record<string, any>;

export async function chamar(
  app: Hono<AppEnv>,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; corpo: Corpo }> {
  const ctx = createExecutionContext();
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const resposta = await app.fetch(new Request(`http://matrimoney.test${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  const texto = await resposta.text();
  return { status: resposta.status, corpo: texto ? (JSON.parse(texto) as Corpo) : {} };
}

export const appDoLar = (
  lar: { householdId: string; memberId: string },
  agora: string = AGORA,
): Hono<AppEnv> => createApp({ resolveSession: async () => lar, agora: () => new Date(agora) });

export const dbDeTeste = () => createDb(env.DB, newMeter());

export async function prepararCiclos(lar: Lar): Promise<void> {
  await ensureCalendar(dbDeTeste(), lar.householdId, "2026-09-01", "2026-11-30");
}

export async function criarRenda(
  lar: Lar,
  nome: string,
  valor = 1_000_000,
  extras: { arrival?: "auto" | "manual"; texto?: string | null; arquivada?: boolean } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO fixed_incomes (id, household_id, name, currency, amount_cents, usual_day, arrival, statement_text,
       kept_usd_is_investment, archived_at) VALUES (?, ?, ?, 'BRL', ?, 5, ?, ?, 0, ?)`,
  )
    .bind(
      id,
      lar.householdId,
      nome,
      valor,
      extras.arrival ?? "manual",
      extras.texto ?? null,
      extras.arquivada ? AGORA : null,
    )
    .run();
  return id;
}

// Pix recebido de uma contraparte no ciclo 2026-10 (a contraparte e o documento formam a chave do remetente).
export async function criarPix(
  lar: Lar,
  valor: number,
  contraparte: string | null = "[TEST] Fulana",
  extras: { movement?: string; dia?: string; backfill?: boolean; descricao?: string } = {},
): Promise<string> {
  const id = await inserirTransacao(lar, {
    movement: extras.movement ?? "pix_recebido",
    amountCents: valor,
    descricao: extras.descricao ?? `[TEST] Pix de ${contraparte ?? "sem nome"}`,
    localDate: extras.dia ?? "2026-10-20",
    contraparte,
    doc: contraparte === null ? null : "***.123.456-**",
  });
  await env.DB.prepare("UPDATE transactions SET cycle_key = '2026-10', is_backfill = ? WHERE id = ?")
    .bind(extras.backfill ? 1 : 0, id)
    .run();
  return id;
}

export const sugerir = (
  id: string,
  sugestao: { kind: string; subtipo?: string; rendaId?: string; certeza?: string },
) =>
  env.DB.prepare(
    `UPDATE transactions SET ai_income_kind = ?, ai_income_subtype = ?, ai_fixed_income_id = ?, ai_confidence = ?,
       ai_reason = 'sugestão [TEST]' WHERE id = ?`,
  )
    .bind(sugestao.kind, sugestao.subtipo ?? null, sugestao.rendaId ?? null, sugestao.certeza ?? "media", id)
    .run();

export const linhaDa = (id: string) =>
  env.DB.prepare(
    `SELECT income_kind, income_subtype, fixed_income_id, hidden, hidden_reason, categorized_by, categorized_at, rule_id
     FROM transactions WHERE id = ?`,
  )
    .bind(id)
    .first<{
      income_kind: string | null;
      income_subtype: string | null;
      fixed_income_id: string | null;
      hidden: number;
      hidden_reason: string | null;
      categorized_by: string | null;
      categorized_at: string | null;
      rule_id: string | null;
    }>();

export const recebimentosDa = async (id: string) =>
  (
    await env.DB.prepare(
      "SELECT fixed_income_id, confirmed_by FROM fixed_income_receipts WHERE transaction_id = ?",
    )
      .bind(id)
      .all<{ fixed_income_id: string; confirmed_by: string }>()
  ).results;

export async function criarRegraDeRemetente(
  lar: Lar,
  chave: string,
  valores: { kind: string; subtipo?: string | null; rendaId?: string | null; origem?: string },
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO rules (id, household_id, scope, match_value, set_custom_name, set_category_id, set_spend_type,
       set_income_kind, set_income_subtype, set_fixed_income_id, set_movement, created_from, created_by, created_at, disabled_at)
     VALUES (?, ?, 'remetente', ?, NULL, NULL, NULL, ?, ?, ?, NULL, ?, ?, ?, NULL)`,
  )
    .bind(
      id,
      lar.householdId,
      chave,
      valores.kind,
      valores.subtipo ?? null,
      valores.rendaId ?? null,
      valores.origem ?? "manual",
      lar.memberId,
      AGORA,
    )
    .run();
  return id;
}

export const CHAVE_FULANA = "[TEST] FULANA|***.123.456-**";
