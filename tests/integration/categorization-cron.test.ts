import { env } from "cloudflare:test";
import { APIError, AuthenticationError } from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import migracao from "../../migrations/0011_categorization.sql?raw";
import { establishmentKey } from "../../src/shared/establishment-key";
import type { ClienteDaIA } from "../../src/worker/categorization/claude";
import { loadCategorizationContext } from "../../src/worker/categorization/context-repo";
import { runCategorizationSlice } from "../../src/worker/categorization/cron";
import { processNewTransactions } from "../../src/worker/categorization/pipeline";
import { createDb } from "../../src/worker/db/client";
import { newMeter } from "../../src/worker/db/metered-d1";
import type { Env } from "../../src/worker/env";
import { saveSecret } from "../../src/worker/security/secrets";
import {
  AGORA,
  categoriaDoLar,
  contar,
  criarLar,
  criarRegra,
  inserirTransacao,
  type Lar,
} from "./helpers/regras";

// Fatia da categorização (TASK-0303) contra o D1 local. A Anthropic é falsa: nenhum teste chama a API.
// Dados fictícios [TEST]. Os ciclos de teste: 2026-08 (histórico), 2026-09 (anterior a hoje), 2026-10 (atual).

const HOJE_CICLOS = [
  { key: "2026-08", starts: "2026-08-11", ends: "2026-09-10" },
  { key: "2026-09", starts: "2026-09-11", ends: "2026-10-10" },
  { key: "2026-10", starts: "2026-10-11", ends: "2026-11-10" },
];

const CHAVE_FALSA = "sk-ant-api03-TEST-chave-falsa";
const ambiente = env as unknown as Env;

type ItemDoPrompt = { ref: string; descricao: string; entrada: boolean };
type Decisao = {
  categoria?: string | null;
  entrada?: string | null;
  renda?: string | null;
  subtipo?: string | null;
  certeza?: string;
  motivo?: string;
};
type Comportamento = {
  decidir: (item: ItemDoPrompt) => Decisao | "omitir";
  antes?: () => Promise<void>;
  parada?: "refusal" | "max_tokens" | "indisponivel" | "chave";
};

// Cliente falso: lê as transações do prompt e responde pelo que o teste decidiu para cada uma.
function clienteFalso(comportamento: Comportamento): { cliente: ClienteDaIA; chamadas: ItemDoPrompt[][] } {
  const chamadas: ItemDoPrompt[][] = [];
  const cliente: ClienteDaIA = {
    messages: {
      create: async (params) => {
        const conteudo = (params.messages as Array<{ content: string }>)[0]?.content ?? "{}";
        const { transacoes } = JSON.parse(conteudo) as {
          transacoes: Array<{ ref: string; descricao: string; tipo: string }>;
        };
        const itens = transacoes.map((t) => ({
          ref: t.ref,
          descricao: t.descricao,
          entrada: ["Pix recebido", "TED recebida", "outra entrada"].includes(t.tipo),
        }));
        chamadas.push(itens);
        if (comportamento.antes) await comportamento.antes();
        if (comportamento.parada === "indisponivel")
          throw new APIError(529, undefined, "sobrecarga", new Headers());
        if (comportamento.parada === "chave")
          throw new AuthenticationError(401, undefined, "chave", new Headers());
        if (comportamento.parada === "refusal" || comportamento.parada === "max_tokens") {
          return { stop_reason: comportamento.parada, content: [{ type: "text", text: "{}" }] };
        }
        const sugestoes = itens.flatMap((item) => {
          const decisao = comportamento.decidir(item);
          if (decisao === "omitir") return [];
          return [
            {
              ref: item.ref,
              categoria: decisao.categoria ?? null,
              entrada: decisao.entrada ?? null,
              renda: decisao.renda ?? null,
              subtipo: decisao.subtipo ?? null,
              certeza: decisao.certeza ?? "alta",
              motivo: decisao.motivo ?? "teste",
            },
          ];
        });
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify({ sugestoes }) }],
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };
      },
    },
  };
  return { cliente, chamadas };
}

const tudoIgual = (): Decisao => ({ categoria: null });

