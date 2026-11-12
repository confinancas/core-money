import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/worker/app";
import { createDb } from "../../../src/worker/db/client";
import { newMeter } from "../../../src/worker/db/metered-d1";
import { pluggyFalsoEmMemoria } from "../../../src/worker/dev/pluggy-fake-fetch";
import type { Env } from "../../../src/worker/env";
import { despachar, TAREFAS_DO_CRON } from "../../../src/worker/cron/despachante";
import { scheduleDailySync } from "../../../src/worker/sync/daily";
import { startRun } from "../../../src/worker/sync/runs";
import { callApi, semearPronto } from "../helpers/app";
import {
  AMBIENTE,
  type Banco,
  cursorDaExecucao,
  execucao,
  rodar,
  semearBanco,
  urlDe,
} from "./importacao-helpers";

// Sincronização diária e "Baixar agora" (TASK-0205): agendamento pelo dia de São Paulo, o que sumiu do banco, a
// última atualização e a rota de repetir. Dados [TEST]; Pluggy falso (sem rede). Relógio injetado em cada chamada.

// 00:00 de São Paulo é 03:00 UTC.
const MEIA_NOITE = "2026-11-10T03:00:00.000Z";
const CINCO_DA_MANHA_SP = "2026-11-10T08:05:00.000Z";
const NOVE_E_DEZ_SP = "2026-11-10T12:10:00.000Z";
const DOIS_E_CINQUENTA_UTC = "2026-11-11T02:50:00.000Z";
const VINTE_E_UMA_SP = "2026-11-11T00:00:00.000Z";
const DOZE_HORAS_UTC = "2026-11-10T12:00:00.000Z";
const TREZE_HORAS_UTC = "2026-11-10T13:00:00.000Z";
const DEZESSEIS_HORAS_UTC = "2026-11-10T16:00:00.000Z";

const fila: unknown[] = [];
// Ambiente com a fila falsa: o agendamento envia as fatias para a lista, sem a Cloudflare.
const AMBIENTE_COM_FILA = Object.assign({}, AMBIENTE, {
  SYNC_QUEUE: { send: async (mensagem: unknown) => void fila.push(mensagem) },
}) as unknown as Env;

type Tx = { id: string; conta: string; data: string; valor: number; descricao?: string };

// Pluggy falso com as transações de cada conta: `porConta` devolve o que o banco mostra agora para a janela.
function pluggyComTransacoes(
  porConta: (conta: string, de: string, ate: string) => Tx[],
  itemStatus = "UPDATED",
): typeof fetch {
  const base = pluggyFalsoEmMemoria(0);
  return async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlDe(entrada);
    if (url.pathname === "/v2/transactions") {
      const conta = url.searchParams.get("accountId") ?? "";
      const de = url.searchParams.get("dateFrom") ?? "";
      const ate = url.searchParams.get("dateTo") ?? "";
      const results = porConta(conta, de, ate)
        .filter((tx) => tx.data >= de && tx.data <= ate)
        .map((tx) => ({
          id: tx.id,
          accountId: tx.conta,
          date: `${tx.data}T15:00:00.000Z`,
          description: tx.descricao ?? `[TEST] COMPRA ${tx.id}`,
          descriptionRaw: tx.descricao ?? `[TEST] COMPRA ${tx.id}`,
          amount: tx.valor,
          type: tx.valor < 0 ? "DEBIT" : "CREDIT",
          category: "Groceries",
          operationType: "CARTAO",
          paymentData: null,
          creditCardMetadata: null,
          status: "POSTED",
        }));
      return new Response(JSON.stringify({ results, next: null }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname.startsWith("/items/") && itemStatus !== "UPDATED") {
      const resposta = await base(entrada, init);
      const corpo = (await resposta.json()) as Record<string, unknown>;
      return new Response(JSON.stringify({ ...corpo, status: itemStatus }), {
        headers: { "content-type": "application/json" },
      });
    }
    return base(entrada, init);
  };
}

// Transações [TEST] do banco de teste: cinco de compra na conta e uma no cartão, todas em novembro.
const contaDoBanco = (banco: Banco) => `${banco.itemId}-corrente`;

const escritas = async (sql: string, ...valores: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...valores)
    .run();

async function diariasDoBanco(itemId: string): Promise<number> {
  const linha = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM sync_runs WHERE bank_item_id = ? AND kind = 'diaria'",
  )
    .bind(itemId)
    .first<{ n: number }>();
  return linha?.n ?? 0;
}

