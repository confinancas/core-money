import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/worker/app";
import { ensureCalendar } from "../../src/worker/cycle/calendar";
import { createDb } from "../../src/worker/db/client";
import { newMeter } from "../../src/worker/db/metered-d1";
import type { AppEnv } from "../../src/worker/env";
import { aquecerOPortao, semearPronto } from "./helpers/app";
import { AGORA, contar, criarLar, inserirTransacao, type Lar } from "./helpers/regras";

// Aceite e desfazer de uma entrada de parte do salário (TASK-0903): o aceite grava o recebimento com confirmed_by = a
// pessoa, e o desfazer o tira. Dados [TEST].

beforeEach(async () => {
  await semearPronto(env.DB);
  await aquecerOPortao(createApp({}));
});

// biome-ignore lint/suspicious/noExplicitAny: corpo de resposta de teste, conferido pelas asserções
type Corpo = Record<string, any>;

async function chamar(
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

describe("aceite e desfazer de parte do salário", () => {
  it("o aceite grava o recebimento, e o desfazer tira o recebimento e devolve à fila", async () => {
    const lar: Lar = await criarLar();
    await ensureCalendar(createDb(env.DB, newMeter()), lar.householdId, "2026-09-01", "2026-11-30");
    const renda = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO fixed_incomes (id, household_id, name, currency, amount_cents, usual_day, arrival, statement_text,
         kept_usd_is_investment, archived_at) VALUES (?, ?, '[TEST] Salário aceite', 'BRL', 1000000, 5, 'manual', NULL, 0, NULL)`,
    )
      .bind(renda, lar.householdId)
      .run();
    const pix = await inserirTransacao(lar, {
      movement: "pix_recebido",
      amountCents: 120_000,
      descricao: "[TEST] Pix de Pagadora Salário",
      localDate: "2026-10-20",
      contraparte: "[TEST] Pagadora Salário",
      doc: "***.111.222-**",
    });
    await env.DB.prepare(
      "UPDATE transactions SET cycle_key = '2026-10', ai_income_kind = 'parte_salario', ai_fixed_income_id = ?, ai_confidence = 'alta', ai_reason = 'salário' WHERE id = ?",
    )
      .bind(renda, pix)
      .run();
    const app: Hono<AppEnv> = createApp({ resolveSession: async () => lar, agora: () => new Date(AGORA) });

    const aceite = await chamar(app, "POST", "/api/categorization/accept", { transactionIds: [pix] });
    expect(aceite.corpo.accepted.map((x: { transactionId: string }) => x.transactionId)).toEqual([pix]);
    expect(
      await contar(
        "SELECT COUNT(*) AS total FROM fixed_income_receipts WHERE transaction_id = ? AND confirmed_by = ?",
        pix,
        lar.memberId,
      ),
    ).toBe(1);

    const desfeito = await chamar(app, "POST", "/api/categorization/undo", {
      items: [{ transactionId: pix, categoryId: null }],
    });
    expect(desfeito.corpo.undone).toContain(pix);
    expect(
      await contar("SELECT COUNT(*) AS total FROM fixed_income_receipts WHERE transaction_id = ?", pix),
    ).toBe(0);
    const linha = await env.DB.prepare("SELECT income_kind, categorized_at FROM transactions WHERE id = ?")
      .bind(pix)
      .first<{ income_kind: string | null; categorized_at: string | null }>();
    expect(linha?.income_kind).toBeNull();
    expect(linha?.categorized_at).toBeNull();
  });
});
