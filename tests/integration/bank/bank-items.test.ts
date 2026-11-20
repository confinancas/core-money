import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/worker/app";
import { createDb } from "../../../src/worker/db/client";
import { type Meter, newMeter } from "../../../src/worker/db/metered-d1";
import type { Env } from "../../../src/worker/env";
import { nomeDaChave } from "../../../src/worker/pluggy/connections";
import { encryptSecret } from "../../../src/worker/security/crypto";
import { startRun } from "../../../src/worker/sync/runs";
import { runSyncSlice } from "../../../src/worker/sync/slice";
import { callApi, semearPronto } from "../helpers/app";
import { semearLar, semearSessao } from "../helpers/sessao";
import { AMBIENTE, rodar, urlDe } from "../sync/importacao-helpers";
import { pluggyFalsoComTransacoes } from "../sync/pluggy-com-transacoes";

// Detalhe do banco conectado (TASK-0206): GET, conferir o consentimento, desconectar e conectar de novo. Dados [TEST],
// Pluggy falso (sem rede). Relógio fixo em 2026-11-12 12:00 UTC (09:00 de São Paulo).

const AGORA = "2026-11-12T12:00:00.000Z";
const VALIDADE_ATUAL = "2026-11-30T00:00:00.000Z";
const VALIDADE_RENOVADA = "2027-11-30T00:00:00.000Z";
const TOKEN = "TESTE-0206-sessao-token-de-teste-0000000000";
const TOKEN_OUTRO_LAR = "TESTE-0206-outro-lar-token-de-teste-000000";
const COOKIE = `mm_sess=${TOKEN}`;
const COOKIE_OUTRO = `mm_sess=${TOKEN_OUTRO_LAR}`;

type Item = { consentExpiresAt: string | null; status?: string; error?: unknown };

// Itens do falso: o que /items/:id devolve. Sem entrada, o item existe com a validade de VALIDADE_ATUAL. Os ids em
// `sumidos` respondem 404 (o item sumiu do Meu Pluggy).
let itensDoFalso: Record<string, Item> = {};
let sumidos = new Set<string>();
// Quantas consultas ao /items o falso recebeu: desconectar e a fila não podem consultar o Pluggy.
let consultasDeItem = 0;