// Códigos do lar (c1..., r1...) para os ids, pelo mesmo contexto que o cron lê.
async function codigosDoLar(
  lar: Lar,
): Promise<{ categoria: (slug: string) => string; renda: (id: string) => string }> {
  const ctx = await loadCategorizationContext(createDb(env.DB, newMeter()), lar.householdId);
  const porId = new Map([...ctx.codigos.categorias].map(([codigo, id]) => [id, codigo]));
  const porRenda = new Map([...ctx.codigos.rendas].map(([codigo, id]) => [id, codigo]));
  return {
    categoria: (slug) => porId.get(categoriaDoLar(lar, slug)) ?? "c-inexistente",
    renda: (id) => porRenda.get(id) ?? "r-inexistente",
  };
}

async function comChave(): Promise<void> {
  await saveSecret(createDb(env.DB, newMeter()), ambiente, "claude_api_key", CHAVE_FALSA);
}

async function ciclos(lar: Lar): Promise<void> {
  await env.DB.batch(
    HOJE_CICLOS.map((c) =>
      env.DB.prepare("INSERT INTO cycles (household_id, key, starts_on, ends_on) VALUES (?, ?, ?, ?)").bind(
        lar.householdId,
        c.key,
        c.starts,
        c.ends,
      ),
    ),
  );
}

async function marcarCiclo(id: string, key: string): Promise<void> {
  await env.DB.prepare("UPDATE transactions SET cycle_key = ? WHERE id = ?").bind(key, id).run();
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
  await marcarCiclo(id, extra.cicloKey ?? "2026-10");
  return id;
}

async function pix(
  lar: Lar,
  descricao: string,
  extra: { incomeKind?: string | null; localDate?: string } = {},
): Promise<string> {
  const id = await inserirTransacao(lar, {
    movement: "pix_recebido",
    amountCents: 50000,
    descricao: `[TEST] ${descricao}`,
    contraparte: "[TEST] Amiga",
    doc: "***.123.456-**",
    incomeKind: extra.incomeKind ?? null,
    localDate: extra.localDate,
  });
  await marcarCiclo(id, "2026-10");
  return id;
}

// Importação: o pipeline é o que enfileira e marca o histórico (chamado pelo afterIngest com os inseridos).
const importar = (lar: Lar, ids: string[]) =>
  processNewTransactions(createDb(env.DB, newMeter()), lar.householdId, ids, AGORA);

const rodar = (
  comportamento: Comportamento | null,
  opcoes: { agora?: string; meter?: ReturnType<typeof newMeter> } = {},
) => {
  const { cliente, chamadas } = clienteFalso(comportamento ?? { decidir: tudoIgual });
  return {
    chamadas,
    resultado: runCategorizationSlice(ambiente, {
      now: () => new Date(opcoes.agora ?? AGORA),
      createClient: () => cliente,
      meter: opcoes.meter,
    }),
  };
};

type Linha = {
  category_id: string | null;
  ai_category_id: string | null;
  ai_income_kind: string | null;
  ai_income_subtype: string | null;
  ai_fixed_income_id: string | null;
  ai_confidence: string | null;
  ai_reason: string | null;
  categorized_by: string | null;
  is_backfill: number;
  income_kind: string | null;
  rule_id: string | null;
};

const ler = async (id: string): Promise<Linha> =>
  (await env.DB.prepare(
    "SELECT category_id, ai_category_id, ai_income_kind, ai_income_subtype, ai_fixed_income_id, ai_confidence, ai_reason, categorized_by, is_backfill, income_kind, rule_id FROM transactions WHERE id = ?",
  )
    .bind(id)
    .first<Linha>()) as Linha;

const naFila = (id: string) =>
  contar("SELECT COUNT(*) AS total FROM categorization_queue WHERE transaction_id = ?", id);
