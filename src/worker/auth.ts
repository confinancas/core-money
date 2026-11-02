// Passkeys (ADR-010): cadastrar, entrar, listar e remover. Sessão por cookie.
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { and, eq, lt } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { challenges, passkeys, sessions, users } from "./schema";
import type { AppEnv } from "./index";

const SESSION_COOKIE = "mm_sess";
const CHALLENGE_COOKIE = "mm_chal";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export const b64url = {
  encode(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(text: string): Uint8Array<ArrayBuffer> {
    const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

const randomToken = () => b64url.encode(crypto.getRandomValues(new Uint8Array(32)));

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const rp = (c: Context<AppEnv>) => {
  const url = new URL(c.req.url);
  return { rpID: url.hostname, origin: url.origin };
};

export async function currentUserId(c: Context<AppEnv>): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const row = await c.var.db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(eq(sessions.tokenHash, await sha256Hex(token)))
    .get();
  return row?.userId ?? null;
}

async function startSession(c: Context<AppEnv>, userId: string) {
  const token = randomToken();
  await c.var.db.insert(sessions).values({ tokenHash: await sha256Hex(token), userId, createdAt: Date.now() });
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
}

async function saveChallenge(c: Context<AppEnv>, challenge: string, userId: string | null) {
  const id = randomToken();
  const now = Date.now();
  await c.var.db.batch([
    c.var.db.delete(challenges).where(lt(challenges.expiresAt, now)),
    c.var.db.insert(challenges).values({ id, challenge, userId, expiresAt: now + CHALLENGE_TTL_MS }),
  ]);
  setCookie(c, CHALLENGE_COOKIE, id, { httpOnly: true, secure: true, sameSite: "Strict", path: "/api/passkey", maxAge: 300 });
}

async function takeChallenge(c: Context<AppEnv>) {
  const id = getCookie(c, CHALLENGE_COOKIE);
  if (!id) return null;
  deleteCookie(c, CHALLENGE_COOKIE, { path: "/api/passkey" });
  const row = await c.var.db.select().from(challenges).where(eq(challenges.id, id)).get();
  if (!row) return null;
  await c.var.db.delete(challenges).where(eq(challenges.id, id));
  return row.expiresAt > Date.now() ? row : null;
}

export const auth = new Hono<AppEnv>();

auth.get("/me", async (c) => {
  const userId = await currentUserId(c);
  const anyUser = await c.var.db.select({ id: users.id }).from(users).limit(1).get();
  return c.json({ userId, setupOpen: !anyUser });
});

auth.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.var.db.delete(sessions).where(eq(sessions.tokenHash, await sha256Hex(token)));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// Cadastrar: aberto só enquanto não há usuário (spike: sem código de primeiro acesso, ver ADR-004);
// depois, só logado ("Adicionar este aparelho").
auth.post("/passkey/register/options", async (c) => {
  const db = c.var.db;
  let userId = await currentUserId(c);
  if (!userId) {
    const anyUser = await db.select({ id: users.id }).from(users).limit(1).get();
    if (anyUser) return c.json({ error: "Entre primeiro para adicionar um aparelho." }, 401);
    userId = crypto.randomUUID();
    await db.insert(users).values({ id: userId, name: "Gustavo (spike)" });
  }
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  const existing = await db.select({ id: passkeys.id, transports: passkeys.transports }).from(passkeys).where(eq(passkeys.userId, userId)).all();
  const { rpID } = rp(c);
  const options = await generateRegistrationOptions({
    rpName: "Matrimoney",
    rpID,
    userName: user!.name,
    userID: new TextEncoder().encode(userId),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports ? JSON.parse(p.transports) : undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  await saveChallenge(c, options.challenge, userId);
  return c.json(options);
});

auth.post("/passkey/register/verify", async (c) => {
  const body = await c.req.json<{ response: any; deviceName?: string }>();
  const chal = await takeChallenge(c);
  if (!chal?.userId) return c.json({ error: "Desafio expirado. Tente de novo." }, 400);
  const { rpID, origin } = rp(c);
  const result = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge: chal.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });
  if (!result.verified) return c.json({ error: "Não foi possível verificar a passkey." }, 400);
  const cred = result.registrationInfo.credential;
  await c.var.db.insert(passkeys).values({
    id: cred.id,
    userId: chal.userId,
    publicKey: b64url.encode(cred.publicKey),
    counter: cred.counter,
    transports: cred.transports ? JSON.stringify(cred.transports) : null,
    deviceName: (body.deviceName || "Aparelho").slice(0, 60),
    createdAt: Date.now(),
  });
  if (!(await currentUserId(c))) await startSession(c, chal.userId);
  return c.json({ ok: true });
});

auth.post("/passkey/login/options", async (c) => {
  const options = await generateAuthenticationOptions({ rpID: rp(c).rpID, userVerification: "preferred" });
  await saveChallenge(c, options.challenge, null);
  return c.json(options);
});

auth.post("/passkey/login/verify", async (c) => {
  const body = await c.req.json<{ response: any }>();
  const chal = await takeChallenge(c);
  if (!chal) return c.json({ error: "Desafio expirado. Tente de novo." }, 400);
  const pk = await c.var.db.select().from(passkeys).where(eq(passkeys.id, body.response.id)).get();
  if (!pk) return c.json({ error: "Passkey desconhecida (talvez removida)." }, 401);
  const { rpID, origin } = rp(c);
  const result = await verifyAuthenticationResponse({
    response: body.response,
    expectedChallenge: chal.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: pk.id,
      publicKey: b64url.decode(pk.publicKey),
      counter: pk.counter,
      transports: pk.transports ? JSON.parse(pk.transports) : undefined,
    },
  });
  if (!result.verified) return c.json({ error: "Passkey não confere." }, 401);
  await c.var.db.update(passkeys).set({ counter: result.authenticationInfo.newCounter }).where(eq(passkeys.id, pk.id));
  await startSession(c, pk.userId);
  return c.json({ ok: true });
});

auth.get("/passkeys", async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: "Entre primeiro." }, 401);
  const rows = await c.var.db
    .select({ id: passkeys.id, deviceName: passkeys.deviceName, createdAt: passkeys.createdAt })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .all();
  return c.json(rows);
});

auth.delete("/passkeys/:id", async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: "Entre primeiro." }, 401);
  await c.var.db.delete(passkeys).where(and(eq(passkeys.id, c.req.param("id")), eq(passkeys.userId, userId)));
  return c.json({ ok: true });
});