function fetchPluggy(): typeof fetch {
  const base = pluggyFalsoComTransacoes(() => [
    { id: "[TEST]-tx-1", conta: "[TEST]-conta", data: "2026-11-05", valor: -40 },
    { id: "[TEST]-tx-2", conta: "[TEST]-conta", data: "2026-11-06", valor: -25 },
  ]);
  return async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlDe(entrada);
    if (url.pathname.startsWith("/items/")) {
      consultasDeItem += 1;
      const id = decodeURIComponent(url.pathname.slice("/items/".length));
      if (sumidos.has(id)) {
        return new Response(JSON.stringify({ code: 404, codeDescription: "ITEM_NOT_FOUND" }), {
          status: 404,
        });
      }
      const item = itensDoFalso[id] ?? { consentExpiresAt: VALIDADE_ATUAL };
      return new Response(
        JSON.stringify({
          id,
          connector: {
            id: 200,
            name: "MeuPluggy",
            primaryColor: "#8A05BE",
            type: "PERSONAL_BANK",
            isSandbox: false,
          },
          status: item.status ?? "UPDATED",
          executionStatus: "SUCCESS",
          error: item.error ?? null,
          lastUpdatedAt: AGORA,
          consentExpiresAt: item.consentExpiresAt,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return base(entrada, init);
  };
}

const app = (fetchFalso: typeof fetch) =>
  createApp({ pluggyFetch: fetchFalso, agora: () => new Date(AGORA) });

const AMBIENTE_COM_FILA = Object.assign({}, AMBIENTE, {
  SYNC_QUEUE: { send: async () => undefined },
}) as unknown as Env;

type Lar = { householdId: string; memberId: string; connectionId: string; itemId: string };

// Lar com sessão, uma conexão com chaves cifradas e um banco ([TEST] Banco A), com uma conta e um cartão.
async function semearBancoDoLar(opcoes: {
  token?: string;
  passkey: string;
  status?: string;
  consentExpiresAt?: string | null;
}): Promise<Lar> {
  const lar = await semearLar(env.DB, {
    memberId: crypto.randomUUID(),
    passkeyId: opcoes.passkey,
    email: `${crypto.randomUUID()}@example.com`,
  });
  await semearSessao(env.DB, {
    memberId: lar.memberId,
    passkeyId: opcoes.passkey,
    token: opcoes.token ?? TOKEN,
  });
  const connectionId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const cifraId = await encryptSecret(
    env.MASTER_KEY,
    nomeDaChave(connectionId, "client_id"),
    "TEST-client-0206",
  );
  const cifraSegredo = await encryptSecret(
    env.MASTER_KEY,
    nomeDaChave(connectionId, "client_secret"),
    "TEST-segredo-0206",
  );
  const validade = opcoes.consentExpiresAt === undefined ? VALIDADE_ATUAL : opcoes.consentExpiresAt;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO pluggy_connections (id, household_id, label, cpf_masked, client_id_enc, iv, client_secret_enc,
         client_secret_iv, created_at) VALUES (?, ?, '[TEST] Conta A', NULL, ?, ?, ?, ?, ?)`,
    ).bind(
      connectionId,
      lar.householdId,
      cifraId.ciphertext,
      cifraId.iv,
      cifraSegredo.ciphertext,
      cifraSegredo.iv,
      AGORA,
    ),
    env.DB.prepare(
      `INSERT INTO bank_items (id, connection_id, institution_name, institution_color, consent_expires_at, last_sync_at,
         status, disconnected_at, created_at) VALUES (?, ?, '[TEST] Banco A', '#8A05BE', ?, NULL, ?, NULL, ?)`,
    ).bind(itemId, connectionId, validade, opcoes.status ?? "ativo", AGORA),
    env.DB.prepare(
      `INSERT INTO accounts (id, bank_item_id, kind, name, balance_cents, overdraft_used_cents, balance_at)
       VALUES (?, ?, 'corrente', '[TEST] Conta corrente', 31240, 0, ?)`,
    ).bind(`${itemId}-corrente`, itemId, AGORA),
    env.DB.prepare(
      "INSERT INTO cards (id, bank_item_id, last4, name, limit_cents, available_cents, best_day) VALUES (?, ?, '4417', '[TEST] Cartão', NULL, NULL, NULL)",
    ).bind(`${itemId}-cartao`, itemId),
  ]);
  return { householdId: lar.householdId, memberId: lar.memberId, connectionId, itemId };
}

async function pedir(
  fetchFalso: typeof fetch,
  metodo: string,
  caminho: string,
  cookie: string | null = COOKIE,
) {
  const cabecalhos: Record<string, string> = cookie === null ? {} : { cookie };
  const resposta = await callApi(app(fetchFalso), metodo, caminho, undefined, cabecalhos);
  const texto = await resposta.text();
  return {
    status: resposta.status,
    corpo: texto === "" ? null : (JSON.parse(texto) as Record<string, unknown>),
  };
}

beforeEach(async () => {
  await semearPronto(env.DB);
  itensDoFalso = {};
  sumidos = new Set<string>();
  consultasDeItem = 0;
});

const contagem = async (sql: string, ...valores: unknown[]): Promise<number> => {
  const linha = await env.DB.prepare(sql)
    .bind(...valores)
    .first<{ n: number }>();
  return linha?.n ?? 0;
};

describe("GET /api/bank-items/:id (forma e isolamento)", () => {
  it("forma do detalhe: banco, conexão, contas, cartões com a fatura aberta e as execuções", async () => {
    const lar = await semearBancoDoLar({ passkey: "cred-TEST-0206-forma" });
    await env.DB.prepare(
      "INSERT INTO bills (id, card_id, closes_on, due_on, amount_cents, status, paid_on, cycle_key) VALUES (?, ?, '2026-11-20', '2026-11-28', 23400, 'aberta', NULL, NULL)",
    )
      .bind(`${lar.itemId}-fatura`, `${lar.itemId}-cartao`)
      .run();
    const resposta = await pedir(fetchPluggy(), "GET", `/api/bank-items/${lar.itemId}`);
    expect(resposta.status).toBe(200);
    expect(resposta.corpo).toMatchObject({
      id: lar.itemId,
      institutionName: "[TEST] Banco A",
      institutionColor: "#8A05BE",
      connection: { id: lar.connectionId, label: "[TEST] Conta A" },
      status: "ativo",
      disconnectedAt: null,
      consentExpiresAt: VALIDADE_ATUAL,
      lastSyncAt: null,
      running: false,
      failed: false,
      canRetry: false,
      accounts: [
        {
          id: `${lar.itemId}-corrente`,
          kind: "corrente",
          name: "[TEST] Conta corrente",
          balanceCents: 31240,
          balanceAt: AGORA,
        },
      ],
      cards: [
        {
          id: `${lar.itemId}-cartao`,
          name: "[TEST] Cartão",
          last4: "4417",
          openBill: { closesOn: "2026-11-20", amountCents: 23400 },
        },
      ],
      runs: [],
    });
    expect(JSON.stringify(resposta.corpo)).not.toContain("TEST-segredo-0206");
  });

  it("sem sessão: 401; banco de outro lar: 404 e nada muda", async () => {
    const lar = await semearBancoDoLar({ passkey: "cred-TEST-0206-iso-a" });
    await semearBancoDoLar({ token: TOKEN_OUTRO_LAR, passkey: "cred-TEST-0206-iso-b" });
    expect((await pedir(fetchPluggy(), "GET", `/api/bank-items/${lar.itemId}`, null)).status).toBe(401);
    expect((await pedir(fetchPluggy(), "GET", `/api/bank-items/${lar.itemId}`, COOKIE_OUTRO)).status).toBe(
      404,
    );
    expect(
      (await pedir(fetchPluggy(), "POST", `/api/bank-items/${lar.itemId}/disconnect`, COOKIE_OUTRO)).status,
    ).toBe(404);
    expect(
      (await pedir(fetchPluggy(), "POST", `/api/bank-items/${lar.itemId}/consent-check`, COOKIE_OUTRO))
        .status,
    ).toBe(404);
    expect(
      (await pedir(fetchPluggy(), "POST", `/api/bank-items/${lar.itemId}/reconnect`, COOKIE_OUTRO)).status,
    ).toBe(404);
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM bank_items WHERE id = ? AND disconnected_at IS NULL",
        lar.itemId,
      ),
    ).toBe(1);
    expect(consultasDeItem).toBe(0);
  });

  it("o detalhe lê o banco em um lote de 4 leituras (um batch), além da sessão e do portão", async () => {
    const lar = await semearBancoDoLar({ passkey: "cred-TEST-0206-lote" });
    const medidor: { ultimo: Meter | null } = { ultimo: null };
    const medido = createApp({
      pluggyFetch: fetchPluggy(),
      agora: () => new Date(AGORA),
      onMeter: (m) => {
        medidor.ultimo = m;
      },
    });
    const resposta = await callApi(medido, "GET", `/api/bank-items/${lar.itemId}`, undefined, {
      cookie: COOKIE,
    });
    expect(resposta.status).toBe(200);
    const m = medidor.ultimo;
    if (m === null) throw new Error("medidor sem leitura");
    // Sessão e portão: poucas idas. O detalhe em si são 4 comandos num único batch (uma ida).
    expect(m.calls).toBeLessThanOrEqual(8);
    expect(m.statements).toBeGreaterThanOrEqual(4);
    expect(m.calls).toBeLessThan(m.statements);
  });

  it("cenário 12: última execução ok → sem falha e sem botão (failed falso, canRetry falso)", async () => {
    const lar = await semearBancoDoLar({ passkey: "cred-TEST-0206-ok" });
    const runId = (await startRun(createDb(env.DB, newMeter()), lar.itemId, "diaria", AGORA)) as string;
    await env.DB.prepare(
      "UPDATE sync_runs SET finished_at = ?, status = 'ok', new_transactions = 14, progress_pct = 100 WHERE id = ?",
    )
      .bind("2026-11-12T11:00:00.000Z", runId)
      .run();
    const corpo = (await pedir(fetchPluggy(), "GET", `/api/bank-items/${lar.itemId}`)).corpo;
    expect(corpo).toMatchObject({ failed: false, canRetry: false, running: false });
    expect((corpo as { runs: unknown[] }).runs).toEqual([
      expect.objectContaining({
        kind: "diaria",
        status: "ok",
        newTransactions: 14,
        progressPct: 100,
        errorCode: null,
      }),
    ]);
  });

  it("cenário 13: falha que o botão não resolve (chaves inválidas): failed verdadeiro, canRetry falso", async () => {
    const lar = await semearBancoDoLar({ passkey: "cred-TEST-0206-chaves", status: "acao_necessaria" });
    const runId = (await startRun(createDb(env.DB, newMeter()), lar.itemId, "diaria", AGORA)) as string;
    await env.DB.prepare(
      "UPDATE sync_runs SET finished_at = ?, status = 'erro', error_code = 'chaves_invalidas' WHERE id = ?",
    )
      .bind("2026-11-12T11:00:00.000Z", runId)
      .run();
    const corpo = (await pedir(fetchPluggy(), "GET", `/api/bank-items/${lar.itemId}`)).corpo;
    expect(corpo).toMatchObject({ failed: true, canRetry: false });
  });
});

describe("POST /api/bank-items/:id/consent-check (cenários 4, 5 e 6)", () => {
  it("cenário 4: o Pluggy passa a validade para +12 meses → renovado, e a validade nova fica gravada", async () => {
    const lar = await semearBancoDoLar({ passkey: "cred-TEST-0206-renova" });
    itensDoFalso[lar.itemId] = { consentExpiresAt: VALIDADE_RENOVADA };
    const resposta = await pedir(fetchPluggy(), "POST", `/api/bank-items/${lar.itemId}/consent-check`);
    expect(resposta).toEqual({
      status: 200,
      corpo: { renewed: true, consentExpiresAt: VALIDADE_RENOVADA, itemMissing: false },
    });
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM bank_items WHERE id = ? AND consent_expires_at = ?",
        lar.itemId,
        VALIDADE_RENOVADA,
      ),
    ).toBe(1);
  });

  it("cenário 5: mesma validade → não renovado", async () => {
    const lar = await semearBancoDoLar({ passkey: "cred-TEST-0206-nao" });
    itensDoFalso[lar.itemId] = { consentExpiresAt: VALIDADE_ATUAL };
    const resposta = await pedir(fetchPluggy(), "POST", `/api/bank-items/${lar.itemId}/consent-check`);
    expect(resposta.corpo).toEqual({ renewed: false, consentExpiresAt: VALIDADE_ATUAL, itemMissing: false });
  });

  it("cenário 6: o Pluggy não acha mais o item → itemMissing e o banco vai a acao_necessaria, a validade fica", async () => {
    const lar = await semearBancoDoLar({ passkey: "cred-TEST-0206-sumiu" });
    sumidos.add(lar.itemId);
    const resposta = await pedir(fetchPluggy(), "POST", `/api/bank-items/${lar.itemId}/consent-check`);
    expect(resposta).toEqual({
      status: 200,
      corpo: { renewed: false, consentExpiresAt: VALIDADE_ATUAL, itemMissing: true },
    });
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM bank_items WHERE id = ? AND status = 'acao_necessaria'",
        lar.itemId,
      ),
    ).toBe(1);
  });

  it("validade vencida no Pluggy vai a acao_necessaria; com validade nova, a pendência se resolve", async () => {
    const lar = await semearBancoDoLar({ passkey: "cred-TEST-0206-vencida" });
    itensDoFalso[lar.itemId] = { consentExpiresAt: "2026-11-01T00:00:00.000Z" };
    await pedir(fetchPluggy(), "POST", `/api/bank-items/${lar.itemId}/consent-check`);
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM bank_items WHERE id = ? AND status = 'acao_necessaria'",
        lar.itemId,
      ),
    ).toBe(1);
    itensDoFalso[lar.itemId] = { consentExpiresAt: VALIDADE_RENOVADA };
    await pedir(fetchPluggy(), "POST", `/api/bank-items/${lar.itemId}/consent-check`);
    expect(
      await contagem("SELECT COUNT(*) AS n FROM bank_items WHERE id = ? AND status = 'ativo'", lar.itemId),
    ).toBe(1);
  });

  it("Pluggy fora → 502 pluggy_indisponivel, sem gravar", async () => {
    const lar = await semearBancoDoLar({ passkey: "cred-TEST-0206-fora" });
    const falso = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    const resposta = await pedir(falso, "POST", `/api/bank-items/${lar.itemId}/consent-check`);
    expect(resposta.status).toBe(502);
    expect(resposta.corpo).toMatchObject({ error: "pluggy_indisponivel" });
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM bank_items WHERE id = ? AND consent_expires_at = ?",
        lar.itemId,
        VALIDADE_ATUAL,
      ),
    ).toBe(1);
  });
});

describe("desconectar e conectar de novo (cenários 9 e 10)", () => {
  it("cenário 9: desconectar grava a data, para a execução aberta com 'desconectado' e não apaga nada", async () => {
    const lar = await semearBancoDoLar({ passkey: "cred-TEST-0206-desc" });
    const historico = (await startRun(
      createDb(env.DB, newMeter()),
      lar.itemId,
      "historico",
      AGORA,
    )) as string;
    await rodar(historico, fetchPluggy(), 0, 1, AGORA);
    const transacoesAntes = await contagem(
      "SELECT COUNT(*) AS n FROM transactions WHERE bank_item_id = ?",
      lar.itemId,
    );
    const aberta = (await startRun(createDb(env.DB, newMeter()), lar.itemId, "diaria", AGORA)) as string;
    consultasDeItem = 0;
    const primeira = await pedir(fetchPluggy(), "POST", `/api/bank-items/${lar.itemId}/disconnect`);
    expect(primeira.status).toBe(200);
    expect(primeira.corpo).toEqual({ disconnectedAt: AGORA });
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM sync_runs WHERE id = ? AND status = 'erro' AND error_code = 'desconectado'",
        aberta,
      ),
    ).toBe(1);
    expect(await contagem("SELECT COUNT(*) AS n FROM transactions WHERE bank_item_id = ?", lar.itemId)).toBe(
      transacoesAntes,
    );
    expect(await contagem("SELECT COUNT(*) AS n FROM accounts WHERE bank_item_id = ?", lar.itemId)).toBe(1);
    expect(await contagem("SELECT COUNT(*) AS n FROM cards WHERE bank_item_id = ?", lar.itemId)).toBe(1);
    // Idempotente: a segunda vez devolve a mesma data e não consulta o Pluggy.
    consultasDeItem = 0;
    const segunda = await pedir(fetchPluggy(), "POST", `/api/bank-items/${lar.itemId}/disconnect`);
    expect(segunda.corpo).toEqual({ disconnectedAt: AGORA });
    expect(consultasDeItem).toBe(0);
  });

  it("execução que já estava na fila para o banco desconectado para sem trabalho ('desconectado')", async () => {
    const lar = await semearBancoDoLar({ passkey: "cred-TEST-0206-fila" });
    const runId = (await startRun(createDb(env.DB, newMeter()), lar.itemId, "historico", AGORA)) as string;
    // Desconectado sem fechar a execução (a mensagem da fatia chega antes do fechamento).
    await env.DB.prepare("UPDATE bank_items SET disconnected_at = ? WHERE id = ?")
      .bind(AGORA, lar.itemId)
      .run();
    const resultado = await runSyncSlice(
      AMBIENTE_COM_FILA,
      { db: createDb(env.DB, newMeter()), fetch: fetchPluggy() },
      { runId, seq: 0, tentativa: 1 },
      AGORA,
    );
    expect(resultado).toEqual({ tipo: "encerrou", status: "erro", codigo: "desconectado" });
    expect(consultasDeItem).toBe(0);
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM sync_runs WHERE id = ? AND error_code = 'desconectado' AND finished_at IS NOT NULL",
        runId,
      ),
    ).toBe(1);
  });

  it("cenário 10: conectar de novo abre uma importação e não duplica o que já existia", async () => {
    const lar = await semearBancoDoLar({ passkey: "cred-TEST-0206-reconecta" });
    const primeira = (await startRun(createDb(env.DB, newMeter()), lar.itemId, "historico", AGORA)) as string;
    await rodar(primeira, fetchPluggy(), 0, 1, AGORA);
    const antes = await contagem("SELECT COUNT(*) AS n FROM transactions WHERE bank_item_id = ?", lar.itemId);
    expect(antes).toBe(2);
    await pedir(fetchPluggy(), "POST", `/api/bank-items/${lar.itemId}/disconnect`);

    const conexao = await pedir(fetchPluggy(), "POST", `/api/bank-items/${lar.itemId}/reconnect`);
    expect(conexao.status).toBe(202);
    const runId = (conexao.corpo as { runId: string }).runId;
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM bank_items WHERE id = ? AND disconnected_at IS NULL AND status = 'ativo'",
        lar.itemId,
      ),
    ).toBe(1);
    expect(
      await contagem("SELECT COUNT(*) AS n FROM sync_runs WHERE id = ? AND kind = 'historico'", runId),
    ).toBe(1);

    await rodar(runId, fetchPluggy(), 0, 1, AGORA);
    expect(await contagem("SELECT COUNT(*) AS n FROM transactions WHERE bank_item_id = ?", lar.itemId)).toBe(
      antes,
    );
  });

  it("reconectar um banco que está conectado → 409 banco_conectado", async () => {
    const lar = await semearBancoDoLar({ passkey: "cred-TEST-0206-conectado" });
    const resposta = await pedir(fetchPluggy(), "POST", `/api/bank-items/${lar.itemId}/reconnect`);
    expect(resposta).toMatchObject({ status: 409, corpo: { error: "banco_conectado" } });
  });
});

describe("conectar de novo respeita o limite de 5 bancos ativos da conexão (A1, Fable)", () => {
  it("cinco ativos, desconecta um, entra um novo (cinco de novo): conectar o primeiro de volta → 409 limite_meu_pluggy", async () => {
    const lar = await semearBancoDoLar({ passkey: "cred-TEST-0206-limite" });
    for (let i = 0; i < 4; i++) {
      await env.DB.prepare(
        `INSERT INTO bank_items (id, connection_id, institution_name, institution_color, consent_expires_at, last_sync_at,
           status, disconnected_at, created_at) VALUES (?, ?, '[TEST] Banco extra', NULL, NULL, NULL, 'ativo', NULL, ?)`,
      )
        .bind(crypto.randomUUID(), lar.connectionId, AGORA)
        .run();
    }
    expect(
      await contagem("SELECT COUNT(*) AS n FROM bank_items WHERE connection_id = ? AND disconnected_at IS NULL", lar.connectionId),
    ).toBe(5);
    await pedir(fetchPluggy(), "POST", `/api/bank-items/${lar.itemId}/disconnect`);
    expect(
      await contagem("SELECT COUNT(*) AS n FROM bank_items WHERE connection_id = ? AND disconnected_at IS NULL", lar.connectionId),
    ).toBe(4);
    await env.DB.prepare(
      `INSERT INTO bank_items (id, connection_id, institution_name, institution_color, consent_expires_at, last_sync_at,
         status, disconnected_at, created_at) VALUES (?, ?, '[TEST] Banco novo', NULL, NULL, NULL, 'ativo', NULL, ?)`,
    )
      .bind(crypto.randomUUID(), lar.connectionId, AGORA)
      .run();

    const resposta = await pedir(fetchPluggy(), "POST", `/api/bank-items/${lar.itemId}/reconnect`);
    expect(resposta).toMatchObject({
      status: 409,
      corpo: { error: "limite_meu_pluggy", message: "O Meu Pluggy gratuito aceita até 5 bancos por conta." },
    });
    expect(
      await contagem("SELECT COUNT(*) AS n FROM bank_items WHERE id = ? AND disconnected_at IS NOT NULL", lar.itemId),
    ).toBe(1);
    expect(
      await contagem("SELECT COUNT(*) AS n FROM bank_items WHERE connection_id = ? AND disconnected_at IS NULL", lar.connectionId),
    ).toBe(5);
  });
});