const fila = (id: string) =>
  env.DB.prepare("SELECT attempts, last_error FROM categorization_queue WHERE transaction_id = ?")
    .bind(id)
    .first<{ attempts: number; last_error: string | null }>();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("caminho feliz e fila", () => {
  it("três saídas sem regra: o cron sugere, grava ai_*, não toca category_id e esvazia a fila (cenário 1)", async () => {
    const lar = await criarLar();
    await comChave();
    const ids = [
      await compra(lar, "RESTAURANTE DO TESTE"),
      await compra(lar, "MERCADO DO TESTE"),
      await compra(lar, "ACADEMIA DO TESTE"),
    ];
    await importar(lar, ids);
    expect(await contar("SELECT COUNT(*) AS total FROM categorization_queue")).toBe(3);

    const cod = await codigosDoLar(lar);
    const { resultado } = rodar({
      decidir: (item) => ({
        categoria: item.descricao.includes("RESTAURANTE")
          ? cod.categoria("restaurantes")
          : cod.categoria("mercado"),
        motivo: "CNPJ de restaurante",
      }),
    });
    expect(await resultado).toMatchObject({ situacao: "processada", ok: 3 });

    for (const id of ids) {
      const linha = await ler(id);
      expect(linha.ai_category_id).not.toBeNull();
      expect(linha.ai_confidence).toBe("alta");
      expect(linha.ai_reason).toBe("CNPJ de restaurante");
      expect(linha.category_id).toBeNull();
    }
    expect(await contar("SELECT COUNT(*) AS total FROM categorization_queue")).toBe(0);
  });

  it("compra que casa com regra na importação não entra na fila (cenário 2)", async () => {
    const lar = await criarLar();
    const descricao = "[TEST] PAG*LOJA REGRA";
    const categoria = categoriaDoLar(lar, "mercado");
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: establishmentKey(descricao) ?? "",
      setCategoryId: categoria,
      createdFrom: "manual",
    });
    const id = await compra(lar, "PAG*LOJA REGRA");
    await importar(lar, [id]);
    expect(await naFila(id)).toBe(0);
    expect((await ler(id)).category_id).toBe(categoria);
  });

  it("a importação enfileira só o que pede sugestão e marca o histórico, em duas idas", async () => {
    const lar = await criarLar();
    await ciclos(lar);
    const saida = await compra(lar, "SAIDA SEM REGRA", { cicloKey: "2026-08" });
    const entradaSemTipo = await pix(lar, "ENTRADA SEM TIPO");
    const entradaComTipo = await pix(lar, "ENTRADA COM TIPO", { incomeKind: "transferencia" });
    const meter = newMeter();
    await processNewTransactions(
      createDb(env.DB, meter),
      lar.householdId,
      [saida, entradaSemTipo, entradaComTipo],
      AGORA,
    );
    expect(meter.calls).toBeLessThanOrEqual(2);
    expect(await naFila(saida)).toBe(1);
    expect(await naFila(entradaSemTipo)).toBe(1);
    expect(await naFila(entradaComTipo)).toBe(0);
    expect((await ler(saida)).is_backfill).toBe(1);
  });
});

