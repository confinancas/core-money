// Rotas de medição de CPU (TASK-0204). Só respondem com DEV_ROUTES = "1" (o gate do app devolve 404 sem a flag).
// POST /api/dev/sync-slice { rows, fase }: cria uma conexão e um banco [TEST] com chaves fictícias e roda as fatias até a
// fase pedida (inicio, faturas, transacoes ou fim), contra o Meu Pluggy falso em memória. Nenhuma rede.
import { Hono } from "hono";
import { despachar } from "../cron/despachante";
import type { AppEnv, Env } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";
import { nomeDaChave } from "../pluggy/connections";
import { encryptSecret } from "../security/crypto";
import { startRun } from "../sync/runs";
import { type ResultadoDaFatia, runSyncSlice } from "../sync/slice";
import { pluggyFalsoEmMemoria } from "./pluggy-fake-fetch";

const FASES = ["inicio", "faturas", "transacoes", "fim"] as const;
type Fase = (typeof FASES)[number];
// Passos até cada fase: inicio é uma fatia; faturas, duas; transacoes, três (a primeira fatia de transações).
const PASSOS_ATE: Record<Fase, number> = { inicio: 1, faturas: 2, transacoes: 3, fim: 1000 };

export type OpcoesDasRotasDeDev = { fetch?: typeof fetch };

export function devRoutes(resolveSession: SessionResolver, opcoes: OpcoesDasRotasDeDev = {}): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  rotas.post("/sync-slice", async (c) => {
    const { householdId } = getSession(c);
    const corpo = (await c.req.json().catch(() => ({}))) as { rows?: unknown; fase?: unknown };
    const linhas = typeof corpo.rows === "number" && Number.isInteger(corpo.rows) ? corpo.rows : 200;
    const fase = (typeof corpo.fase === "string" ? corpo.fase : "transacoes") as Fase;
    if (linhas < 1 || linhas > 200 || !FASES.includes(fase)) {
      return apiError(c, 400, "validacao", "Linhas de 1 a 200 e fase conhecida.");
    }
    const env: Env = c.env;
    const db = c.var.db;
    const agora = new Date().toISOString();

    // Conexão e banco [TEST] com chaves fictícias, cifradas como as da TASK-0203.
    const connectionId = crypto.randomUUID();
    const itemId = `dev-${crypto.randomUUID()}`;
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
          `[TEST] Medição ${connectionId.slice(0, 8)}`,
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

    const deps = { db, fetch: opcoes.fetch ?? pluggyFalsoEmMemoria(linhas) };
    const passos: ResultadoDaFatia[] = [];
    let seq = 0;
    for (let i = 0; i < PASSOS_ATE[fase]; i++) {
      const resultado = await runSyncSlice(env, deps, { runId, seq, tentativa: 1 }, agora);
      passos.push(resultado);
      if (resultado.tipo !== "continua") break;
      seq += 1;
    }
    return c.json({ runId, bankItemId: itemId, fase, passos: passos.map((passo) => passo.tipo) }, 200);
  });

  // Roda o despachante do cron agora, com o db medido (TASK-0205, CPU da sincronização agendada). Mesmo guarda DEV_ROUTES.
  rotas.post("/cron", async (c) => {
    await despachar(c.env, new Date(), c.var.db);
    return c.json({ ok: true }, 200);
  });

  return rotas;
}