// Fecha as execuções abertas do banco com um resultado (o que o cron faria no fim).
async function fechaExecucoes(itemId: string, quando: string, status = "ok") {
  await escritas(
    "UPDATE sync_runs SET finished_at = ?, status = ?, progress_pct = 100 WHERE bank_item_id = ? AND finished_at IS NULL",
    quando,
    status,
    itemId,
  );
}

function appDoLar(householdId: string, agora: string) {
  return createApp({
    resolveSession: async () => ({ memberId: "[TEST] membro", householdId }),
    agora: () => new Date(agora),
  });
}

async function semearProntoUmaVez() {
  await semearPronto(env.DB);
}

describe("cenário 1 pelo despachante do cron", () => {
  it("despachar às 00:00 de São Paulo cria uma execução diária por banco; às 00:05 nenhuma nova", async () => {
    const a = await semearBanco();
    const b = await semearBanco();
    // As tarefas registradas no despachante, sem a cotação do dólar (que chama o Banco Central): o teste pega a
    // remoção do agendamento da lista real.
    const tarefas = TAREFAS_DO_CRON.filter((t) => t.nome === "agendar-sincronizacao" || t.nome === "categorizacao");
    expect(tarefas.map((t) => t.nome)).toContain("agendar-sincronizacao");
    await despachar(AMBIENTE_COM_FILA, new Date(MEIA_NOITE), undefined, tarefas);
    expect(await diariasDoBanco(a.itemId)).toBe(1);
    expect(await diariasDoBanco(b.itemId)).toBe(1);
    await fechaExecucoes(a.itemId, CINCO_DA_MANHA_SP);
    await fechaExecucoes(b.itemId, CINCO_DA_MANHA_SP);
    await despachar(AMBIENTE_COM_FILA, new Date("2026-11-10T08:05:00.000Z"), undefined, tarefas);
    expect(await diariasDoBanco(a.itemId)).toBe(1);
    expect(await diariasDoBanco(b.itemId)).toBe(1);
  });
});

describe("agendamento da sincronização diária (cenários 1 a 4)", () => {
  it("cenário 1: dois bancos ativos são agendados às 00:00 de São Paulo; às 00:05 e às 23:55, nenhuma nova", async () => {
    const a = await semearBanco();
    const b = await semearBanco();
    expect(await scheduleDailySync(AMBIENTE_COM_FILA, { agora: new Date(MEIA_NOITE) })).toBe(2);
    expect(await diariasDoBanco(a.itemId)).toBe(1);
    expect(await diariasDoBanco(b.itemId)).toBe(1);
    await fechaExecucoes(a.itemId, CINCO_DA_MANHA_SP);
    await fechaExecucoes(b.itemId, CINCO_DA_MANHA_SP);
    expect(await scheduleDailySync(AMBIENTE_COM_FILA, { agora: new Date("2026-11-10T08:05:00.000Z") })).toBe(
      0,
    );
    expect(await scheduleDailySync(AMBIENTE_COM_FILA, { agora: new Date("2026-11-11T02:55:00.000Z") })).toBe(
      0,
    );
  });

  it("cenário 2: meia-noite de São Paulo, não de UTC: às 21:00 de São Paulo (00:00 UTC), com a execução do dia feita, nada novo", async () => {
    const banco = await semearBanco();
    await scheduleDailySync(AMBIENTE_COM_FILA, { agora: new Date(MEIA_NOITE) });
    await fechaExecucoes(banco.itemId, CINCO_DA_MANHA_SP);
    expect(await scheduleDailySync(AMBIENTE_COM_FILA, { agora: new Date(VINTE_E_UMA_SP) })).toBe(0);
    expect(await diariasDoBanco(banco.itemId)).toBe(1);
  });

  it("cenário 3: cron perdido à meia-noite: às 09:10 agenda uma vez, e a segunda chamada não agenda de novo", async () => {
    const banco = await semearBanco();
    expect(await scheduleDailySync(AMBIENTE_COM_FILA, { agora: new Date(NOVE_E_DEZ_SP) })).toBe(1);
    expect(await scheduleDailySync(AMBIENTE_COM_FILA, { agora: new Date(NOVE_E_DEZ_SP) })).toBe(0);
    expect(await diariasDoBanco(banco.itemId)).toBe(1);
  });

  it("cenário 4: virada do dia: execução às 23:50 de 10/11 (02:50 UTC de 11/11) não conta para 11/11", async () => {
    const banco = await semearBanco();
    await startRun(createDb(env.DB, newMeter()), banco.itemId, "diaria", DOIS_E_CINQUENTA_UTC);
    await fechaExecucoes(banco.itemId, DOIS_E_CINQUENTA_UTC);
    expect(await scheduleDailySync(AMBIENTE_COM_FILA, { agora: new Date("2026-11-11T03:00:00.000Z") })).toBe(
      1,
    );
    expect(await diariasDoBanco(banco.itemId)).toBe(2);
  });

  it("chamadas ao D1 do agendamento sem nada a fazer: uma leitura", async () => {
    const banco = await semearBanco();
    await startRun(createDb(env.DB, newMeter()), banco.itemId, "diaria", DOZE_HORAS_UTC);
    await fechaExecucoes(banco.itemId, DOZE_HORAS_UTC);
    const medidor = newMeter();
    expect(
      await scheduleDailySync(AMBIENTE_COM_FILA, {
        agora: new Date(TREZE_HORAS_UTC),
        db: createDb(env.DB, medidor),
      }),
    ).toBe(0);
    expect(medidor.calls).toBe(1);
  });
});