describe("sem sugestão, recusa, corte, falhas e ausência de chave", () => {
  it("categoria null ou fora dos códigos: ai_* nulos e o item sai da fila (cenário 3)", async () => {
    const lar = await criarLar();
    await comChave();
    const nula = await compra(lar, "NULA");
    const invalida = await compra(lar, "INVALIDA");
    await importar(lar, [nula, invalida]);
    await rodar({
      decidir: (item) => (item.descricao.includes("NULA") ? { categoria: null } : { categoria: "c99" }),
    }).resultado;
    for (const id of [nula, invalida]) {
      const linha = await ler(id);
      expect(linha.ai_category_id).toBeNull();
      expect(linha.ai_confidence).toBeNull();
      expect(linha.ai_reason).toBeNull();
      expect(await naFila(id)).toBe(0);
    }
  });

  it("ref que não voltou: fica com 1 tentativa e sem_resposta, e as outras são gravadas (cenário 5)", async () => {
    const lar = await criarLar();
    await comChave();
    const ids = [await compra(lar, "UM"), await compra(lar, "DOIS"), await compra(lar, "TRES")];
    await importar(lar, ids);
    const cod = await codigosDoLar(lar);
    await rodar({
      decidir: (item) =>
        item.descricao.includes("DOIS") ? "omitir" : { categoria: cod.categoria("mercado") },
    }).resultado;
    const doisId = ids[1] as string;
    expect(await fila(doisId)).toEqual({ attempts: 1, last_error: "sem_resposta" });
    expect((await ler(ids[0] as string)).ai_category_id).not.toBeNull();
    expect((await ler(ids[2] as string)).ai_category_id).not.toBeNull();
  });

  it("recusa conta uma tentativa por execução e sai da fila na terceira, sem categoria (cenário 6)", async () => {
    const lar = await criarLar();
    await comChave();
    const id = await compra(lar, "RECUSADA");
    await importar(lar, [id]);
    for (const tentativa of [1, 2, 3]) {
      await rodar({ decidir: tudoIgual, parada: "refusal" }).resultado;
      if (tentativa < 3) expect(await fila(id)).toEqual({ attempts: tentativa, last_error: "recusa" });
    }
    expect(await naFila(id)).toBe(0);
    const linha = await ler(id);
    expect(linha.category_id).toBeNull();
    expect(linha.ai_category_id).toBeNull();
  });

  it("corte por max_tokens segue o mesmo caminho da recusa (cenário 7)", async () => {
    const lar = await criarLar();
    await comChave();
    const id = await compra(lar, "CORTADA");
    await importar(lar, [id]);
    await rodar({ decidir: tudoIgual, parada: "max_tokens" }).resultado;
    expect(await fila(id)).toEqual({ attempts: 1, last_error: "max_tokens" });
  });

  it("API fora (529): nenhuma tentativa conta, a execução para e a próxima tenta de novo (cenário 8)", async () => {
    const lar = await criarLar();
    await comChave();
    const id = await compra(lar, "API FORA");
    await importar(lar, [id]);
    const primeira = await rodar({ decidir: tudoIgual, parada: "indisponivel" }).resultado;
    expect(primeira.situacao).toBe("parada");
    expect(await fila(id)).toEqual({ attempts: 0, last_error: "indisponivel" });
    const segunda = await rodar({ decidir: tudoIgual }).resultado;
    expect(segunda.situacao).toBe("processada");
    expect(await naFila(id)).toBe(0);
  });

  it("chave inválida (401): last_error chave, nenhuma tentativa conta e a execução para (cenário 9)", async () => {
    const lar = await criarLar();
    await comChave();
    const id = await compra(lar, "CHAVE RUIM");
    await importar(lar, [id]);
    const r = await rodar({ decidir: tudoIgual, parada: "chave" }).resultado;
    expect(r.situacao).toBe("parada");
    expect(await fila(id)).toEqual({ attempts: 0, last_error: "chave" });
  });

  it("sem chave: nenhuma chamada e nada muda; colada a chave, a próxima execução processa a fila (cenário 24)", async () => {
    const lar = await criarLar();
    const id = await compra(lar, "SEM CHAVE");
    await importar(lar, [id]);
    const { chamadas, resultado } = rodar({ decidir: tudoIgual });
    expect((await resultado).situacao).toBe("sem_chave");
    expect(chamadas).toHaveLength(0);
    expect(await fila(id)).toEqual({ attempts: 0, last_error: null });
    await comChave();
    expect((await rodar({ decidir: tudoIgual }).resultado).situacao).toBe("processada");
    expect(await naFila(id)).toBe(0);
  });
});

describe("a fila do casal e a regra ganham da IA", () => {
  it("resolvida enquanto esperava: sai da fila e não vai ao Claude (cenário 10)", async () => {
    const lar = await criarLar();
    await comChave();
    const id = await compra(lar, "RESOLVIDA PELO CASAL");
    const outra = await compra(lar, "OUTRA");
    await importar(lar, [id, outra]);
    await env.DB.prepare("UPDATE transactions SET category_id = ?, categorized_by = ? WHERE id = ?")
      .bind(categoriaDoLar(lar, "mercado"), lar.memberId, id)
      .run();
    const { chamadas, resultado } = rodar({ decidir: tudoIgual });
    await resultado;
    expect(chamadas.flat().map((item) => item.descricao)).not.toContain("[TEST] RESOLVIDA PELO CASAL");
    expect(await naFila(id)).toBe(0);
  });

  it("regra que chega durante a chamada: ai_* é gravado e category_id continua o da regra (cenário 11)", async () => {
    const lar = await criarLar();
    await comChave();
    const id = await compra(lar, "CORRIDA");
    await importar(lar, [id]);
    const cod = await codigosDoLar(lar);
    await rodar({
      decidir: () => ({ categoria: cod.categoria("restaurantes") }),
      antes: async () => {
        await env.DB.prepare("UPDATE transactions SET category_id = ?, categorized_by = 'regra' WHERE id = ?")
          .bind(categoriaDoLar(lar, "mercado"), id)
          .run();
      },
    }).resultado;
    const linha = await ler(id);
    expect(linha.ai_category_id).toBe(categoriaDoLar(lar, "restaurantes"));
    expect(linha.category_id).toBe(categoriaDoLar(lar, "mercado"));
    expect(linha.categorized_by).toBe("regra");
  });

  it("atraso acumulado: 120 itens, uma execução processa 50, os mais recentes primeiro (cenário 12)", async () => {
    const lar = await criarLar();
    await comChave();
    const ids: string[] = [];
    for (let i = 0; i < 120; i++) {
      const dia = String(1 + (i % 28)).padStart(2, "0");
      ids.push(await compra(lar, `ATRASO ${i}`, { localDate: `2026-10-${dia}` }));
    }
    await importar(lar, ids);
    const { chamadas, resultado } = rodar({ decidir: () => ({ categoria: null }) });
    await resultado;
    expect(chamadas).toHaveLength(2);
    expect(chamadas.flat()).toHaveLength(50);
    expect(await contar("SELECT COUNT(*) AS total FROM categorization_queue")).toBe(70);
  });
});

