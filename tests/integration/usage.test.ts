import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { ScheduledController } from "@cloudflare/workers-types";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type UsageResponse, usageDay } from "../../src/shared/usage";
import { createApp } from "../../src/worker/app";
import { createDb } from "../../src/worker/db/client";
import { type Meter, newMeter } from "../../src/worker/db/metered-d1";
import { households, members } from "../../src/worker/db/schema";
import type { Env } from "../../src/worker/env";
import { flushUsage } from "../../src/worker/usage/flush";
import { meteredScheduled } from "../../src/worker/usage/scheduled";
import { COOKIE_DO_CONJUGE, COOKIE_DO_TITULAR, criaLarDeDuas, criaOutroLar } from "./helpers/aparelhos";
import { callApi, semearPronto } from "./helpers/app";

// Aviso de uso (TASK-0109): a medição, o contador do dia, as faixas e o plano pago. Cenários 1 a 9 e 12, o formato de
// GET /api/usage, o isolamento por lar e o 401. O D1 é o de teste; o contador é gravado pelo mesmo caminho do app.
beforeEach(async () => {
  await semearPronto(env.DB);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Um app com o medidor da produção: cada requisição guarda uma cópia do Meter e grava o contador do dia.
function appMedido(capturas: Meter[] = []) {
  return createApp({
    onMeter: (meter, c) => {
      capturas.push({ ...meter });
      c.executionCtx.waitUntil(flushUsage(c.env.DB, meter));
    },
  });
}

type LinhaDoDia = { requests: number; rows_read: number; rows_written: number; size_bytes: number };

const linhaDo = async (dia: string): Promise<LinhaDoDia | null> =>
  env.DB.prepare("SELECT requests, rows_read, rows_written, size_bytes FROM usage_daily WHERE day = ?")
    .bind(dia)
    .first<LinhaDoDia>();

const hoje = () => usageDay(new Date());

// Semeia o uso de um dia (o que as requisições teriam gravado).
async function semeiaUso(dia: string, valores: Partial<LinhaDoDia>): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO usage_daily (day, requests, rows_read, rows_written, size_bytes) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(
      dia,
      valores.requests ?? 0,
      valores.rows_read ?? 0,
      valores.rows_written ?? 0,
      valores.size_bytes ?? 0,
    )
    .run();
}

async function usoDaApi(app: ReturnType<typeof createApp>, cookie: string): Promise<UsageResponse> {
  const resposta = await callApi(app, "GET", "/api/usage", undefined, { cookie });
  expect(resposta.status).toBe(200);
  return (await resposta.json()) as UsageResponse;
}

describe("GET /api/usage: formato", () => {
  it("devolve dia, plano, faixa, reinício e os quatro recursos (só as leituras são estimativa)", async () => {
    await criaLarDeDuas();
    const corpo = await usoDaApi(appMedido(), COOKIE_DO_TITULAR);

    expect(corpo.day).toBe(hoje());
    expect(corpo.paidPlan).toBe(false);
    expect(corpo.band).toBe("normal");
    expect(corpo.resetsAt).toMatch(/T00:00:00\.000Z$/);
    expect(corpo.resources.map((item) => item.id)).toEqual([
      "requests",
      "rows_read",
      "rows_written",
      "size_bytes",
    ]);
    expect(corpo.resources[0]).toEqual({ id: "requests", used: 0, limit: 100_000, pct: 0 });
    expect(corpo.resources[1]).toMatchObject({ id: "rows_read", estimated: true, limit: 5_000_000 });
    expect(corpo.resources[2]).not.toHaveProperty("estimated");
  });

  it("a rota lê o lar e o dia numa consulta só (a sessão tem a dela): o medidor da rota conta as idas", async () => {
    await criaLarDeDuas();
    const capturas: Meter[] = [];
    const app = appMedido(capturas);

    await callApi(app, "GET", "/api/usage", undefined, { cookie: COOKIE_DO_TITULAR });

    // A primeira medida é desta requisição: a sessão (requireSession) e a consulta do uso, nada mais.
    console.info(`medida GET /api/usage: ${JSON.stringify(capturas[0])}`);
    expect(capturas[0].unmeteredStatements).toBe(0);
    expect(capturas[0].calls).toBeGreaterThanOrEqual(1);
  });
});

// Cenário 1: a contagem do dia UTC é a soma das requisições e do que o medidor viu em cada uma.
describe("cenário 1: contar", () => {
  it("três requisições com consultas: requests = 3, e as linhas são as somadas do medidor (mais 1 do contador)", async () => {
    await criaLarDeDuas();
    const capturas: Meter[] = [];
    const app = appMedido(capturas);

    for (let i = 0; i < 3; i++) {
      await callApi(app, "GET", "/api/usage", undefined, { cookie: COOKIE_DO_TITULAR });
    }

    const linha = await linhaDo(hoje());
    expect(linha?.requests).toBe(3);
    const lidas = capturas.reduce((soma, medida) => soma + medida.rowsRead + 1, 0);
    const escritas = capturas.reduce((soma, medida) => soma + medida.rowsWritten + 1, 0);
    expect(linha?.rows_read).toBe(lidas);
    expect(linha?.rows_written).toBe(escritas);
    expect(lidas).toBeGreaterThan(3);
  });
});

// Cenário 2: o join com colunas de mesmo nome (id em members e em households) volta com os ids certos.
describe("cenário 2: join com colunas repetidas", () => {
  it("Drizzle junta members e households: os dois ids voltam certos e a leitura é contada", async () => {
    const lar = await criaLarDeDuas();
    const medidor = newMeter();
    const db = createDb(env.DB, medidor);

    const linhas = await db
      .select({ membroId: members.id, larId: households.id })
      .from(members)
      .innerJoin(households, eq(households.id, members.householdId))
      .where(eq(members.id, lar.titularId));

    expect(linhas).toEqual([{ membroId: lar.titularId, larId: lar.householdId }]);
    expect(medidor.rowsRead).toBeGreaterThanOrEqual(1);
    expect(medidor.estimatedRows).toBeGreaterThanOrEqual(1);
  });
});

// Cenário 3: cada comando do batch soma o seu meta.
describe("cenário 3: batch", () => {
  it("cada comando do batch soma o seu meta de escritas", async () => {
    const medidor = newMeter();
    const db = createDb(env.DB, medidor);

    const resultados = await db.$client.batch([
      db.$client.prepare("INSERT INTO usage_daily (day, requests) VALUES ('2026-01-01', 1)"),
      db.$client.prepare("INSERT INTO usage_daily (day, requests) VALUES ('2026-01-02', 1)"),
      db.$client.prepare("SELECT COUNT(*) AS total FROM usage_daily"),
    ]);

    const escritasDosComandos = resultados.reduce((soma, r) => soma + (r.meta?.rows_written ?? 0), 0);
    expect(medidor).toMatchObject({ calls: 1, statements: 3 });
    expect(medidor.rowsWritten).toBe(escritasDosComandos);
    expect(medidor.rowsWritten).toBeGreaterThanOrEqual(2);
    expect(resultados[2].results).toEqual([{ total: 2 }]);
  });
});

// Cenário 4: a virada do dia (23:59 e 00:01 UTC) grava em dias diferentes.
describe("cenário 4: virada do dia", () => {
  it("23:59 UTC e 00:01 UTC caem em dias diferentes no D1", async () => {
    const medidor = newMeter();
    await flushUsage(env.DB, medidor, new Date("2026-11-02T23:59:00.000Z"));
    await flushUsage(env.DB, medidor, new Date("2026-11-03T00:01:00.000Z"));

    expect((await linhaDo("2026-11-02"))?.requests).toBe(1);
    expect((await linhaDo("2026-11-03"))?.requests).toBe(1);
  });
});

// Cenário 5: o D1 recusa a escrita do contador; a resposta sai normal.
describe("cenário 5: falha do contador", () => {
  it("o D1 recusa a escrita do contador: a rota responde 200 do mesmo jeito", async () => {
    await criaLarDeDuas();
    const d1Recusado = {
      prepare(sql: string) {
        if (sql.includes("INSERT INTO usage_daily")) {
          const recusa = {
            bind: () => recusa,
            run: async () => {
              throw new Error("D1_ERROR: daily write limit reached");
            },
          };
          return recusa;
        }
        return env.DB.prepare(sql);
      },
      batch: (comandos: D1PreparedStatement[]) => env.DB.batch(comandos),
      exec: (sql: string) => env.DB.exec(sql),
      withSession: () => env.DB.withSession(),
      dump: () => env.DB.dump(),
    } as unknown as D1Database;
    const ambiente = { ...env, DB: d1Recusado } as unknown as Env;

    const resposta = await callApi(
      appMedido(),
      "GET",
      "/api/usage",
      undefined,
      { cookie: COOKIE_DO_TITULAR },
      ambiente,
    );

    expect(resposta.status).toBe(200);
    expect(((await resposta.json()) as UsageResponse).resources).toHaveLength(4);
    expect(await linhaDo(hoje())).toBeNull();
  });
});

// Cenários 6 e 7: faixas de 70% e 90% e a faixa do tamanho do banco.
describe("cenários 6 e 7: faixas", () => {
  it("rows_read em 72%: atenção, com a porcentagem da leitura", async () => {
    await criaLarDeDuas();
    await semeiaUso(hoje(), { rows_read: 3_600_000 });

    const corpo = await usoDaApi(appMedido(), COOKIE_DO_TITULAR);

    expect(corpo.band).toBe("atencao");
    expect(corpo.resources.find((item) => item.id === "rows_read")?.pct).toBe(72);
  });

  it("rows_read em 91%: crítico", async () => {
    await criaLarDeDuas();
    await semeiaUso(hoje(), { rows_read: 4_550_000 });

    expect((await usoDaApi(appMedido(), COOKIE_DO_TITULAR)).band).toBe("critico");
  });

  it("69% continua normal (sem aviso)", async () => {
    await criaLarDeDuas();
    await semeiaUso(hoje(), { rows_read: 3_450_000 });

    expect((await usoDaApi(appMedido(), COOKIE_DO_TITULAR)).band).toBe("normal");
  });

  it("o banco em 75% de 500 MB: faixa de atenção pelo tamanho, com o último tamanho medido de outro dia", async () => {
    await criaLarDeDuas();
    // Hoje ainda não mediu tamanho (zero); o último maior que zero é o de ontem.
    await semeiaUso("2026-11-01", { size_bytes: 393_216_000 });
    await semeiaUso(hoje(), { size_bytes: 0 });

    const corpo = await usoDaApi(appMedido(), COOKIE_DO_TITULAR);

    expect(corpo.resources.find((item) => item.id === "size_bytes")).toMatchObject({
      used: 393_216_000,
      pct: 75,
    });
    expect(corpo.band).toBe("atencao");
  });
});

// Cenário 8: o plano pago desliga a faixa nos dois aparelhos do casal; a seção ainda mostra o uso.
describe("cenário 8: plano pago", () => {
  it("o titular liga 'Estou no plano pago': o cônjuge vê normal, e os recursos continuam", async () => {
    await criaLarDeDuas();
    await semeiaUso(hoje(), { rows_read: 4_550_000 });
    const app = appMedido();

    const liga = await callApi(
      app,
      "PUT",
      "/api/settings/paid-plan",
      { paidPlan: true },
      { cookie: COOKIE_DO_TITULAR },
    );
    expect(liga.status).toBe(200);
    expect(await liga.json()).toEqual({ paidPlan: true });

    const doConjuge = await usoDaApi(app, COOKIE_DO_CONJUGE);
    expect(doConjuge.paidPlan).toBe(true);
    expect(doConjuge.band).toBe("normal");
    expect(doConjuge.resources.find((item) => item.id === "rows_read")?.pct).toBe(91);
  });

  it("PUT inválido é 400 e não muda nada; desligar de novo volta a faixa", async () => {
    await criaLarDeDuas();
    await semeiaUso(hoje(), { rows_read: 4_550_000 });
    const app = appMedido();

    await callApi(app, "PUT", "/api/settings/paid-plan", { paidPlan: true }, { cookie: COOKIE_DO_TITULAR });
    const invalido = await callApi(
      app,
      "PUT",
      "/api/settings/paid-plan",
      { paidPlan: "sim" },
      { cookie: COOKIE_DO_TITULAR },
    );
    expect(invalido.status).toBe(400);
    expect(await invalido.json()).toEqual({ error: "dados_invalidos", message: "Dados inválidos." });
    expect((await usoDaApi(app, COOKIE_DO_TITULAR)).paidPlan).toBe(true);

    await callApi(app, "PUT", "/api/settings/paid-plan", { paidPlan: false }, { cookie: COOKIE_DO_TITULAR });
    expect((await usoDaApi(app, COOKIE_DO_CONJUGE)).band).toBe("critico");
  });
});

// Cenário 9: o D1 lança o erro de limite diário; a rota responde 429 limite_d1 e o log leva só o código.
describe("cenário 9: limite diário do D1", () => {
  it("erro de limite do D1 vira 429 limite_d1, com a volta às 00:00 UTC, e só o código no log", async () => {
    await criaLarDeDuas();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = createApp({
      rotasDoApp: (rotas) => {
        rotas.get("/teste-de-limite", () => {
          throw new Error("D1_ERROR: exceeded daily limit for database");
        });
      },
    });

    const resposta = await callApi(app, "GET", "/api/teste-de-limite", undefined, {
      cookie: COOKIE_DO_TITULAR,
    });

    expect(resposta.status).toBe(429);
    const corpo = (await resposta.json()) as { error: string; resetsAt: string };
    expect(corpo.error).toBe("limite_d1");
    expect(corpo.resetsAt).toMatch(/T00:00:00\.000Z$/);
    expect(log).toHaveBeenCalledWith("limite_d1");
    expect(JSON.stringify(log.mock.calls)).not.toContain("exceeded");
  });
});

// Cenário 12: o cron embrulhado soma 1 em requests e as linhas das consultas do handler.
describe("cenário 12: cron embrulhado", () => {
  it("cada execução soma 1 requisição e as linhas que o handler leu", async () => {
    await semeiaUso("2026-10-01", {});
    await semeiaUso("2026-10-02", {});
    const cron = meteredScheduled(async (_controlador, _ambiente, _ctx, db) => {
      await db.$client.prepare("SELECT day FROM usage_daily").all();
    });
    const ctx = createExecutionContext();

    await cron({} as ScheduledController, env, ctx);
    await waitOnExecutionContext(ctx);

    const linha = await linhaDo(hoje());
    expect(linha?.requests).toBe(1);
    // As duas linhas que o handler leu (o meta do D1) mais 1 do contador; a escrita é só a do contador.
    expect(linha?.rows_read).toBe(3);
    expect(linha?.rows_written).toBe(1);
  });
});

// Isolamento: o plano pago é do lar; a outra família não muda e não vê o do casal.
describe("isolamento por lar", () => {
  it("o plano pago de um lar não aparece para outro lar, e o PUT não muda o outro", async () => {
    const lar = await criaLarDeDuas();
    const outro = await criaOutroLar();
    const app = appMedido();

    await callApi(app, "PUT", "/api/settings/paid-plan", { paidPlan: true }, { cookie: COOKIE_DO_TITULAR });

    expect((await usoDaApi(app, `mm_sess=${outro.token}`)).paidPlan).toBe(false);
    const dono = await env.DB.prepare("SELECT paid_plan FROM households WHERE id = ?")
      .bind(lar.householdId)
      .first();
    expect(dono).toEqual({ paid_plan: 1 });
  });
});

// Sem sessão: 401 antes da rota, nas duas rotas novas.
describe("sem sessão", () => {
  it("GET /api/usage e PUT /api/settings/paid-plan respondem 401", async () => {
    await criaLarDeDuas();
    const app = appMedido();

    const leitura = await callApi(app, "GET", "/api/usage");
    expect(leitura.status).toBe(401);
    expect(await leitura.json()).toMatchObject({ error: "nao_autenticado" });

    const escrita = await callApi(app, "PUT", "/api/settings/paid-plan", { paidPlan: true });
    expect(escrita.status).toBe(401);
  });
});

// Rodada 1 (TASK-0109): o último tamanho medido é o do dia mais recente; o cron que lança conta e propaga o erro; e o
// erro do Drizzle com "quota" num parâmetro não vira limite (responde 500).
describe("rodada 1: último tamanho, cron que lança e falha do Drizzle", () => {
  it("o tamanho do banco é o do dia mais recente que mediu, e não o do dia mais antigo", async () => {
    await criaLarDeDuas();
    await semeiaUso("2026-10-30", { size_bytes: 100_000 });
    await semeiaUso("2026-11-01", { size_bytes: 200_000 });
    await semeiaUso(hoje(), { size_bytes: 0 });

    const corpo = await usoDaApi(appMedido(), COOKIE_DO_TITULAR);

    expect(corpo.resources.find((item) => item.id === "size_bytes")?.used).toBe(200_000);
  });

  it("o cron que lança: a execução conta 1 requisição e o erro sobe para quem chamou", async () => {
    const cron = meteredScheduled(async () => {
      throw new Error("falha de teste no cron");
    });
    const ctx = createExecutionContext();

    await expect(cron({} as ScheduledController, env, ctx)).rejects.toThrow("falha de teste no cron");
    await waitOnExecutionContext(ctx);

    expect((await linhaDo(hoje()))?.requests).toBe(1);
  });

  it("chave estrangeira com 'quota' num parâmetro do Drizzle responde 500, e não o limite do plano", async () => {
    await criaLarDeDuas();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = createApp({
      rotasDoApp: (rotas) => {
        rotas.get("/teste-de-fk", async (c) => {
          await c.var.db.insert(members).values({
            id: "[TEST] membro-sem-lar",
            householdId: "[TEST] lar-que-nao-existe",
            name: "[TEST] Quota do consórcio",
            email: "quota@example.com",
            role: "conjuge",
            createdAt: new Date().toISOString(),
          });
          return c.json({ ok: true }, 200);
        });
      },
    });

    const resposta = await callApi(app, "GET", "/api/teste-de-fk", undefined, { cookie: COOKIE_DO_TITULAR });

    expect(resposta.status).toBe(500);
    expect(log).not.toHaveBeenCalledWith("limite_d1");
  });
});