describe("desconectado e sem chaves (cenários 5 e 13)", () => {
  it("cenário 5: banco desconectado não é agendado e o 'Baixar agora' responde 409 banco_desconectado", async () => {
    await semearProntoUmaVez();
    const banco = await semearBanco();
    await escritas("UPDATE bank_items SET disconnected_at = ? WHERE id = ?", DOZE_HORAS_UTC, banco.itemId);
    expect(await scheduleDailySync(AMBIENTE_COM_FILA, { agora: new Date(MEIA_NOITE) })).toBe(0);
    const resposta = await callApi(
      appDoLar(banco.householdId, TREZE_HORAS_UTC),
      "POST",
      `/api/bank-items/${banco.itemId}/sync`,
      undefined,
      {},
      AMBIENTE,
    );
    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toMatchObject({ error: "banco_desconectado" });
  });

  it("cenário 13: sem chaves não agenda, o 'Baixar agora' responde 409 sem_chaves; com as chaves de volta, agenda", async () => {
    await semearProntoUmaVez();
    const banco = await semearBanco();
    const guardado = await env.DB.prepare("SELECT client_id_enc, iv FROM pluggy_connections WHERE id = ?")
      .bind(banco.connectionId)
      .first<{ client_id_enc: string; iv: string }>();
    await escritas(
      "UPDATE pluggy_connections SET client_id_enc = NULL, iv = NULL WHERE id = ?",
      banco.connectionId,
    );
    expect(await scheduleDailySync(AMBIENTE_COM_FILA, { agora: new Date(MEIA_NOITE) })).toBe(0);
    const resposta = await callApi(
      appDoLar(banco.householdId, TREZE_HORAS_UTC),
      "POST",
      `/api/bank-items/${banco.itemId}/sync`,
      undefined,
      {},
      AMBIENTE,
    );
    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toMatchObject({ error: "sem_chaves" });

    await escritas(
      "UPDATE pluggy_connections SET client_id_enc = ?, iv = ? WHERE id = ?",
      guardado?.client_id_enc,
      guardado?.iv,
      banco.connectionId,
    );
    expect(await scheduleDailySync(AMBIENTE_COM_FILA, { agora: new Date(MEIA_NOITE) })).toBe(1);
  });
});

