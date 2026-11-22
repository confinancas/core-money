// Rotas de medição por etapa da fatia de transações (TASK-0208). Só entram com DEV_ROUTES = "1" (routes.ts).
// Cada etapa tem caminho próprio, para o tail separar os eventos. A cadeia encadeia as etapas por rodada: o preparo
// (conexão, cifras, início e faturas) cria o item "medicao-{rows}-{rodada}" e deixa a fatia no fim das faturas; cada
// etapa roda sobre o estado que a anterior deixou para a mesma rodada. Uma etapa que já rodou nesta rodada responde 409
// "etapa_ja_rodou" sem refazer nada (marcador "medicao" no cursor_json bruto da execução).
import type { Context, Hono } from "hono";
import { etapaCiclo, etapaClassificacao, etapaPipeline, etapaTipos } from "../bank/after-ingest";
import { type ContaDaTransacao, mapTransaction } from "../bank/map";
import { gravarLinhasDaFatia } from "../bank/repository";
import type { Db } from "../db/client";
import type { AppEnv, Env } from "../env";
import { getSession } from "../household/context";
import { apiError } from "../http/errors";
import { type ContextoDeConexao, clientForConnection, nomeDaChave } from "../pluggy/connections";
import { encryptSecret } from "../security/crypto";
import { atingiuOTeto, escritasDeHoje } from "../sync/orcamento";
import { lerCursor, type SyncAccount, type SyncCursor } from "../sync/plan";
import { type LinhaDaExecucao, lerExecucao, startRun } from "../sync/runs";
import { faturasReaisDoCartao, runSyncSlice } from "../sync/slice";
import { pluggyFalsoEmMemoria } from "./pluggy-fake-fetch";

type Corpo = { rodada: number; rows: number };
type Contexto = {
  db: Db;
  env: Env;
  householdId: string;
  runId: string;
  linha: LinhaDaExecucao;
  cursor: SyncCursor;
  rows: number;
  agora: Date;
  fetch: typeof fetch;
};

const chaveDaRodada = ({ rodada, rows }: Corpo): string => `medicao-${rows}-${rodada}`;

async function lerCorpo(c: Context<AppEnv>): Promise<Corpo | null> {
  const corpo = (await c.req.json().catch(() => ({}))) as { rodada?: unknown; rows?: unknown };
  // O medidor troca {i} por texto ("1"), então a rodada pode chegar como número em texto.
  const bruta =
    typeof corpo.rodada === "string" && /^\d+$/.test(corpo.rodada) ? Number(corpo.rodada) : corpo.rodada;
  const rodada = typeof bruta === "number" && Number.isInteger(bruta) && bruta >= 1 ? bruta : null;
  const rows =
    typeof corpo.rows === "number" && Number.isInteger(corpo.rows) && corpo.rows >= 1 && corpo.rows <= 200
      ? corpo.rows
      : null;
  return rodada === null || rows === null ? null : { rodada, rows };
}

async function achaRun(db: Db, itemId: string): Promise<string | null> {
  const linha = await db.$client
    .prepare("SELECT id FROM sync_runs WHERE bank_item_id = ? AND finished_at IS NULL")
    .bind(itemId)
    .first<{ id: string }>();
  return linha?.id ?? null;
}

async function idsDoItem(db: Db, bankItemId: string): Promise<string[]> {
  const linhas = await db.$client
    .prepare("SELECT id FROM transactions WHERE bank_item_id = ?")
    .bind(bankItemId)
    .all<{ id: string }>();
  return (linhas.results ?? []).map((linha) => linha.id);
}

// Marcador de etapas: lido e gravado sobre o JSON bruto, porque lerCursor descarta campos que não conhece.
async function lerMarcadores(
  db: Db,
  runId: string,
): Promise<{ bruto: Record<string, unknown>; feitas: string[] }> {
  const linha = await db.$client
    .prepare("SELECT cursor_json FROM sync_runs WHERE id = ?")
    .bind(runId)
    .first<{ cursor_json: string | null }>();
  const bruto = linha?.cursor_json ? (JSON.parse(linha.cursor_json) as Record<string, unknown>) : {};
  const feitas = Array.isArray(bruto.medicao) ? (bruto.medicao as string[]) : [];
  return { bruto, feitas };
}

async function marcaEtapa(
  db: Db,
  runId: string,
  bruto: Record<string, unknown>,
  etapa: string,
): Promise<void> {
  const novo = {
    ...bruto,
    medicao: [...(Array.isArray(bruto.medicao) ? (bruto.medicao as string[]) : []), etapa],
  };
  await db.$client
    .prepare("UPDATE sync_runs SET cursor_json = ? WHERE id = ?")
    .bind(JSON.stringify(novo), runId)
    .run();
}

function contextoDeConexao(ctx: Contexto): ContextoDeConexao {
  return { db: ctx.db, env: ctx.env, householdId: ctx.householdId, fetch: ctx.fetch, agora: () => ctx.agora };
}

