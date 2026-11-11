import { env } from "cloudflare:test";
import { AuthenticationError } from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import migracao from "../../migrations/0012_categorization.sql?raw";
import type { ClienteDaIA } from "../../src/worker/categorization/claude";
import { loadCategorizationContext } from "../../src/worker/categorization/context-repo";
import { runCategorizationSlice } from "../../src/worker/categorization/cron";
import { processNewTransactions } from "../../src/worker/categorization/pipeline";
import { createDb } from "../../src/worker/db/client";
import { type Meter, newMeter } from "../../src/worker/db/metered-d1";
import type { Env } from "../../src/worker/env";
import { saveSecret } from "../../src/worker/security/secrets";
import { AGORA, categoriaDoLar, contar, criarLar, inserirTransacao, type Lar } from "./helpers/regras";

// Rodada 1 da TASK-0303 (avaliação da Fable): custo da marca do histórico, pausa, reconferência, lote, ordem, guardas do
// histórico e a migração. A IA é falsa; nenhum teste chama a Anthropic.

const ambiente = env as unknown as Env;
const CHAVE = "sk-ant-api03-TEST-chave-falsa";

type Chamada = { ref: string; descricao: string; data: string };
type Decisao = {
  categoria?: string | null;
  entrada?: string | null;
  renda?: string | null;
  subtipo?: string | null;
};

function clienteFalso(opcoes: {
  decidir?: (chamada: Chamada) => Decisao | "omitir";
  erro?: () => unknown;
  antes?: () => Promise<void>;
  recusa?: boolean;
}): { cliente: ClienteDaIA; chamadas: Chamada[][] } {
  const chamadas: Chamada[][] = [];
  const cliente: ClienteDaIA = {
    messages: {
      create: async (params) => {
        const conteudo = (params.messages as Array<{ content: string }>)[0]?.content ?? "{}";
        const { transacoes } = JSON.parse(conteudo) as { transacoes: Array<Chamada> };
        const itens = transacoes.map((t) => ({ ref: t.ref, descricao: t.descricao, data: t.data }));
        chamadas.push(itens);
        if (opcoes.antes) await opcoes.antes();
        if (opcoes.erro) throw opcoes.erro();
        if (opcoes.recusa) return { stop_reason: "refusal", content: [{ type: "text", text: "{}" }] };
        const sugestoes = itens.flatMap((item) => {
          const decidir: (chamada: Chamada) => Decisao | "omitir" =
            opcoes.decidir ?? (() => ({ categoria: null }));
          const decisao = decidir(item);
          if (decisao === "omitir") return [];
          return [
            {
              ref: item.ref,
              categoria: decisao.categoria ?? null,
              entrada: decisao.entrada ?? null,
              renda: decisao.renda ?? null,
              subtipo: decisao.subtipo ?? null,
              certeza: "alta",
              motivo: "teste",
            },
          ];
        });
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify({ sugestoes }) }],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };
      },
    },
  };
  return { cliente, chamadas };
}

const executar = (cliente: ClienteDaIA, agora: string = AGORA, meter?: Meter) =>
  runCategorizationSlice(ambiente, { now: () => new Date(agora), createClient: () => cliente, meter });

// Código da categoria do slug (c1, c2...), pelo mesmo contexto que o cron lê.
async function codigoDe(lar: Lar): Promise<(slug: string) => string> {
  const ctx = await loadCategorizationContext(createDb(env.DB, newMeter()), lar.householdId);
  const porId = new Map([...ctx.codigos.categorias].map(([codigo, id]) => [id, codigo]));
  return (slug) => porId.get(categoriaDoLar(lar, slug)) ?? "c-inexistente";
}

async function comChave(): Promise<void> {
  await saveSecret(createDb(env.DB, newMeter()), ambiente, "claude_api_key", CHAVE);
}

async function ciclosDoLar(lar: Lar): Promise<void> {
  const lista = [
    ["2026-08", "2026-08-11", "2026-09-10"],
    ["2026-09", "2026-09-11", "2026-10-10"],
    ["2026-10", "2026-10-11", "2026-11-10"],
  ];
  await env.DB.batch(
    lista.map(([key, starts, ends]) =>
      env.DB.prepare("INSERT INTO cycles (household_id, key, starts_on, ends_on) VALUES (?, ?, ?, ?)").bind(
        lar.householdId,
        key,
        starts,
        ends,
      ),
    ),
  );
}