describe("Baixar agora (cenários 6 e 7)", () => {
  it("cenário 6: depois de uma falha que repete (instável), 202 e a execução manual; dois toques ao mesmo tempo, uma execução", async () => {
    await semearProntoUmaVez();
    const banco = await semearBanco();
    const anterior = await startRun(createDb(env.DB, newMeter()), banco.itemId, "diaria", DOZE_HORAS_UTC);
    await escritas(
      "UPDATE sync_runs SET finished_at = ?, status = 'instavel', error_code = 'banco_instavel' WHERE id = ?",
      TREZE_HORAS_UTC,
      anterior,
    );
    const app = appDoLar(banco.householdId, TREZE_HORAS_UTC);
    const [primeiro, segundo] = await Promise.all([
      callApi(app, "POST", `/api/bank-items/${banco.itemId}/sync`, undefined, {}, AMBIENTE_COM_FILA),
      callApi(app, "POST", `/api/bank-items/${banco.itemId}/sync`, undefined, {}, AMBIENTE_COM_FILA),
    ]);
    const codigos = [primeiro.status, segundo.status].sort();
    expect(codigos).toEqual([202, 409]);
    const manuais = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM sync_runs WHERE bank_item_id = ? AND kind = 'manual'",
    )
      .bind(banco.itemId)
      .first<{ n: number }>();
    expect(manuais?.n).toBe(1);
  });

  it("cenário 6: última com sucesso: 409 sem_falha; erro de chaves: 409 falha_precisa_de_acao", async () => {
    await semearProntoUmaVez();
    const banco = await semearBanco();
    const execucao1 = await startRun(createDb(env.DB, newMeter()), banco.itemId, "diaria", DOZE_HORAS_UTC);
    await escritas(
      "UPDATE sync_runs SET finished_at = ?, status = 'ok' WHERE id = ?",
      TREZE_HORAS_UTC,
      execucao1,
    );
    const app = appDoLar(banco.householdId, DEZESSEIS_HORAS_UTC);
    const semFalha = await callApi(
      app,
      "POST",
      `/api/bank-items/${banco.itemId}/sync`,
      undefined,
      {},
      AMBIENTE,
    );
    expect(semFalha.status).toBe(409);
    expect(await semFalha.json()).toMatchObject({ error: "sem_falha" });

    await escritas(
      "UPDATE sync_runs SET status = 'erro', error_code = 'chaves_invalidas' WHERE id = ?",
      execucao1,
    );
    const precisa = await callApi(
      app,
      "POST",
      `/api/bank-items/${banco.itemId}/sync`,
      undefined,
      {},
      AMBIENTE,
    );
    expect(precisa.status).toBe(409);
    expect(await precisa.json()).toMatchObject({ error: "falha_precisa_de_acao" });
  });

  it("cenário 6: outro lar não vê o banco: 404", async () => {
    await semearProntoUmaVez();
    const banco = await semearBanco();
    const outro = await semearBanco();
    const resposta = await callApi(
      appDoLar(outro.householdId, TREZE_HORAS_UTC),
      "POST",
      `/api/bank-items/${banco.itemId}/sync`,
      undefined,
      {},
      AMBIENTE,
    );
    expect(resposta.status).toBe(404);
  });

  it("cenário 7: com a diária aberta, 409 atualizacao_em_andamento", async () => {
    await semearProntoUmaVez();
    const banco = await semearBanco();
    await startRun(createDb(env.DB, newMeter()), banco.itemId, "diaria", DOZE_HORAS_UTC);
    const resposta = await callApi(
      appDoLar(banco.householdId, TREZE_HORAS_UTC),
      "POST",
      `/api/bank-items/${banco.itemId}/sync`,
      undefined,
      {},
      AMBIENTE,
    );
    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toMatchObject({ error: "atualizacao_em_andamento" });
  });
});