describe("histórico e ciclos", () => {
  it("compra de ciclo antigo recebe a sugestão direto no category_id, com categorized_by = 'ia' (cenário 15)", async () => {
    const lar = await criarLar();
    await ciclos(lar);
    await comChave();
    const cod = await codigosDoLar(lar);
    const id = await compra(lar, "HISTORICO", { cicloKey: "2026-08" });
    await importar(lar, [id]);
    expect((await ler(id)).is_backfill).toBe(1);
    await rodar({ decidir: () => ({ categoria: cod.categoria("mercado") }) }).resultado;
    const linha = await ler(id);
    expect(linha.category_id).toBe(categoriaDoLar(lar, "mercado"));
    expect(linha.categorized_by).toBe("ia");
    expect(await naFila(id)).toBe(0);
  });

  it("compra de ciclo antigo sem sugestão fica sem categoria, sem erro e fora da fila (cenário 16)", async () => {
    const lar = await criarLar();
    await ciclos(lar);
    await comChave();
    const id = await compra(lar, "HISTORICO SEM SUGESTAO", { cicloKey: "2026-08" });
    await importar(lar, [id]);
    expect((await rodar({ decidir: tudoIgual }).resultado).situacao).toBe("processada");
    expect((await ler(id)).category_id).toBeNull();
    expect(await naFila(id)).toBe(0);
  });

  it("compra do ciclo anterior ao de hoje: a sugestão fica em ai_category_id, category_id nulo (cenário 17)", async () => {
    const lar = await criarLar();
    await ciclos(lar);
    await comChave();
    const cod = await codigosDoLar(lar);
    const id = await compra(lar, "CICLO ATUAL", { cicloKey: "2026-09" });
    await importar(lar, [id]);
    expect((await ler(id)).is_backfill).toBe(0);
    await rodar({ decidir: () => ({ categoria: cod.categoria("mercado") }) }).resultado;
    const linha = await ler(id);
    expect(linha.category_id).toBeNull();
    expect(linha.ai_category_id).toBe(categoriaDoLar(lar, "mercado"));
  });

  it("virada do ciclo: is_backfill continua 0 e o cron não aplica a sugestão depois (cenário 18)", async () => {
    const lar = await criarLar();
    await ciclos(lar);
    await comChave();
    const cod = await codigosDoLar(lar);
    const id = await compra(lar, "VIRADA", { cicloKey: "2026-10" });
    await importar(lar, [id]);
    await rodar(
      { decidir: () => ({ categoria: cod.categoria("mercado") }) },
      { agora: "2027-01-20T12:00:00.000Z" },
    ).resultado;
    const linha = await ler(id);
    expect(linha.is_backfill).toBe(0);
    expect(linha.category_id).toBeNull();
  });
});