// Lê a primeira janela de transações da fatia (a mesma de faseTransacoes) e mapeia as linhas, sem gravar.
async function leituraDaFatia(ctx: Contexto) {
  const conta: SyncAccount | undefined = ctx.cursor.accounts[ctx.cursor.a];
  const janela = conta?.windows[ctx.cursor.w];
  if (!conta || !janela) throw new Error("medicao: sem conta ou janela na fatia");
  const client = await clientForConnection(contextoDeConexao(ctx), ctx.linha.connection_id);
  const pagina = await client.listTransactions({
    accountId: conta.id,
    dateFrom: janela.from,
    dateTo: janela.to,
  });
  const contaDaTransacao: ContaDaTransacao =
    conta.kind === "BANK"
      ? { kind: "BANK", accountId: conta.id }
      : {
          kind: "CREDIT",
          cardId: conta.id,
          faturas: {
            cardId: conta.id,
            openClosesOn: conta.aberta?.closes_on ?? null,
            knownBills: await faturasReaisDoCartao(ctx.db, conta.id),
          },
        };
  return pagina.results.slice(0, ctx.rows).map((transacao) => mapTransaction(transacao, contaDaTransacao));
}

// Uma etapa da cadeia: acha a rodada, responde 409 se ela já passou desta etapa, roda e marca.
async function etapaDaCadeia(
  c: Context<AppEnv>,
  nome: string,
  executa: (ctx: Contexto) => Promise<Record<string, unknown>>,
): Promise<Response> {
  const corpo = await lerCorpo(c);
  if (corpo === null) return apiError(c, 400, "validacao", "Rodada e linhas (1 a 200) obrigatórias.");
  const { householdId } = getSession(c);
  const db = c.var.db;
  const itemId = chaveDaRodada(corpo);
  const runId = await achaRun(db, itemId);
  if (runId === null) return apiError(c, 404, "preparo_ausente", "Rode o preparo desta rodada antes.");
  const { bruto, feitas } = await lerMarcadores(db, runId);
  if (feitas.includes(nome)) return apiError(c, 409, "etapa_ja_rodou", "Esta etapa já rodou nesta rodada.");
  const linha = await lerExecucao(db, runId);
  if (linha === null) return apiError(c, 404, "preparo_ausente", "Execução da rodada não encontrada.");
  const agora = new Date();
  const resultado = await executa({
    db,
    env: c.env,
    householdId,
    runId,
    linha,
    cursor: lerCursor(linha.cursor_json),
    rows: corpo.rows,
    agora,
    fetch: pluggyFalsoEmMemoria(corpo.rows),
  });
  await marcaEtapa(db, runId, bruto, nome);
  return c.json({ etapa: nome, rodada: corpo.rodada, ...resultado }, 200);
}