describe("leitura da janela e o que sumiu (cenários 8 a 10)", () => {
  it("cenário 8: releitura com as mesmas transações não insere nada e termina ok", async () => {
    const banco = await semearBanco();
    const txs: Tx[] = [
      { id: "[TEST]-t1", conta: contaDoBanco(banco), data: "2026-11-05", valor: -40 },
      { id: "[TEST]-t2", conta: contaDoBanco(banco), data: "2026-11-06", valor: -25 },
    ];
    const fetch = pluggyComTransacoes((conta) => txs.filter((tx) => tx.conta === conta));
    const primeira = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "diaria",
      DOZE_HORAS_UTC,
    )) as string;
    await rodar(primeira, fetch, 0, 1, DOZE_HORAS_UTC);
    expect((await execucao(primeira))?.new_transactions).toBe(2);

    const segunda = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "diaria",
      TREZE_HORAS_UTC,
    )) as string;
    await rodar(segunda, fetch, 0, 1, TREZE_HORAS_UTC);
    expect(await execucao(segunda)).toMatchObject({ status: "ok", new_transactions: 0 });
  });

  it("cenário 9: compra pendente t1 que volta como t2 sai dos cálculos; t2 entra; a conta não duplica", async () => {
    const banco = await semearBanco();
    const conta = contaDoBanco(banco);
    const fetchA = pluggyComTransacoes((c) =>
      c === conta ? [{ id: "[TEST]-t1", conta, data: "2026-11-05", valor: -40 }] : [],
    );
    const primeira = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "diaria",
      DOZE_HORAS_UTC,
    )) as string;
    await rodar(primeira, fetchA, 0, 1, DOZE_HORAS_UTC);

    const fetchB = pluggyComTransacoes((c) =>
      c === conta ? [{ id: "[TEST]-t2", conta, data: "2026-11-05", valor: -40 }] : [],
    );
    const segunda = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "diaria",
      TREZE_HORAS_UTC,
    )) as string;
    await rodar(segunda, fetchB, 0, 1, TREZE_HORAS_UTC);

    const t1 = await env.DB.prepare("SELECT removed_at FROM transactions WHERE external_id = ?")
      .bind("[TEST]-t1")
      .first<{ removed_at: string | null }>();
    const t2 = await env.DB.prepare("SELECT removed_at FROM transactions WHERE external_id = ?")
      .bind("[TEST]-t2")
      .first<{ removed_at: string | null }>();
    expect(t1?.removed_at).toBe(TREZE_HORAS_UTC);
    expect(t2?.removed_at).toBeNull();
    const vivas = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM transactions WHERE bank_item_id = ? AND removed_at IS NULL",
    )
      .bind(banco.itemId)
      .first<{ n: number }>();
    expect(vivas?.n).toBe(1);
    expect(await execucao(segunda)).toMatchObject({ status: "ok" });
  });

  it("cenário 10: janela que voltou vazia com 12 linhas locais não marca nada", async () => {
    const banco = await semearBanco();
    const conta = contaDoBanco(banco);
    const doze: Tx[] = Array.from({ length: 12 }, (_, i) => ({
      id: `[TEST]-v${i}`,
      conta,
      data: "2026-11-05",
      valor: -(10 + i),
    }));
    const primeira = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "diaria",
      DOZE_HORAS_UTC,
    )) as string;
    await rodar(
      primeira,
      pluggyComTransacoes((c) => (c === conta ? doze : [])),
      0,
      1,
      DOZE_HORAS_UTC,
    );

    const segunda = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "diaria",
      TREZE_HORAS_UTC,
    )) as string;
    await rodar(
      segunda,
      pluggyComTransacoes(() => []),
      0,
      1,
      TREZE_HORAS_UTC,
    );
    const vivas = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM transactions WHERE bank_item_id = ? AND removed_at IS NULL",
    )
      .bind(banco.itemId)
      .first<{ n: number }>();
    expect(vivas?.n).toBe(12);
  });

  it("cenário 10 (poucas linhas): janela que voltou vazia com 3 linhas locais não marca nada (só a guarda da janela vazia segura)", async () => {
    const banco = await semearBanco();
    const conta = contaDoBanco(banco);
    const tres: Tx[] = Array.from({ length: 3 }, (_, i) => ({
      id: `[TEST]-p${i}`,
      conta,
      data: "2026-11-05",
      valor: -(7 + i),
    }));
    const primeira = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "diaria",
      DOZE_HORAS_UTC,
    )) as string;
    await rodar(
      primeira,
      pluggyComTransacoes((c) => (c === conta ? tres : [])),
      0,
      1,
      DOZE_HORAS_UTC,
    );

    const segunda = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "diaria",
      TREZE_HORAS_UTC,
    )) as string;
    await rodar(
      segunda,
      pluggyComTransacoes(() => []),
      0,
      1,
      TREZE_HORAS_UTC,
    );
    const vivas = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM transactions WHERE bank_item_id = ? AND removed_at IS NULL",
    )
      .bind(banco.itemId)
      .first<{ n: number }>();
    expect(vivas?.n).toBe(3);
  });

  it("cenário 11: 40 de 100 ausentes: nada marcado e error_code conferir_sumidas (o status segue ok)", async () => {
    const banco = await semearBanco();
    const conta = contaDoBanco(banco);
    const cem: Tx[] = Array.from({ length: 100 }, (_, i) => ({
      id: `[TEST]-m${i}`,
      conta,
      data: "2026-11-05",
      valor: -(5 + i),
    }));
    const primeira = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "diaria",
      DOZE_HORAS_UTC,
    )) as string;
    await rodar(
      primeira,
      pluggyComTransacoes((c) => (c === conta ? cem : [])),
      0,
      1,
      DOZE_HORAS_UTC,
    );

    const sessenta = cem.slice(0, 60);
    const segunda = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "diaria",
      TREZE_HORAS_UTC,
    )) as string;
    await rodar(
      segunda,
      pluggyComTransacoes((c) => (c === conta ? sessenta : [])),
      0,
      1,
      TREZE_HORAS_UTC,
    );
    const vivas = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM transactions WHERE bank_item_id = ? AND removed_at IS NULL",
    )
      .bind(banco.itemId)
      .first<{ n: number }>();
    expect(vivas?.n).toBe(100);
    expect(await execucao(segunda)).toMatchObject({ status: "ok" });
    const run = await env.DB.prepare("SELECT error_code FROM sync_runs WHERE id = ?")
      .bind(segunda)
      .first<{ error_code: string | null }>();
    expect(run?.error_code).toBe("conferir_sumidas");
  });
});

