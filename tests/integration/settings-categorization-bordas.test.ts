import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/worker/app";
import { createDb } from "../../src/worker/db/client";
import { newMeter } from "../../src/worker/db/metered-d1";
import { saveSecret } from "../../src/worker/security/secrets";
import { aquecerOPortao, callApi, semearPronto } from "./helpers/app";
import { AGORA, criarLar, criarRegra, inserirTransacao, type Lar } from "./helpers/regras";

// Bordas que a avaliação (rodada 1, item 6) pediu: cada uma tem um assert que a mutação correspondente derruba.

beforeEach(async () => {
  await semearPronto(env.DB);
  await aquecerOPortao(createApp({}));
});

const CHAVE = "sk-ant-TESTE-0305-chave-ficticia-nao-usar";
const appDoLar = (lar: { householdId: string; memberId: string }, agora?: () => Date) =>
  createApp({ resolveSession: async () => lar, agora });

const guardarChave = () => saveSecret(createDb(env.DB, newMeter()), env, "claude_api_key", CHAVE);

const filaComErro = async (lar: Lar, erro: string, descricao: string): Promise<string> => {
  const transacao = await inserirTransacao(lar, { movement: "compra", amountCents: -1000, descricao });
  await env.DB.prepare(
    "INSERT INTO categorization_queue (transaction_id, enqueued_at, attempts, last_error) VALUES (?, ?, 1, ?)",
  )
    .bind(transacao, AGORA, erro)
    .run();
  return transacao;
};

type Estado = { keyState: string; chaveNovaRecente: boolean; activeRulesCount: number; categoriesCount: number };
const estado = async (app: ReturnType<typeof createApp>): Promise<Estado> =>
  (await (await callApi(app, "GET", "/api/categorization/status")).json()) as Estado;

describe("teto do documento", () => {
  it("4.000 caracteres exatos são gravados (o teto é 'maior que', não 'maior ou igual')", async () => {
    const lar = await criarLar();
    const r = await callApi(appDoLar(lar), "PUT", "/api/ai-rules-document", {
      text: "a".repeat(4000),
      baseUpdatedAt: null,
    });
    expect(r.status).toBe(200);
  });
});

describe("estado da chave", () => {
  it("chave recusada e Claude fora na fila ao mesmo tempo: problema_chave ganha", async () => {
    const lar = await criarLar();
    await guardarChave();
    await filaComErro(lar, "indisponivel", "[TEST] A");
    await filaComErro(lar, "chave", "[TEST] B");
    expect((await estado(appDoLar(lar))).keyState).toBe("problema_chave");
  });

  it("chave ok e fila sem erro: chaveNovaRecente é falso", async () => {
    const lar = await criarLar();
    await guardarChave();
    const e = await estado(appDoLar(lar));
    expect(e.keyState).toBe("ok");
    expect(e.chaveNovaRecente).toBe(false);
  });

  it("janela de 30 minutos com relógio fixo: 29 min 59 s vale; 30 min não", async () => {
    const lar = await criarLar();
    await guardarChave();
    await filaComErro(lar, "chave", "[TEST] C");
    const salvoEm = Date.parse("2026-11-11T12:00:00.000Z");
    await env.DB.prepare("UPDATE app_secrets SET updated_at = ? WHERE name = 'claude_api_key'")
      .bind(new Date(salvoEm).toISOString())
      .run();
    const dentro = await estado(appDoLar(lar, () => new Date(salvoEm + 29 * 60_000 + 59_000)));
    expect(dentro.chaveNovaRecente).toBe(true);
    const fora = await estado(appDoLar(lar, () => new Date(salvoEm + 30 * 60_000)));
    expect(fora.chaveNovaRecente).toBe(false);
  });

  it("N1: chave ilegível gravada há pouco não diz 'chave nova recebida'", async () => {
    const lar = await criarLar();
    await guardarChave();
    await filaComErro(lar, "chave", "[TEST] D");
    await env.DB.prepare("UPDATE app_secrets SET ciphertext = 'AAAA', iv = 'AAAA' WHERE name = 'claude_api_key'").run();
    const e = await estado(appDoLar(lar));
    expect(e.keyState).toBe("problema_chave");
    expect(e.chaveNovaRecente).toBe(false);
  });
});

describe("contagens", () => {
  it("regra desfeita sai da contagem de regras ativas", async () => {
    const lar = await criarLar();
    const regra = await criarRegra(lar, { scope: "estabelecimento", matchValue: "[TEST] LOJA X", createdFrom: "lembrar" });
    await criarRegra(lar, { scope: "estabelecimento", matchValue: "[TEST] LOJA Y", createdFrom: "lembrar" });
    const app = appDoLar(lar);
    expect((await estado(app)).activeRulesCount).toBe(2);
    expect((await callApi(app, "DELETE", `/api/rules/${regra}`)).status).toBe(204);
    expect((await estado(app)).activeRulesCount).toBe(1);
  });

  it("categoria arquivada sai da contagem de categorias", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const antes = (await estado(app)).categoriesCount;
    const lazer = (await env.DB.prepare("SELECT id FROM categories WHERE household_id = ? AND name = 'Lazer'")
      .bind(lar.householdId)
      .first<{ id: string }>()) as { id: string };
    expect((await callApi(app, "PATCH", `/api/categories/${lazer.id}`, { archived: true })).status).toBe(200);
    expect((await estado(app)).categoriesCount).toBe(antes - 1);
  });
});

describe("lista de regras", () => {
  it("regra de conta_destino não aparece na lista", async () => {
    const lar = await criarLar();
    await criarRegra(lar, { scope: "estabelecimento", matchValue: "[TEST] VISIVEL", createdFrom: "lembrar" });
    await env.DB.prepare(
      `INSERT INTO rules (id, household_id, scope, match_value, created_from, created_by, created_at, disabled_at)
       VALUES (?, ?, 'conta_destino', '[TEST] CONTA DESTINO', 'manual', ?, ?, NULL)`,
    )
      .bind(crypto.randomUUID(), lar.householdId, lar.memberId, AGORA)
      .run();
    const corpo = (await (await callApi(appDoLar(lar), "GET", "/api/rules")).json()) as {
      total: number;
      items: Array<{ matchLabel: string }>;
    };
    expect(corpo.total).toBe(1);
    expect(corpo.items.map((i) => i.matchLabel)).toEqual(["[TEST] VISIVEL"]);
  });

  it("50 regras exatas: uma página, sem nextCursor", async () => {
    const lar = await criarLar();
    for (let i = 0; i < 50; i++) {
      await criarRegra(lar, { scope: "estabelecimento", matchValue: `[TEST] EXATA ${i}`, createdFrom: "lembrar" });
    }
    const corpo = (await (await callApi(appDoLar(lar), "GET", "/api/rules")).json()) as {
      total: number;
      items: unknown[];
      nextCursor: string | null;
    };
    expect(corpo.total).toBe(50);
    expect(corpo.items).toHaveLength(50);
    expect(corpo.nextCursor).toBeNull();
  });
});
