// Tela única do spike: cada seção exercita uma peça do desenho (TASK-0001).
import { useEffect, useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { exportBackup, restoreBackup, type Note } from "./backup";

type Me = { userId: string | null; setupOpen: boolean };
type Passkey = { id: string; deviceName: string; createdAt: number };
type Usage = { day: string; requests: number; rowsRead: number; rowsWritten: number; sizeBytes: number };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
  return res.json();
}

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Aparelho";
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [msg, setMsg] = useState("");
  const refreshMe = () => api<Me>("/me").then(setMe).catch((e) => setMsg(e.message));
  useEffect(() => void refreshMe(), []);

  const run = (fn: () => Promise<unknown>) => () => fn().catch((e: Error) => setMsg(e.message));

  const register = run(async () => {
    const options = await api<any>("/passkey/register/options", { method: "POST" });
    const response = await startRegistration({ optionsJSON: options });
    await api("/passkey/register/verify", { method: "POST", body: JSON.stringify({ response, deviceName: deviceName() }) });
    setMsg("Passkey cadastrada neste aparelho.");
    await refreshMe();
  });

  const login = run(async () => {
    const options = await api<any>("/passkey/login/options", { method: "POST" });
    const response = await startAuthentication({ optionsJSON: options });
    await api("/passkey/login/verify", { method: "POST", body: JSON.stringify({ response }) });
    setMsg("Entrou.");
    await refreshMe();
  });

  const logout = run(async () => {
    await api("/logout", { method: "POST" });
    await refreshMe();
  });

  return (
    <main>
      <h1>Matrimoney · spike</h1>
      <p className="muted">Ambiente de teste da TASK-0001. Só dados fictícios.</p>
      {msg && <p>{msg}</p>}

      <section>
        <h2>Entrar</h2>
        {!me ? (
          <p className="muted">Carregando…</p>
        ) : me.userId ? (
          <>
            <p>Você está dentro.</p>
            <button onClick={register}>Adicionar este aparelho</button>
            <button onClick={logout}>Sair</button>
            <Passkeys onError={setMsg} />
          </>
        ) : (
          <>
            {me.setupOpen && <button onClick={register}>Criar a primeira passkey</button>}
            <button onClick={login}>Entrar com passkey</button>
          </>
        )}
      </section>

      {me?.userId && (
        <>
          <Notes onError={setMsg} />
          <Chat />
          <Backup />
        </>
      )}
      <UsagePanel />
    </main>
  );
}

function Passkeys({ onError }: { onError: (m: string) => void }) {
  const [list, setList] = useState<Passkey[]>([]);
  const load = () => api<Passkey[]>("/passkeys").then(setList).catch((e) => onError(e.message));
  useEffect(() => void load(), []);
  const remove = (id: string) => api(`/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" }).then(load).catch((e) => onError(e.message));
  return (
    <>
      <p className="muted">Aparelhos com passkey:</p>
      <ul>
        {list.map((p) => (
          <li key={p.id}>
            {p.deviceName} · {new Date(p.createdAt).toLocaleString("pt-BR")}{" "}
            <button className="danger" onClick={() => remove(p.id)}>remover</button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Notes({ onError }: { onError: (m: string) => void }) {
  const [data, setData] = useState<{ total: number; latest: Note[] }>({ total: 0, latest: [] });
  const [text, setText] = useState("");
  const [seeding, setSeeding] = useState("");
  const load = () => api<typeof data>("/notes").then(setData).catch((e) => onError(e.message));
  useEffect(() => void load(), []);
  const add = () => api("/notes", { method: "POST", body: JSON.stringify({ text }) }).then(() => { setText(""); load(); });
  const seed = async () => {
    for (let i = 0; i < 10; i++) {
      await api("/notes/seed", { method: "POST", body: JSON.stringify({ count: 200 }) });
      setSeeding(`${(i + 1) * 200} de 2000`);
    }
    load();
  };
  return (
    <section>
      <h2>Notas (D1)</h2>
      <p>{data.total} notas no banco.</p>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Texto da nota" />
      <button onClick={add}>Gravar</button>
      <button onClick={() => seed().catch((e) => onError(e.message))}>Semear 2.000</button>
      {seeding && <span className="muted"> {seeding}</span>}
      <ul>{data.latest.map((n) => <li key={n.id}>#{n.id} {n.text}</li>)}</ul>
    </section>
  );
}

function Chat() {
  const [prompt, setPrompt] = useState("Em três frases, por que um casal deveria acompanhar os gastos juntos?");
  const [out, setOut] = useState("");
  const send = async () => {
    setOut("");
    const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }) });
    if (!res.ok || !res.body) return setOut(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      setOut((o) => o + decoder.decode(value, { stream: true }));
    }
  };
  // Modo direto: o Worker repassa o SSE da Anthropic e o navegador extrai o texto.
  const sendRaw = async () => {
    setOut("");
    const res = await fetch("/api/chat-raw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }) });
    if (!res.ok || !res.body) return setOut(`HTTP ${res.status}: ${await res.text()}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        const data = event.split("\n").find((line) => line.startsWith("data: "));
        if (!data) continue;
        const payload = JSON.parse(data.slice(6));
        if (payload.type === "content_block_delta" && payload.delta?.type === "text_delta") setOut((o) => o + payload.delta.text);
        if (payload.type === "message_delta" && payload.delta?.stop_reason === "refusal") setOut((o) => o + "\n[o modelo recusou responder]");
        if (payload.type === "error") setOut((o) => o + `\n[erro: ${payload.error?.message}]`);
      }
    }
  };
  return (
    <section>
      <h2>IA em streaming</h2>
      <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <button onClick={send}>Perguntar</button>
      <button onClick={sendRaw}>Perguntar (modo direto)</button>
      <p className="out">{out}</p>
    </section>
  );
}