describe("status, volta a ativo e fila (cenários 12, N6 e N9)", () => {
  it("cenário 12: GET /api/sync/status mostra lastSync (a mais recente) e os nomes dos bancos", async () => {
    await semearProntoUmaVez();
    const banco = await semearBanco();
    const execucao1 = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "diaria",
      DOZE_HORAS_UTC,
    )) as string;
    await rodar(
      execucao1,
      pluggyComTransacoes(() => []),
      0,
      1,
      DOZE_HORAS_UTC,
    );
    const resposta = await callApi(
      appDoLar(banco.householdId, TREZE_HORAS_UTC),
      "GET",
      "/api/sync/status",
      undefined,
      {},
      AMBIENTE,
    );
    const corpo = (await resposta.json()) as {
      lastSync: { at: string; banks: string[] } | null;
      banks: { bankItemId: string; running: boolean; failed: boolean; canRetry: boolean }[];
    };
    expect(corpo.lastSync?.at).toBe(DOZE_HORAS_UTC);
    expect(corpo.lastSync?.banks).toEqual(["[TEST] Banco"]);
    expect(corpo.banks).toEqual([
      expect.objectContaining({ bankItemId: banco.itemId, running: false, failed: false, canRetry: false }),
    ]);
  });

  it("N6: item OUTDATED deixa o banco instável; uma diária boa depois devolve a ativo; a que viu OUTDATED não", async () => {
    const banco = await semearBanco();
    const conta = contaDoBanco(banco);
    const primeira = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "diaria",
      DOZE_HORAS_UTC,
    )) as string;
    await rodar(
      primeira,
      pluggyComTransacoes(() => [], "OUTDATED"),
      0,
      1,
      DOZE_HORAS_UTC,
    );
    const status1 = await env.DB.prepare("SELECT status FROM bank_items WHERE id = ?")
      .bind(banco.itemId)
      .first<{ status: string }>();
    expect(status1?.status).toBe("instavel");

    const segunda = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "diaria",
      TREZE_HORAS_UTC,
    )) as string;
    await rodar(
      segunda,
      pluggyComTransacoes((c) => (c === conta ? [] : [])),
      0,
      1,
      TREZE_HORAS_UTC,
    );
    const status2 = await env.DB.prepare("SELECT status FROM bank_items WHERE id = ?")
      .bind(banco.itemId)
      .first<{ status: string }>();
    expect(status2?.status).toBe("ativo");
  });

  it("N9: a releitura diária não põe de volta na fila da IA a linha sem categoria, nem regrava is_backfill", async () => {
    const banco = await semearBanco();
    const conta = contaDoBanco(banco);
    const txs: Tx[] = [{ id: "[TEST]-n9", conta, data: "2026-11-05", valor: -33 }];
    const fetch = pluggyComTransacoes((c) => (c === conta ? txs : []));
    const primeira = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "diaria",
      DOZE_HORAS_UTC,
    )) as string;
    await rodar(primeira, fetch, 0, 1, DOZE_HORAS_UTC);
    // Fila esvaziada, como depois da IA: a linha segue sem categoria.
    await escritas("DELETE FROM categorization_queue");
    await escritas("UPDATE transactions SET is_backfill = 0 WHERE external_id = ?", "[TEST]-n9");

    const segunda = (await startRun(
      createDb(env.DB, newMeter()),
      banco.itemId,
      "diaria",
      TREZE_HORAS_UTC,
    )) as string;
    await rodar(segunda, fetch, 0, 1, TREZE_HORAS_UTC);
    const fila2 = await env.DB.prepare("SELECT COUNT(*) AS n FROM categorization_queue").first<{
      n: number;
    }>();
    expect(fila2?.n).toBe(0);
    const linha = await env.DB.prepare("SELECT is_backfill FROM transactions WHERE external_id = ?")
      .bind("[TEST]-n9")
      .first<{ is_backfill: number }>();
    expect(linha?.is_backfill).toBe(0);
    expect((await cursorDaExecucao(segunda)).phase).toBe("fim");
  });
});
