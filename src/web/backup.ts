// Backup no navegador (ADR-009): busca o banco em páginas, monta o .sql, cifra com senha.
// Restaurar: decifra, confere a soma de verificação ANTES de gravar, e envia em páginas.

export type Note = { id: number; text: string; createdAt: number };

const MAGIC = new TextEncoder().encode("MMBK1");
const PBKDF2_ITERATIONS = 600_000;
const RESTORE_CHUNK = 200;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
  return res.json();
}

async function fetchAllNotes(onPage: (n: number) => void): Promise<Note[]> {
  const all: Note[] = [];
  let cursor: number | null = 0;
  while (cursor !== null) {
    const page: { rows: Note[]; nextCursor: number | null } = await api(`/backup/notes?cursor=${cursor}`);
    all.push(...page.rows);
    onPage(all.length);
    cursor = page.nextCursor;
  }
  return all;
}

async function checksum(rows: Note[]) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(rows)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

function toSql(rows: Note[], sum: string) {
  const header = `-- matrimoney-backup v1\n-- schema 1\n-- rows ${rows.length} sha256 ${sum}\n`;
  const lines = rows.map(
    (r) => `INSERT INTO notes (id, text, created_at) VALUES (${r.id}, ${sqlString(r.text)}, ${r.createdAt});`,
  );
  return header + lines.join("\n") + "\n";
}

function fromSql(sql: string) {
  const head = sql.match(/^-- rows (\d+) sha256 ([0-9a-f]{64})$/m);
  if (!sql.startsWith("-- matrimoney-backup v1") || !head) throw new Error("Arquivo não é um backup do Matrimoney.");
  const rows: Note[] = [];
  const re = /INSERT INTO notes \(id, text, created_at\) VALUES \((\d+), '((?:[^']|'')*)', (\d+)\);/g;
  for (const m of sql.matchAll(re)) rows.push({ id: Number(m[1]), text: m[2].replace(/''/g, "'"), createdAt: Number(m[3]) });
  return { rows, expectedCount: Number(head[1]), expectedSum: head[2] };
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function exportBackup(password: string, progress: (msg: string) => void) {
  const rows = await fetchAllNotes((n) => progress(`Lendo… ${n} linhas`));
  const sum = await checksum(rows);
  progress("Cifrando…");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(toSql(rows, sum))));
  const blob = new Blob([MAGIC, salt, iv, cipher], { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `matrimoney-backup-${new Date().toISOString().slice(0, 10)}.sql.enc`;
  a.click();
  URL.revokeObjectURL(a.href);
  return { rows: rows.length, sum };
}

export async function restoreBackup(file: File, password: string, progress: (msg: string) => void) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "MMBK1") throw new Error("Arquivo não é um backup do Matrimoney.");
  const salt = bytes.slice(5, 21);
  const iv = bytes.slice(21, 33);
  progress("Decifrando…");
  let sql: string;
  try {
    const key = await deriveKey(password, salt);
    sql = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, bytes.slice(33)));
  } catch {
    throw new Error("Senha errada ou arquivo corrompido. Nada foi gravado.");
  }
  const { rows, expectedCount, expectedSum } = fromSql(sql);
  if (rows.length !== expectedCount || (await checksum(rows)) !== expectedSum) {
    throw new Error("O conteúdo não bate com a soma de verificação. Nada foi gravado.");
  }
  progress("Apagando o banco atual…");
  await api("/notes", { method: "DELETE" });
  for (let i = 0; i < rows.length; i += RESTORE_CHUNK) {
    await api("/restore/notes", { method: "POST", body: JSON.stringify({ rows: rows.slice(i, i + RESTORE_CHUNK) }) });
    progress(`Restaurando… ${Math.min(i + RESTORE_CHUNK, rows.length)} de ${rows.length}`);
  }
  progress("Conferindo…");
  const after = await fetchAllNotes(() => {});
  const ok = after.length === expectedCount && (await checksum(after)) === expectedSum;
  return { rows: after.length, ok };
}