async function preparo(c: Context<AppEnv>): Promise<Response> {
  const corpo = await lerCorpo(c);
  if (corpo === null) return apiError(c, 400, "validacao", "Rodada e linhas (1 a 200) obrigatórias.");
  const { householdId } = getSession(c);
  const env = c.env;
  const db = c.var.db;
  const itemId = chaveDaRodada(corpo);
  const connectionId = `medicao-conn-${corpo.rows}-${corpo.rodada}`;
  const agora = new Date().toISOString();
  if ((await db.$client.prepare("SELECT id FROM bank_items WHERE id = ?").bind(itemId).first()) !== null) {
    return apiError(c, 409, "preparo_existente", "O preparo desta rodada já existe.");
  }
  const cifraId = await encryptSecret(
    env.MASTER_KEY,
    nomeDaChave(connectionId, "client_id"),
    "TEST-medicao-client-id",
  );
  const cifraSegredo = await encryptSecret(
    env.MASTER_KEY,
    nomeDaChave(connectionId, "client_secret"),
    "TEST-medicao-client-secret",
  );
  await db.$client.batch([
    db.$client
      .prepare(
        `INSERT INTO pluggy_connections (id, household_id, label, cpf_masked, client_id_enc, iv, client_secret_enc,
           client_secret_iv, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      )
      .bind(
        connectionId,
        householdId,
        `[TEST] Medição etapas ${corpo.rodada}`,
        cifraId.ciphertext,
        cifraId.iv,
        cifraSegredo.ciphertext,
        cifraSegredo.iv,
        agora,
      ),
    db.$client
      .prepare(
        `INSERT INTO bank_items (id, connection_id, institution_name, institution_color, consent_expires_at, last_sync_at,
           status, disconnected_at, created_at) VALUES (?, ?, '[TEST] Banco', '#0E9A63', NULL, NULL, 'ativo', NULL, ?)`,
      )
      .bind(itemId, connectionId, agora),
  ]);
  const runId = await startRun(db, itemId, "historico", agora);
  if (runId === null) return apiError(c, 409, "execucao_aberta", "Já há uma execução deste banco.");
  const deps = { db, fetch: pluggyFalsoEmMemoria(corpo.rows) };
  // Seq 0 é a fatia de início e seq 1 a de faturas: a fatia fica no começo das transações (seq 2).
  for (let seq = 0; seq < 2; seq++) {
    const resultado = await runSyncSlice(env, deps, { runId, seq, tentativa: 1 }, agora);
    if (resultado.tipo !== "continua") return c.json({ preparo: resultado.tipo }, 409);
  }
  return c.json({ preparo: "ok", rodada: corpo.rodada, rows: corpo.rows }, 200);
}

export function registrarEtapasDeMedicao(rotas: Hono<AppEnv>): void {
  rotas.post("/sync-slice/preparo", (c) => preparo(c));

  rotas.post("/sync-slice/cabecalho", (c) =>
    etapaDaCadeia(c, "cabecalho", async (ctx) => {
      const teto = atingiuOTeto(await escritasDeHoje(ctx.db.$client, ctx.agora));
      await clientForConnection(contextoDeConexao(ctx), ctx.linha.connection_id);
      return { fase: ctx.cursor.phase, seq: ctx.cursor.seq, tetoAtingido: teto };
    }),
  );

  rotas.post("/sync-slice/leitura", (c) =>
    etapaDaCadeia(c, "leitura", async (ctx) => ({ lidas: (await leituraDaFatia(ctx)).length })),
  );

  // Leitura do Pluggy falso, mapeamento e gravação sem as etapas depois (inclui a leitura: subtrair /leitura).
  rotas.post("/sync-slice/gravacao", (c) =>
    etapaDaCadeia(c, "gravacao", async (ctx) => {
      const linhas = await leituraDaFatia(ctx);
      const gravado = await gravarLinhasDaFatia(ctx.db, {
        householdId: ctx.householdId,
        bankItemId: ctx.linha.bank_item_id,
        rows: linhas,
        now: ctx.agora.toISOString(),
      });
      return { inseridas: gravado.insertedIds.length, atualizadas: gravado.updatedIds.length };
    }),
  );

  // Leitura dos ids do item (inclui a consulta de ids: subtrair /ids). Não tem marcador: não grava nada.
  rotas.post("/sync-slice/ids", async (c) => {
    const corpo = await lerCorpo(c);
    if (corpo === null) return apiError(c, 400, "validacao", "Rodada e linhas (1 a 200) obrigatórias.");
    const runId = await achaRun(c.var.db, chaveDaRodada(corpo));
    if (runId === null) return apiError(c, 404, "preparo_ausente", "Rode o preparo desta rodada antes.");
    const linha = await lerExecucao(c.var.db, runId);
    if (linha === null) return apiError(c, 404, "preparo_ausente", "Execução da rodada não encontrada.");
    return c.json({ ids: (await idsDoItem(c.var.db, linha.bank_item_id)).length }, 200);
  });

  rotas.post("/sync-slice/classificacao", (c) =>
    etapaDaCadeia(c, "classificacao", async (ctx) => {
      const ids = await idsDoItem(ctx.db, ctx.linha.bank_item_id);
      await etapaClassificacao(ctx.db, ctx.householdId, ids, ctx.agora.toISOString());
      return { ids: ids.length };
    }),
  );

  rotas.post("/sync-slice/ciclo", (c) =>
    etapaDaCadeia(c, "ciclo", async (ctx) => {
      const ids = await idsDoItem(ctx.db, ctx.linha.bank_item_id);
      await etapaCiclo(ctx.db, ctx.householdId, ids);
      return { ids: ids.length };
    }),
  );

  rotas.post("/sync-slice/pipeline", (c) =>
    etapaDaCadeia(c, "pipeline", async (ctx) => {
      const ids = await idsDoItem(ctx.db, ctx.linha.bank_item_id);
      await etapaPipeline(ctx.db, ctx.householdId, ids, ctx.agora.toISOString());
      return { ids: ids.length };
    }),
  );

  rotas.post("/sync-slice/tipos", (c) =>
    etapaDaCadeia(c, "tipos", async (ctx) => {
      const ids = await idsDoItem(ctx.db, ctx.linha.bank_item_id);
      await etapaTipos(ctx.db, ctx.householdId, ids);
      return { ids: ids.length };
    }),
  );

  // A fatia inteira (runSyncSlice) sobre o run preparado, na mensagem seq 2. Repetida, a fila já andou: 409.
  rotas.post("/sync-slice/completa", async (c) => {
    const corpo = await lerCorpo(c);
    if (corpo === null) return apiError(c, 400, "validacao", "Rodada e linhas (1 a 200) obrigatórias.");
    const db = c.var.db;
    const runId = await achaRun(db, chaveDaRodada(corpo));
    if (runId === null) return apiError(c, 404, "preparo_ausente", "Rode o preparo desta rodada antes.");
    const resultado = await runSyncSlice(
      c.env,
      { db, fetch: pluggyFalsoEmMemoria(corpo.rows) },
      { runId, seq: 2, tentativa: 1 },
      new Date().toISOString(),
    );
    if (resultado.tipo === "pulou")
      return apiError(c, 409, "etapa_ja_rodou", "Esta fatia já rodou nesta rodada.");
    return c.json({ etapa: "completa", rodada: corpo.rodada, tipo: resultado.tipo }, 200);
  });
}
