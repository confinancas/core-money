// Spike TASK-0001: um Worker, Hono na API, telas estáticas, D1 com Drizzle, cron.
import { Hono } from "hono";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { asc, count, desc, gt } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import * as schema from "./schema";
import { heartbeats, notes, usage } from "./schema";
import { flushUsage, meteredD1, newMeter, type Meter } from "./metered-d1";
import { auth, currentUserId } from "./auth";

type Env = { DB: D1Database; ANTHROPIC_API_KEY?: string };
export type AppEnv = { Bindings: Env; Variables: { db: DrizzleD1Database<typeof schema>; meter: Meter } };

const BACKUP_PAGE = 500;
const RESTORE_MAX = 200;

const app = new Hono<AppEnv>().basePath("/api");

// Cada requisição mede o próprio uso do D1 e grava numa linha só, depois de responder.
app.use(async (c, next) => {
  const meter = newMeter();
  c.set("meter", meter);
  c.set("db", drizzle(meteredD1(c.env.DB, meter), { schema }));
  await next();
  c.executionCtx.waitUntil(flushUsage(c.env.DB, meter));
});

app.get("/health", (c) => c.json({ ok: true, at: new Date().toISOString() }));

// Hono sem o middleware de medição (registrada antes dele não dá: medição via rota própria).
const bare = new Hono<AppEnv>();
bare.get("/api/hono", (c) => c.text("ok"));

app.get("/usage", async (c) => {
  const rows = await c.var.db.select().from(usage).orderBy(desc(usage.day)).limit(7).all();
  return c.json(rows);
});

app.route("/", auth);

// Daqui para baixo, só com sessão (a chave da Anthropic custa dinheiro).
app.use(async (c, next) => {
  if (!(await currentUserId(c))) return c.json({ error: "Entre com a passkey primeiro." }, 401);
  await next();
});

app.get("/notes", async (c) => {
  const [total] = await c.var.db.select({ n: count() }).from(notes).all();
  const latest = await c.var.db.select().from(notes).orderBy(desc(notes.id)).limit(10).all();
  return c.json({ total: total.n, latest });
});

app.post("/notes", async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  const [row] = await c.var.db
    .insert(notes)
    .values({ text: `[TEST] ${String(text).slice(0, 500)}`, createdAt: Date.now() })
    .returning()
    .all();
  return c.json(row);
});

// Semeia até 200 notas por chamada, num lote só (db.batch conta como uma consulta).
app.post("/notes/seed", async (c) => {
  const { count: n } = await c.req.json<{ count: number }>();
  const size = Math.min(Math.max(1, Number(n) || 0), RESTORE_MAX);
  const now = Date.now();
  const values = Array.from({ length: size }, (_, i) => ({ text: `[TEST] nota ${now}-${i}`, createdAt: now }));
  // 3 colunas por linha; 30 linhas por insert fica abaixo de 100 parâmetros
  const chunks = [];
  for (let i = 0; i < values.length; i += 30) chunks.push(c.var.db.insert(notes).values(values.slice(i, i + 30)));
  await c.var.db.batch(chunks as [typeof chunks[0], ...typeof chunks]);
  return c.json({ inserted: size });
});

app.delete("/notes", async (c) => {
  await c.var.db.delete(notes);
  return c.json({ ok: true });
});

// Backup: uma página por chamada; o navegador monta e cifra o arquivo (ADR-009).
app.get("/backup/notes", async (c) => {
  const cursor = Number(c.req.query("cursor") ?? 0);
  const rows = await c.var.db
    .select()
    .from(notes)
    .where(gt(notes.id, cursor))
    .orderBy(asc(notes.id))
    .limit(BACKUP_PAGE)
    .all();
  const nextCursor = rows.length === BACKUP_PAGE ? rows[rows.length - 1].id : null;
  return c.json({ rows, nextCursor });
});

app.post("/restore/notes", async (c) => {
  const { rows } = await c.req.json<{ rows: { id: number; text: string; createdAt: number }[] }>();
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > RESTORE_MAX) {
    return c.json({ error: `Envie de 1 a ${RESTORE_MAX} linhas por chamada.` }, 400);
  }
  const clean = rows.map((r) => ({ id: Number(r.id), text: String(r.text), createdAt: Number(r.createdAt) }));
  const chunks = [];
  for (let i = 0; i < clean.length; i += 30) chunks.push(c.var.db.insert(notes).values(clean.slice(i, i + 30)));
  await c.var.db.batch(chunks as [typeof chunks[0], ...typeof chunks]);
  return c.json({ restored: clean.length });
});

// IA em streaming: o Worker repassa o texto conforme chega (esperar não conta como CPU).
app.post("/chat", async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "Secret ANTHROPIC_API_KEY ainda não configurado." }, 503);
  const { prompt } = await c.req.json<{ prompt: string }>();
  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  const stream = client.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 2048,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: String(prompt).slice(0, 2000) }],
  });
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") controller.enqueue(encoder.encode("\n[o modelo recusou responder]"));
        if (final.stop_reason === "max_tokens") controller.enqueue(encoder.encode("\n[resposta cortada no limite]"));
      } catch (err) {
        controller.enqueue(encoder.encode(`\n[erro: ${(err as Error).message}]`));
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
});

async function scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
  const meter = newMeter();
  const db = drizzle(meteredD1(env.DB, meter), { schema });
  await db.insert(heartbeats).values({ at: Date.now(), cron: event.cron });
  ctx.waitUntil(flushUsage(env.DB, meter));
}

// Medição do spike: rotas que pulam partes da pilha, para isolar o custo de CPU de cada uma.
async function fetch(request: Request, env: Env, ctx: ExecutionContext) {
  const path = new URL(request.url).pathname;
  if (path === "/api/raw") return new Response("ok"); // sem Hono, sem D1
  if (path === "/api/hono") return bare.fetch(request, env, ctx); // Hono, sem D1 nem medição
  if (path === "/api/raw-d1") {
    const r = await env.DB.prepare("SELECT count(*) AS n FROM notes").first<{ n: number }>();
    return Response.json(r); // sem Hono, uma consulta crua
  }
  return app.fetch(request, env, ctx);
}

export default { fetch, scheduled } satisfies ExportedHandler<Env>;
