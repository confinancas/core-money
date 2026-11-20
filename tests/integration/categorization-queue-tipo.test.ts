import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { establishmentKey } from "../../src/shared/establishment-key";
import { createApp } from "../../src/worker/app";
import type { AppEnv } from "../../src/worker/env";
import { aquecerOPortao, semearPronto } from "./helpers/app";
import {
  AGORA,
  categoriaDoLar,
  criarLar,
  criarRegra,
  inserirTransacao,
  type Lar,
  lerTransacao,
} from "./helpers/regras";

// Tipo de gasto e nome na fila (TASK-0304, rodada 1): desfazer não apaga o tipo que veio de uma regra (A9), e os iguais
// que esperavam recebem o nome e o tipo da regra da chave (A10).

beforeEach(async () => {
  await semearPronto(env.DB);
  await aquecerOPortao(createApp({}));
});

type App = Hono<AppEnv>;
type Resposta = { status: number; corpo: Record<string, unknown> };

async function chamar(app: App, metodo: string, caminho: string, corpo?: unknown): Promise<Resposta> {
  const ctx = createExecutionContext();
  const init: RequestInit = { method: metodo };
  if (corpo !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(corpo);
  }
  const resposta = await app.fetch(new Request(`http://matrimoney.test${caminho}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  const texto = await resposta.text();
  return { status: resposta.status, corpo: texto ? (JSON.parse(texto) as Record<string, unknown>) : {} };
}

const appDoLar = (lar: Lar): App =>
  createApp({
    resolveSession: async () => ({ householdId: lar.householdId, memberId: lar.memberId }),
    agora: () => new Date(AGORA),
  });

describe("tipo de gasto e nome na fila", () => {
  it("A9: desfazer não apaga o tipo que veio de uma regra", async () => {
    const lar = await criarLar();
    const chave = establishmentKey("[TEST] ACADEMIA BETA") ?? "";
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: chave,
      setCategoryId: categoriaDoLar(lar, "lazer"),
      setSpendType: "fixos",
    });
    const id = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -9000,
      descricao: "[TEST] ACADEMIA BETA",
      localDate: "2026-11-09",
      aiCategoryId: categoriaDoLar(lar, "servicos"),
    });
    await env.DB.prepare(
      "UPDATE transactions SET spend_type = 'fixos', spend_type_source = 'regra' WHERE id = ?",
    )
      .bind(id)
      .run();
    const app = appDoLar(lar);
    const aceite = await chamar(app, "POST", "/api/categorization/accept", { transactionIds: [id] });
    const categoria = (aceite.corpo.accepted as { categoryId: string }[])[0]?.categoryId ?? "";
    expect(categoria).not.toBe("");
    expect(
      (
        await chamar(app, "POST", "/api/categorization/undo", {
          items: [{ transactionId: id, categoryId: categoria }],
        })
      ).status,
    ).toBe(200);
    const linha = await lerTransacao(id);
    expect(linha.spend_type).toBe("fixos");
    expect(linha.spend_type_source).toBe("regra");
  });

  it("A10: um igual que esperava recebe o nome e o tipo da regra da chave", async () => {
    const lar = await criarLar();
    const chave = establishmentKey("[TEST] ACADEMIA GAMA") ?? "";
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: chave,
      setCustomName: "[TEST] Academia",
      setSpendType: "fixos",
    });
    const antiga = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -9000,
      descricao: "[TEST] ACADEMIA GAMA",
      localDate: "2026-11-01",
    });
    const nova = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -9000,
      descricao: "[TEST] ACADEMIA GAMA",
      localDate: "2026-11-09",
      aiCategoryId: categoriaDoLar(lar, "servicos"),
    });
    const r = await chamar(appDoLar(lar), "POST", "/api/categorization/accept", { transactionIds: [nova] });
    expect((r.corpo.alsoResolved as { transactionId: string }[]).map((x) => x.transactionId)).toEqual([
      antiga,
    ]);
    const linha = await lerTransacao(antiga);
    expect(linha.category_id).toBe(categoriaDoLar(lar, "servicos"));
    expect(linha.custom_name).toBe("[TEST] Academia");
    expect(linha.spend_type).toBe("fixos");
    expect(linha.spend_type_source).toBe("regra");
  });
});

describe("rodada 2: casos que faltavam (B2)", () => {
  it("volta de linha do histórico: o tipo que veio de regra ou de escolha não muda", async () => {
    const lar = await criarLar();
    const porRegra = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -5000,
      descricao: "[TEST] HISTORICO REGRA",
      localDate: "2026-09-02",
      aiCategoryId: categoriaDoLar(lar, "servicos"),
    });
    const escolhido = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -6000,
      descricao: "[TEST] HISTORICO ESCOLHIDO",
      localDate: "2026-09-03",
      aiCategoryId: categoriaDoLar(lar, "servicos"),
    });
    for (const [id, origem] of [
      [porRegra, "regra"],
      [escolhido, "escolhido"],
    ] as const) {
      await env.DB.prepare(
        "UPDATE transactions SET is_backfill = 1, category_id = ?, categorized_at = ?, categorized_by = ?, spend_type = 'fixos', spend_type_source = ? WHERE id = ?",
      )
        .bind(categoriaDoLar(lar, "lazer"), AGORA, lar.memberId, origem, id)
        .run();
    }
    const r = await chamar(appDoLar(lar), "POST", "/api/categorization/undo", {
      items: [
        { transactionId: porRegra, categoryId: categoriaDoLar(lar, "lazer") },
        { transactionId: escolhido, categoryId: categoriaDoLar(lar, "lazer") },
      ],
    });
    expect(r.status).toBe(200);
    const linhaDaRegra = await lerTransacao(porRegra);
    expect(linhaDaRegra.category_id).toBe(categoriaDoLar(lar, "servicos"));
    expect(linhaDaRegra.categorized_by).toBe("ia");
    expect(linhaDaRegra.spend_type).toBe("fixos");
    expect(linhaDaRegra.spend_type_source).toBe("regra");
    const linhaEscolhida = await lerTransacao(escolhido);
    expect(linhaEscolhida.spend_type).toBe("fixos");
    expect(linhaEscolhida.spend_type_source).toBe("escolhido");
  });

  it("iguais: a regra de Metas não entra na compra de cartão", async () => {
    const lar = await criarLar();
    const chave = establishmentKey("[TEST] LOJA METAS") ?? "";
    await criarRegra(lar, { scope: "estabelecimento", matchValue: chave, setSpendType: "metas" });
    const aceita = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -9000,
      descricao: "[TEST] LOJA METAS",
      localDate: "2026-11-09",
      aiCategoryId: categoriaDoLar(lar, "servicos"),
    });
    const cartao = await inserirTransacao(lar, {
      na: "cartao",
      movement: "compra",
      amountCents: -4000,
      descricao: "[TEST] LOJA METAS",
      localDate: "2026-11-01",
    });
    const r = await chamar(appDoLar(lar), "POST", "/api/categorization/accept", { transactionIds: [aceita] });
    expect((r.corpo.alsoResolved as { transactionId: string }[]).map((x) => x.transactionId)).toEqual([
      cartao,
    ]);
    const linha = await lerTransacao(cartao);
    expect(linha.category_id).toBe(categoriaDoLar(lar, "servicos"));
    expect(linha.spend_type).not.toBe("metas");
    expect(linha.spend_type_source).not.toBe("regra");
  });

  it("iguais: o nome próprio fica quando a regra também tem nome", async () => {
    const lar = await criarLar();
    const chave = establishmentKey("[TEST] LOJA NOME") ?? "";
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: chave,
      setCustomName: "[TEST] Nome da regra",
    });
    const aceita = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -9000,
      descricao: "[TEST] LOJA NOME",
      localDate: "2026-11-09",
      aiCategoryId: categoriaDoLar(lar, "servicos"),
    });
    const igual = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -9000,
      descricao: "[TEST] LOJA NOME",
      localDate: "2026-11-01",
    });
    await env.DB.prepare("UPDATE transactions SET custom_name = ? WHERE id = ?")
      .bind("[TEST] Nome próprio", igual)
      .run();
    const r = await chamar(appDoLar(lar), "POST", "/api/categorization/accept", { transactionIds: [aceita] });
    expect((r.corpo.alsoResolved as { transactionId: string }[]).map((x) => x.transactionId)).toEqual([
      igual,
    ]);
    expect((await lerTransacao(igual)).custom_name).toBe("[TEST] Nome próprio");
  });
});