describe("entradas", () => {
  it("parte do salário com a renda fixa: ai_income_kind parte_salario, income_kind nulo (cenário 19)", async () => {
    const lar = await criarLar();
    await comChave();
    const rendaId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO fixed_incomes (id, household_id, name, currency, amount_cents, usual_day, arrival, statement_text, kept_usd_is_investment, archived_at) VALUES (?, ?, '[TEST] Salário em dólar', 'USD', 500000, 5, 'partes', NULL, 1, NULL)",
    )
      .bind(rendaId, lar.householdId)
      .run();
    const id = await pix(lar, "PIX DE AMIGO");
    await importar(lar, [id]);
    const cod = await codigosDoLar(lar);
    await rodar({ decidir: () => ({ entrada: "salario", renda: cod.renda(rendaId) }) }).resultado;
    const linha = await ler(id);
    expect(linha.ai_income_kind).toBe("parte_salario");
    expect(linha.ai_fixed_income_id).toBe(rendaId);
    expect(linha.income_kind).toBeNull();
  });

  it("variável sem subtipo vira outro; com venda, venda (cenário 20)", async () => {
    const lar = await criarLar();
    await comChave();
    const sem = await pix(lar, "VARIAVEL SEM SUBTIPO");
    const com = await pix(lar, "VARIAVEL COM SUBTIPO");
    await importar(lar, [sem, com]);
    await rodar({
      decidir: (item) =>
        item.descricao.includes("COM") && !item.descricao.includes("SEM")
          ? { entrada: "variavel", subtipo: "venda" }
          : { entrada: "variavel" },
    }).resultado;
    expect((await ler(sem)).ai_income_subtype).toBe("outro");
    expect((await ler(com)).ai_income_subtype).toBe("venda");
  });

  it("salario sem renda fixa válida não tem sugestão e conta codigo_invalido (cenários 21 e 22)", async () => {
    const lar = await criarLar();
    await comChave();
    const id = await pix(lar, "SEM RENDA");
    await importar(lar, [id]);
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await rodar({ decidir: () => ({ entrada: "salario", renda: "r9" }) }).resultado;
    const linha = await ler(id);
    expect(linha.ai_income_kind).toBeNull();
    expect(linha.ai_fixed_income_id).toBeNull();
    expect(await naFila(id)).toBe(0);
    expect(log.mock.calls.map((c) => String(c[0])).join("\n")).toContain("codigo_invalido=1");
  });

  it("entrada que a classificação já tipou não entra na fila (cenário 23)", async () => {
    const lar = await criarLar();
    const id = await pix(lar, "JA TIPADA", { incomeKind: "reembolso" });
    await importar(lar, [id]);
    expect(await naFila(id)).toBe(0);
  });
});

describe("limites, logs e a migração", () => {
  it("uma execução faz no máximo 5 chamadas ao D1, e o log não traz descrição nem a chave", async () => {
    const lar = await criarLar();
    await comChave();
    const ids = [await compra(lar, "LOG UM"), await compra(lar, "LOG DOIS")];
    await importar(lar, ids);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const meter = newMeter();
    await rodar({ decidir: () => ({ categoria: null }) }, { meter }).resultado;
    expect(meter.calls).toBeLessThanOrEqual(5);
    const saida = info.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(saida).toContain("categorization: lote=2");
    expect(saida).not.toContain("LOG UM");
    expect(saida).not.toContain(CHAVE_FALSA);
  });

  it("a carga inicial da migração põe na fila as saídas e entradas sem resolver e sem sugestão", async () => {
    const lar = await criarLar();
    const semCategoria = await compra(lar, "CARGA SEM CATEGORIA");
    const comCategoria = await compra(lar, "CARGA COM CATEGORIA", {
      categoryId: categoriaDoLar(lar, "mercado"),
    });
    const entradaSemTipo = await pix(lar, "CARGA ENTRADA");
    const entradaComTipo = await pix(lar, "CARGA ENTRADA TIPADA", { incomeKind: "transferencia" });
    await env.DB.prepare("DELETE FROM categorization_queue").run();
    const insercao = migracao
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .find((s) => s.startsWith("INSERT OR IGNORE INTO `categorization_queue`"));
    expect(insercao).toBeDefined();
    await env.DB.prepare(insercao as string).run();
    expect(await naFila(semCategoria)).toBe(1);
    expect(await naFila(entradaSemTipo)).toBe(1);
    expect(await naFila(comCategoria)).toBe(0);
    expect(await naFila(entradaComTipo)).toBe(0);
  });
});
