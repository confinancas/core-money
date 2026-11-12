import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { establishmentKey } from "../../src/shared/establishment-key";
import { createApp } from "../../src/worker/app";
import type { Meter } from "../../src/worker/db/metered-d1";
import type { AppEnv } from "../../src/worker/env";
import { aquecerOPortao, semearPronto } from "./helpers/app";
import { AGORA, categoriaDoLar, criarLar, inserirTransacao, type Lar } from "./helpers/regras";

// Leituras da fila (TASK-0304, A8): com um lar de 3.000 compras já categorizadas e uma pendente, a página, a contagem,
// o aceite e o desfazer leem perto do que devolvem (índice do pendente e da chave), e não o lar inteiro.

beforeEach(async () => {
  await semearPronto(env.DB);
  await aquecerOPortao(createApp({}));
});

type App = Hono<AppEnv>;

async function chamar(app: App, metodo: string, caminho: string, corpo?: unknown): Promise<number> {
  const ctx = createExecutionContext();
  const init: RequestInit = { method: metodo };
  if (corpo !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(corpo);
  }
  const resposta = await app.fetch(new Request(`http://matrimoney.test${caminho}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  await resposta.text();
  return resposta.status;
}

const appDoLar = (lar: Lar, medidos: Meter[]): App =>
  createApp({
    resolveSession: async () => ({ householdId: lar.householdId, memberId: lar.memberId }),
    agora: () => new Date(AGORA),
    onMeter: (meter) => medidos.push({ ...meter }),
  });

describe("leituras da fila com um lar grande (A8)", () => {
  it("GET, aceite e desfazer leem perto do que devolvem, com 3.000 compras categorizadas", async () => {
    const lar = await criarLar();
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 3000)
       INSERT INTO transactions (id, household_id, external_id, bank_item_id, card_id, movement, occurred_at, local_date,
         amount_cents, original_description, establishment_key, last_seen_at, category_id, categorized_at, categorized_by)
       SELECT 'grande-' || i, ?, 'grande-ext-' || i, ?, ?, 'compra', '2026-10-05T12:00:00.000Z', '2026-10-05', -1000,
         '[TEST] GRANDE ' || i, 'TEST GRANDE ' || i, ?, ?, ?, 'pessoa' FROM n`,
    )
      .bind(lar.householdId, lar.bankItemId, lar.cardId, AGORA, categoriaDoLar(lar, "lazer"), AGORA)
      .run();
    const pendenteId = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -2500,
      descricao: "[TEST] A8 PENDENTE",
      localDate: "2026-11-09",
      aiCategoryId: categoriaDoLar(lar, "servicos"),
    });
    const chave = establishmentKey("[TEST] A8 PENDENTE") ?? "";
    expect(chave).not.toBe("");

    const medidos: Meter[] = [];
    const app = appDoLar(lar, medidos);
    expect(await chamar(app, "GET", "/api/categorization/queue")).toBe(200);
    expect(await chamar(app, "POST", "/api/categorization/accept", { transactionIds: [pendenteId] })).toBe(200);
    expect(
      await chamar(app, "POST", "/api/categorization/undo", {
        items: [{ transactionId: pendenteId, categoryId: categoriaDoLar(lar, "servicos") }],
      }),
    ).toBe(200);

    // Um lar de 3.000 linhas: cada rota lê só as linhas que a consulta toca (dezenas, não milhares).
    for (const medido of medidos) expect(medido.rowsRead).toBeLessThan(100);
  });
});