function Backup() {
  const [password, setPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const doExport = () =>
    exportBackup(password, setStatus)
      .then((r) => setStatus(`Backup baixado: ${r.rows} linhas.`))
      .catch((e) => setStatus(e.message));
  // Confirmação dentro da tela: o confirm() do navegador pode ser bloqueado em silêncio em apps instalados.
  const [confirming, setConfirming] = useState(false);
  const askRestore = () => {
    setStatus(`Botão clicado (${new Date().toLocaleTimeString("pt-BR")}).`);
    if (!file) return setStatus("Botão clicado, mas nenhum arquivo foi escolhido.");
    if (!password) return setStatus("Botão clicado, mas falta a senha do backup.");
    setConfirming(true);
  };
  const doRestore = async () => {
    setConfirming(false);
    setStatus("Confirmado. Lendo o arquivo…");
    try {
      const r = await restoreBackup(file!, password, setStatus);
      setStatus(r.ok ? `Restaurado e conferido: ${r.rows} linhas.` : `Restaurado, mas a conferência falhou (${r.rows} linhas).`);
    } catch (e) {
      setStatus(`Erro: ${(e as Error)?.message ?? String(e)}`);
    }
  };
  return (
    <section>
      <h2>Backup .sql</h2>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha do backup" />
      <button onClick={doExport}>Exportar</button>
      {/* sem filtro de extensão: celulares às vezes bloqueiam extensões desconhecidas como .enc */}
      <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <p className="muted">{file ? `Arquivo escolhido: ${file.name}` : "Nenhum arquivo escolhido."}</p>
      <button className="danger" onClick={askRestore}>Restaurar</button>
      {confirming && (
        <p>
          Restaurar apaga as notas atuais e põe as do arquivo.{" "}
          <button className="danger" onClick={doRestore}>Sim, restaurar</button>
          <button onClick={() => { setConfirming(false); setStatus("Restauração cancelada."); }}>Cancelar</button>
        </p>
      )}
      {status && <p><strong>{status}</strong></p>}
      <p className="muted">Versão da tela: restauração v3</p>
    </section>
  );
}

function UsagePanel() {
  const [rows, setRows] = useState<Usage[]>([]);
  useEffect(() => void api<Usage[]>("/usage").then(setRows).catch(() => {}), []);
  const today = rows[0];
  return (
    <section>
      <h2>Uso medido pelo app (hoje, UTC)</h2>
      {today ? (
        <p className="muted">
          {today.requests} requisições · {today.rowsRead} linhas lidas · {today.rowsWritten} escritas · banco com{" "}
          {(today.sizeBytes / 1024).toFixed(0)} KB
        </p>
      ) : (
        <p className="muted">Sem dados ainda.</p>
      )}
    </section>
  );
}