async function compra(
  lar: Lar,
  descricao: string,
  extra: { localDate?: string; cicloKey?: string; categoryId?: string | null } = {},
): Promise<string> {
  const id = await inserirTransacao(lar, {
    na: "cartao",
    movement: "compra",
    amountCents: -8900,
    descricao: `[TEST] ${descricao}`,
    localDate: extra.localDate,
    categoryId: extra.categoryId ?? null,
  });
  await env.DB.prepare("UPDATE transactions SET cycle_key = ? WHERE id = ?")
    .bind(extra.cicloKey ?? "2026-10", id)
    .run();
  return id;
}

// Preenchimento do lar com um prefixo próprio (o helper compartilhado gera ids fixos e não pode rodar duas vezes).
async function preencher(lar: Lar, quantidade: number, prefixo: string): Promise<void> {
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
     INSERT INTO transactions (id, household_id, external_id, bank_item_id, card_id, movement, occurred_at, local_date,
       amount_cents, original_description, establishment_key, last_seen_at)
     SELECT 'pre-${prefixo}-' || i, ?, 'pre-ext-${prefixo}-' || i, ?, ?, 'compra', '2026-11-05T12:00:00.000Z', '2026-11-05',
       -1000, '[TEST] Preenchimento', 'TEST PREENCHIMENTO', ? FROM n`,
  )
    .bind(quantidade, lar.householdId, lar.bankItemId, lar.cardId, AGORA)
    .run();
}

const importar = (lar: Lar, ids: string[], meter?: Meter) =>
  processNewTransactions(createDb(env.DB, meter ?? newMeter()), lar.householdId, ids, AGORA);

const naFila = (id: string) =>
  contar("SELECT COUNT(*) AS total FROM categorization_queue WHERE transaction_id = ?", id);
const fila = (id: string) =>
  env.DB.prepare("SELECT attempts, last_error FROM categorization_queue WHERE transaction_id = ?")
    .bind(id)
    .first<{ attempts: number; last_error: string | null }>();
const ler = (id: string) =>
  env.DB.prepare(
    "SELECT category_id, ai_category_id, categorized_by, is_backfill FROM transactions WHERE id = ?",
  )
    .bind(id)
    .first<{
      category_id: string | null;
      ai_category_id: string | null;
      categorized_by: string | null;
      is_backfill: number;
    }>();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("F1: a marca do histórico acompanha os ids, não o lar", () => {
  it("100 transações do histórico sem regra leem o mesmo número de linhas num lar de 300 e num de 3.000", async () => {
    // Um lar só (a instalação tem um lar): primeiro com ~300 linhas, depois cresce para ~3.000.
    const lar = await criarLar();
    await ciclosDoLar(lar);
    const historico = async (rotulo: string): Promise<string[]> => {
      const ids: string[] = [];
      for (let i = 0; i < 100; i++)
        ids.push(await compra(lar, `HISTORICO ${rotulo} ${i}`, { cicloKey: "2026-08" }));
      return ids;
    };
    await preencher(lar, 200, "A");
    const idsPequeno = await historico("A");
    const pequeno = newMeter();
    await importar(lar, idsPequeno, pequeno);
    await preencher(lar, 2800, "B");
    const idsGrande = await historico("B");
    const grande = newMeter();
    await importar(lar, idsGrande, grande);
    expect(pequeno.rowsRead).toBeLessThanOrEqual(12 * 100);
    expect(grande.rowsRead).toBeLessThanOrEqual(12 * 100);
    expect(Math.abs(grande.rowsRead - pequeno.rowsRead)).toBeLessThanOrEqual(pequeno.rowsRead * 0.05);
    const marcadas = await contar(
      `SELECT COUNT(*) AS total FROM transactions WHERE id IN (${idsGrande.map(() => "?").join(",")}) AND is_backfill = 1`,
      ...idsGrande,
    );
    expect(marcadas).toBe(100);
  });
});

describe("pausa depois de erro do provedor", () => {
  it("chave recusada (401): a pausa segura a execução seguinte, com até 2 leituras e sem chamada", async () => {
    const lar = await criarLar();
    await comChave();
    const id = await compra(lar, "CHAVE RECUSADA");
    await importar(lar, [id]);
    const primeira = clienteFalso({
      erro: () => new AuthenticationError(401, undefined, "chave", new Headers()),
    });
    expect((await executar(primeira.cliente)).situacao).toBe("parada");
    const segunda = clienteFalso({});
    const meter = newMeter();
    const r = await executar(segunda.cliente, "2026-11-10T12:05:00.000Z", meter);
    expect(r.situacao).toBe("pausada");
    expect(segunda.chamadas).toHaveLength(0);
    expect(meter.calls).toBeLessThanOrEqual(2);
    expect(await fila(id)).toEqual({ attempts: 0, last_error: "chave" });
  });
});

describe("reconferência: o que deixou de pedir sugestão sai da fila sem ir à IA", () => {
  it("movimento trocado depois da importação (pagamento de fatura): não vai à IA e sai da fila", async () => {
    const lar = await criarLar();
    await comChave();
    const trocada = await compra(lar, "TROCADA DEPOIS");
    const normal = await compra(lar, "NORMAL");
    await importar(lar, [trocada, normal]);
    await env.DB.prepare("UPDATE transactions SET movement = 'pagamento_fatura' WHERE id = ?")
      .bind(trocada)
      .run();
    const falso = clienteFalso({ decidir: () => ({ categoria: null }) });
    await executar(falso.cliente);
    const enviados = falso.chamadas.flat().map((c) => c.descricao);
    expect(enviados).not.toContain("[TEST] TROCADA DEPOIS");
    expect(enviados).toContain("[TEST] NORMAL");
    expect(await naFila(trocada)).toBe(0);
  });
});

describe("lote e ordem", () => {
  it("recusa com 25 itens: cada um vai sozinho na execução seguinte (cenário 6)", async () => {
    const lar = await criarLar();
    await comChave();
    const ids: string[] = [];
    for (let i = 0; i < 25; i++)
      ids.push(await compra(lar, `RECUSA ${i}`, { localDate: `2026-10-${String(1 + i).padStart(2, "0")}` }));
    await importar(lar, ids);
    await executar(clienteFalso({ recusa: true }).cliente);
    const porTentativa = await contar(
      "SELECT COUNT(*) AS total FROM categorization_queue WHERE attempts = 1",
    );
    expect(porTentativa).toBe(25);
    const segunda = clienteFalso({ recusa: true });
    await executar(segunda.cliente);
    expect(segunda.chamadas).toHaveLength(1);
    expect(segunda.chamadas[0]).toHaveLength(1);
    expect(await contar("SELECT COUNT(*) AS total FROM categorization_queue WHERE attempts = 2")).toBe(1);
  });

  it("com 120 na fila, os 50 processados são os de data mais recente (cenário 12)", async () => {
    const lar = await criarLar();
    await comChave();
    const ids: string[] = [];
    for (let i = 0; i < 120; i++) {
      const dia = String(1 + (i % 28)).padStart(2, "0");
      ids.push(await compra(lar, `ORDEM ${i}`, { localDate: `2026-10-${dia}` }));
    }
    await importar(lar, ids);
    const falso = clienteFalso({ decidir: () => ({ categoria: null }) });
    await executar(falso.cliente);
    const enviadas = falso.chamadas.flat().map((c) => c.data);
    expect(enviadas).toHaveLength(50);
    const naoEnviadas = await env.DB.prepare(
      "SELECT t.local_date AS data FROM categorization_queue AS q JOIN transactions AS t ON t.id = q.transaction_id",
    ).all<{ data: string }>();
    const maiorNaoEnviada = Math.max(...(naoEnviadas.results ?? []).map((l) => Date.parse(l.data)));
    const menorEnviada = Math.min(...enviadas.map((d) => Date.parse(d)));
    expect(menorEnviada).toBeGreaterThanOrEqual(maiorNaoEnviada);
  });
});

describe("guardas de applyAiSuggestionStmt no histórico", () => {
  it("categoria arquivada durante a chamada: a sugestão fica em ai_category_id e não entra em category_id (K3)", async () => {
    const lar = await criarLar();
    await ciclosDoLar(lar);
    await comChave();
    const cod = await codigoDe(lar);
    const id = await compra(lar, "HISTORICO ARQUIVADO", { cicloKey: "2026-08" });
    await importar(lar, [id]);
    const falso = clienteFalso({
      decidir: () => ({ categoria: cod("mercado") }),
      antes: async () => {
        await env.DB.prepare("UPDATE categories SET archived_at = ? WHERE id = ?")
          .bind(AGORA, categoriaDoLar(lar, "mercado"))
          .run();
      },
    });
    await executar(falso.cliente);
    const linha = await ler(id);
    expect(linha?.ai_category_id).toBe(categoriaDoLar(lar, "mercado"));
    expect(linha?.category_id).toBeNull();
    expect(linha?.categorized_by).toBeNull();
  });

  it("categoria definida durante a chamada: a sugestão não sobrescreve (K11)", async () => {
    const lar = await criarLar();
    await ciclosDoLar(lar);
    await comChave();
    const cod = await codigoDe(lar);
    const id = await compra(lar, "HISTORICO DEFINIDO", { cicloKey: "2026-08" });
    await importar(lar, [id]);
    const falso = clienteFalso({
      decidir: () => ({ categoria: cod("restaurantes") }),
      antes: async () => {
        await env.DB.prepare(
          "UPDATE transactions SET category_id = ?, categorized_by = 'membro' WHERE id = ?",
        )
          .bind(categoriaDoLar(lar, "mercado"), id)
          .run();
      },
    });
    await executar(falso.cliente);
    const linha = await ler(id);
    expect(linha?.category_id).toBe(categoriaDoLar(lar, "mercado"));
    expect(linha?.categorized_by).toBe("membro");
    expect(linha?.ai_category_id).toBe(categoriaDoLar(lar, "restaurantes"));
  });
});

describe("cenário 24: sem chave, uma única leitura e nada escrito", () => {
  it("a fila e as transações ficam iguais, e a fatia faz 1 consulta", async () => {
    const lar = await criarLar();
    const id = await compra(lar, "SEM CHAVE RODADA 1");
    await importar(lar, [id]);
    const antes = await fila(id);
    const falso = clienteFalso({});
    const meter = newMeter();
    const r = await executar(falso.cliente, AGORA, meter);
    expect(r.situacao).toBe("sem_chave");
    expect(falso.chamadas).toHaveLength(0);
    expect(meter.calls).toBe(1);
    expect(meter.rowsWritten).toBe(0);
    expect(await fila(id)).toEqual(antes);
  });
});

describe("migração 0012: a marca do histórico (o UPDATE do arquivo)", () => {
  it("marca só o ciclo mais antigo que o anterior ao de hoje, como o arquivo da migração", async () => {
    const lar = await criarLar();
    const ciclos = [
      ["k-a", "2000-01-01", "2000-01-31"],
      ["k-b", "2000-02-01", "2000-02-28"],
      ["k-c", "2100-01-01", "2100-01-31"],
    ];
    for (const [key, starts, ends] of ciclos) {
      await env.DB.prepare("INSERT INTO cycles (household_id, key, starts_on, ends_on) VALUES (?, ?, ?, ?)")
        .bind(lar.householdId, key, starts, ends)
        .run();
    }
    const antigo = await compra(lar, "CICLO A", { cicloKey: "k-a" });
    const anterior = await compra(lar, "CICLO B", { cicloKey: "k-b" });
    const futuro = await compra(lar, "CICLO C", { cicloKey: "k-c" });
    const semCiclo = await compra(lar, "SEM CICLO");
    await env.DB.prepare("UPDATE transactions SET cycle_key = NULL WHERE id = ?").bind(semCiclo).run();
    const comando = migracao
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .find((s) => s.startsWith("UPDATE `transactions` SET `is_backfill` = 1"));
    expect(comando).toBeDefined();
    await env.DB.prepare(comando as string).run();
    expect((await ler(antigo))?.is_backfill).toBe(1);
    expect((await ler(anterior))?.is_backfill).toBe(0);
    expect((await ler(futuro))?.is_backfill).toBe(0);
    expect((await ler(semCiclo))?.is_backfill).toBe(0);
  });
});
