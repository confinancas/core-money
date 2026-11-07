import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { limparCacheApiKey } from "../../../../src/worker/pluggy/api-key-cache";
import { createPluggyClient, type PluggyClientOptions } from "../../../../src/worker/pluggy/client";
import { PluggyError } from "../../../../src/worker/pluggy/errors";
import { lerFixture } from "../../../fixtures/pluggy/servidor";
import { type Chamada, fetchFalso, respostaJson } from "./fetch-falso";

const SEGREDO = "[TEST] segredo-do-cliente-fixture";
const CLIENT_ID = "[TEST] client-id-fixture";
const CACHE = "[TEST] conexao-1";
const ITEM = "00000000-0000-4000-8000-000000000001";
const CONTA = "00000000-0000-4000-8000-000000000011";
const MINUTO = 60 * 1000;

let agora = 0;

function criar(fetchFn: typeof fetch, extra: Partial<PluggyClientOptions> = {}) {
  return createPluggyClient({
    clientId: CLIENT_ID,
    clientSecret: SEGREDO,
    cacheKey: CACHE,
    fetch: fetchFn,
    now: () => agora,
    ...extra,
  });
}

const ehAuth = (c: Chamada) => c.url.endsWith("/auth");
const ehGet = (c: Chamada) => c.method === "GET";

beforeEach(() => {
  limparCacheApiKey();
  agora = 1_000_000;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("testKeys", () => {
  it("manda clientId e clientSecret no POST /auth e resolve", async () => {
    const f = fetchFalso(() => respostaJson(200, { apiKey: "[TEST] key-1" }));
    await expect(criar(f.fetch).testKeys()).resolves.toBeUndefined();
    expect(f.chamadas).toHaveLength(1);
    expect(f.chamadas[0]).toMatchObject({
      url: "https://api.pluggy.ai/auth",
      method: "POST",
      body: { clientId: CLIENT_ID, clientSecret: SEGREDO },
    });
    expect(f.chamadas[0]?.headers["content-type"]).toBe("application/json");
    expect(f.chamadas[0]?.headers["X-API-KEY"]).toBeUndefined();
  });

  it("chaves erradas: 401 CLIENT_KEYS_UNAUTHORIZED vira kind auth, sem segredo, sem laço", async () => {
    const f = fetchFalso(() =>
      respostaJson(401, {
        code: 401,
        message: "[TEST] não autorizado",
        codeDescription: "CLIENT_KEYS_UNAUTHORIZED",
      }),
    );
    const erro = await criar(f.fetch)
      .testKeys()
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(PluggyError);
    expect(erro).toMatchObject({ kind: "auth", code: "CLIENT_KEYS_UNAUTHORIZED", status: 401 });
    expect(String(erro)).not.toContain(SEGREDO);
    expect(f.chamadas.filter(ehAuth)).toHaveLength(1);
  });

  it("testKeys pede uma apiKey nova mesmo com uma em cache", async () => {
    let n = 0;
    const f = fetchFalso(() => respostaJson(200, { apiKey: `[TEST] key-${++n}` }));
    const cliente = criar(f.fetch);
    await cliente.getItem(ITEM);
    await cliente.testKeys();
    expect(f.chamadas.filter(ehAuth)).toHaveLength(2);
  });
});

describe("apiKey reaproveitada e vencimento", () => {
  it("duas chamadas seguidas geram um só POST /auth", async () => {
    const f = fetchFalso((c) =>
      ehAuth(c)
        ? respostaJson(200, { apiKey: "[TEST] key-1" })
        : respostaJson(200, lerFixture("item-meupluggy.json")),
    );
    const cliente = criar(f.fetch);
    await cliente.getItem(ITEM);
    await cliente.getItem(ITEM);
    expect(f.chamadas.filter(ehAuth)).toHaveLength(1);
  });

  it("a apiKey vale com 109 minutos e é renovada com 111", async () => {
    const f = fetchFalso((c) =>
      ehAuth(c)
        ? respostaJson(200, { apiKey: "[TEST] key-1" })
        : respostaJson(200, lerFixture("item-meupluggy.json")),
    );
    const cliente = criar(f.fetch);
    await cliente.getItem(ITEM);
    agora += 109 * MINUTO;
    await cliente.getItem(ITEM);
    expect(f.chamadas.filter(ehAuth)).toHaveLength(1);
    agora += 2 * MINUTO;
    await cliente.getItem(ITEM);
    expect(f.chamadas.filter(ehAuth)).toHaveLength(2);
  });

  it("401 em GET /accounts: apaga o cache, autentica e repete uma vez", async () => {
    let n = 0;
    const f = fetchFalso((c) => {
      if (ehAuth(c)) return respostaJson(200, { apiKey: `[TEST] key-${++n}` });
      if (c.headers["X-API-KEY"] === "[TEST] key-1")
        return respostaJson(401, { code: 401, codeDescription: "EXPIRED" });
      return respostaJson(200, lerFixture("accounts.json"));
    });
    const contas = await criar(f.fetch).listAccounts(ITEM);
    expect(contas).toHaveLength(3);
    expect(f.chamadas.map((c) => `${c.method} ${c.url.split("?")[0]}`)).toEqual([
      "POST https://api.pluggy.ai/auth",
      "GET https://api.pluggy.ai/accounts",
      "POST https://api.pluggy.ai/auth",
      "GET https://api.pluggy.ai/accounts",
    ]);
    expect(f.chamadas[3]?.headers["X-API-KEY"]).toBe("[TEST] key-2");
  });

  it("segundo 401 depois da reautenticação sai como kind auth, sem terceiro POST /auth", async () => {
    const f = fetchFalso((c) => {
      if (ehAuth(c)) return respostaJson(200, { apiKey: "[TEST] key" });
      return respostaJson(401, { code: 401, codeDescription: "EXPIRED" });
    });
    const erro = await criar(f.fetch)
      .listAccounts(ITEM)
      .catch((e: unknown) => e);
    expect(erro).toMatchObject({ kind: "auth", status: 401 });
    expect(f.chamadas.filter(ehAuth)).toHaveLength(2);
    expect(f.chamadas.filter(ehGet)).toHaveLength(2);
  });

  it("401 no próprio /auth nunca entra em laço", async () => {
    const f = fetchFalso(() => respostaJson(401, { codeDescription: "CLIENT_KEYS_UNAUTHORIZED" }));
    await criar(f.fetch)
      .getItem(ITEM)
      .catch(() => undefined);
    expect(f.chamadas.filter(ehAuth)).toHaveLength(1);
  });

  it("dois cacheKey diferentes não se misturam: cada um autentica", async () => {
    const f = fetchFalso((c) =>
      ehAuth(c)
        ? respostaJson(200, { apiKey: "[TEST] key" })
        : respostaJson(200, lerFixture("item-meupluggy.json")),
    );
    const a = criar(f.fetch, { cacheKey: "[TEST] conexao-a" });
    const b = criar(f.fetch, { cacheKey: "[TEST] conexao-b" });
    await a.getItem(ITEM);
    await b.getItem(ITEM);
    await a.getItem(ITEM);
    expect(f.chamadas.filter(ehAuth)).toHaveLength(2);
  });
});

describe("endpoints", () => {
  const autenticado = (corpo: unknown, status = 200) =>
    fetchFalso((c) =>
      ehAuth(c) ? respostaJson(200, { apiKey: "[TEST] key-1" }) : respostaJson(status, corpo),
    );

  it("getItem: GET /items/:id com X-API-KEY e content-type, e devolve o item", async () => {
    const f = autenticado(lerFixture("item-meupluggy.json"));
    const item = await criar(f.fetch).getItem(ITEM);
    expect(item.connector.name).toBe("MeuPluggy");
    expect(item.consentExpiresAt).toBe("2027-10-01T00:00:00.000Z");
    const chamada = f.chamadas[1];
    expect(chamada).toMatchObject({ url: `https://api.pluggy.ai/items/${ITEM}`, method: "GET" });
    expect(chamada?.headers["X-API-KEY"]).toBe("[TEST] key-1");
    expect(chamada?.headers["content-type"]).toBe("application/json");
  });

  it("getItem com id inexistente: not_found, e a mensagem usa o molde /items/:id, sem o id", async () => {
    const f = autenticado({ code: 404, codeDescription: "ITEM_NOT_FOUND" }, 404);
    const erro = await criar(f.fetch)
      .getItem("[TEST] id-inexistente")
      .catch((e: unknown) => e);
    expect(erro).toMatchObject({ kind: "not_found", status: 404, code: "ITEM_NOT_FOUND" });
    expect((erro as Error).message).toBe("pluggy GET /items/:id 404 ITEM_NOT_FOUND");
  });

  it("listAccounts: GET /accounts?itemId= e devolve as contas da primeira página", async () => {
    const f = autenticado(lerFixture("accounts.json"));
    const contas = await criar(f.fetch).listAccounts(ITEM);
    expect(contas.map((c) => `${c.type}/${c.subtype}`)).toEqual([
      "BANK/CHECKING_ACCOUNT",
      "BANK/SAVINGS_ACCOUNT",
      "CREDIT/CREDIT_CARD",
    ]);
    expect(f.chamadas[1]?.url).toBe(`https://api.pluggy.ai/accounts?itemId=${ITEM}`);
  });

  it("listAccounts segue totalPages (até 3 páginas)", async () => {
    const pagina = (n: number) => ({ page: n, total: 9, totalPages: 9, results: [] });
    const f = fetchFalso((c) =>
      ehAuth(c)
        ? respostaJson(200, { apiKey: "[TEST] key-1" })
        : respostaJson(200, pagina(Number(new URL(c.url).searchParams.get("page") ?? 1))),
    );
    await criar(f.fetch).listAccounts(ITEM);
    expect(f.chamadas.filter(ehGet)).toHaveLength(3);
    expect(f.chamadas[2]?.url).toContain("&page=2");
  });

  it("listTransactions, primeira página: accountId, dateFrom e dateTo, sem after", async () => {
    const f = autenticado(lerFixture("transactions-page1.json"));
    const pagina = await criar(f.fetch).listTransactions({
      accountId: CONTA,
      dateFrom: "2026-09-08",
      dateTo: "2026-11-07",
    });
    expect(f.chamadas[1]?.url).toBe(
      `https://api.pluggy.ai/v2/transactions?accountId=${CONTA}&dateFrom=2026-09-08&dateTo=2026-11-07`,
    );
    expect(f.chamadas[1]?.url).not.toContain("after");
    expect(pagina.results).toHaveLength(6);
    expect(pagina.next).toBe(`?accountId=${CONTA}&after=QUJD`);
  });

  it("listTransactions com next: anexa como veio, sem codificar de novo", async () => {
    const f = autenticado(lerFixture("transactions-page2.json"));
    const pagina = await criar(f.fetch).listTransactions({ next: "?accountId=a1&after=QUJD" });
    expect(f.chamadas[1]?.url).toBe("https://api.pluggy.ai/v2/transactions?accountId=a1&after=QUJD");
    expect(pagina.next).toBeNull();
  });

  it("listTransactions com next que não começa com ? é recusado antes de chamar a rede", async () => {
    const f = autenticado(lerFixture("transactions-page2.json"));
    const erro = await criar(f.fetch)
      .listTransactions({ next: "accountId=a1" })
      .catch((e: unknown) => e);
    expect(erro).toMatchObject({ kind: "bad_request", code: "NEXT_INVALIDO" });
    expect(f.chamadas).toHaveLength(0);
  });

  it("listBills com totalPages 2 faz 2 chamadas e junta os resultados", async () => {
    const f = fetchFalso((c) => {
      if (ehAuth(c)) return respostaJson(200, { apiKey: "[TEST] key-1" });
      const pagina = Number(new URL(c.url).searchParams.get("page"));
      return respostaJson(200, {
        page: pagina,
        total: 2,
        totalPages: 2,
        results: [{ id: `[TEST] fatura-${pagina}` }],
      });
    });
    const faturas = await criar(f.fetch).listBills(CONTA);
    expect(faturas).toHaveLength(2);
    expect(f.chamadas[1]?.url).toBe(`https://api.pluggy.ai/bills?accountId=${CONTA}&pageSize=500&page=1`);
    expect(f.chamadas[2]?.url).toBe(`https://api.pluggy.ai/bills?accountId=${CONTA}&pageSize=500&page=2`);
  });

  it("listBills com totalPages 9 para em 3 páginas", async () => {
    const f = fetchFalso((c) => {
      if (ehAuth(c)) return respostaJson(200, { apiKey: "[TEST] key-1" });
      return respostaJson(200, { page: 1, total: 9, totalPages: 9, results: [] });
    });
    await criar(f.fetch).listBills(CONTA);
    expect(f.chamadas.filter(ehGet)).toHaveLength(3);
  });

  it("getIdentity: 404 vira null", async () => {
    const f = autenticado({ code: 404, codeDescription: "IDENTITY_NOT_FOUND" }, 404);
    await expect(criar(f.fetch).getIdentity(ITEM)).resolves.toBeNull();
    expect(f.chamadas[1]?.url).toBe(`https://api.pluggy.ai/identity?itemId=${ITEM}`);
  });

  it("getIdentity: 403 não vira null, sai como forbidden", async () => {
    const f = autenticado({ code: 403, codeDescription: "[TEST] SEM_PERMISSAO" }, 403);
    const erro = await criar(f.fetch)
      .getIdentity(ITEM)
      .catch((e: unknown) => e);
    expect(erro).toMatchObject({ kind: "forbidden", status: 403 });
  });

  it("getIdentity: 200 devolve o objeto", async () => {
    const f = autenticado(lerFixture("identity.json"));
    const identidade = await criar(f.fetch).getIdentity(ITEM);
    expect(identidade?.documentType).toBe("CPF");
  });

  it("listInvestments: 1 página, pageSize=500, devolve os results", async () => {
    const f = autenticado(lerFixture("investments.json"));
    const investimentos = await criar(f.fetch).listInvestments(ITEM);
    expect(investimentos).toHaveLength(2);
    expect(f.chamadas.filter(ehGet)).toHaveLength(1);
    expect(f.chamadas[1]?.url).toBe(`https://api.pluggy.ai/investments?itemId=${ITEM}&pageSize=500`);
  });

  it("listInvestments: uma chamada só, mesmo com totalPages maior que 1", async () => {
    const investimentos = { ...(lerFixture("investments.json") as Record<string, unknown>), totalPages: 3 };
    const f = autenticado(investimentos);
    const resultado = await criar(f.fetch).listInvestments(ITEM);
    expect(resultado).toHaveLength(2);
    expect(f.chamadas.filter(ehGet)).toHaveLength(1);
  });

  it("não é usado nenhum GET /transactions nem PATCH /items", async () => {
    const f = autenticado(lerFixture("transactions-page1.json"));
    await criar(f.fetch).listTransactions({ accountId: CONTA, dateFrom: "2026-09-08", dateTo: "2026-11-07" });
    expect(f.chamadas.every((c) => new URL(c.url).pathname !== "/transactions")).toBe(true);
    expect(f.chamadas.some((c) => new URL(c.url).pathname === "/v2/transactions")).toBe(true);
    expect(f.chamadas.every((c) => c.method !== "PATCH")).toBe(true);
  });

  it("base URL com barra final não gera barra dupla", async () => {
    const f = autenticado(lerFixture("accounts.json"));
    await criar(f.fetch, { baseUrl: "http://127.0.0.1:9999/" }).listAccounts(ITEM);
    expect(f.chamadas[1]?.url).toBe(`http://127.0.0.1:9999/accounts?itemId=${ITEM}`);
  });

  it("AbortSignal.timeout em toda chamada, inclusive o /auth, com 20 s por padrão", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    const f = autenticado(lerFixture("item-meupluggy.json"));
    await criar(f.fetch).getItem(ITEM);
    expect(f.chamadas.every((c) => c.signal instanceof AbortSignal)).toBe(true);
    expect(spy).toHaveBeenCalledWith(20_000);
  });

  it("timeoutMs customizado chega ao AbortSignal.timeout", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    const f = autenticado(lerFixture("item-meupluggy.json"));
    await criar(f.fetch, { timeoutMs: 5000 }).getItem(ITEM);
    expect(spy).toHaveBeenCalledWith(5000);
  });
});

describe("falhas temporárias e limite de uso", () => {
  const autenticado = (resposta: () => Response | Promise<Response>) =>
    fetchFalso((c) => (ehAuth(c) ? respostaJson(200, { apiKey: "[TEST] key-1" }) : resposta()));

  it("429 com Retry-After 60: rate_limited e retryAfterSec 60", async () => {
    const f = autenticado(() =>
      respostaJson(429, { codeDescription: "RATE_LIMIT" }, { "retry-after": "60" }),
    );
    const erro = await criar(f.fetch)
      .listAccounts("x")
      .catch((e: unknown) => e);
    expect(erro).toMatchObject({ kind: "rate_limited", retryAfterSec: 60 });
  });

  it("502, falha de rede, tempo esgotado e corpo que não é JSON: temporary nos quatro", async () => {
    const casos: [string, () => Response | Promise<Response>, string][] = [
      ["502", () => respostaJson(502, { codeDescription: "BAD_GATEWAY" }), "BAD_GATEWAY"],
      ["rede", () => Promise.reject(new TypeError("fetch failed")), "NETWORK"],
      ["tempo esgotado", () => Promise.reject(new DOMException("tempo", "TimeoutError")), "TIMEOUT"],
      ["JSON inválido", () => new Response("<html>", { status: 200 }), "INVALID_JSON"],
    ];
    for (const [, resposta, code] of casos) {
      const f = autenticado(resposta);
      const erro = await criar(f.fetch)
        .getItem(ITEM)
        .catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(PluggyError);
      expect(erro).toMatchObject({ kind: "temporary", code });
    }
  });

  it("getIdentity não engole 5xx: vira temporary", async () => {
    const f = autenticado(() => respostaJson(503, {}));
    const erro = await criar(f.fetch)
      .getIdentity(ITEM)
      .catch((e: unknown) => e);
    expect(erro).toMatchObject({ kind: "temporary", status: 503 });
  });
});

describe("só o 401 repete a chamada", () => {
  it.each([403, 404, 500, 503])("status %i faz um GET só, sem reautenticar", async (status) => {
    const f = fetchFalso((c) =>
      ehAuth(c)
        ? respostaJson(200, { apiKey: "[TEST] key-1" })
        : respostaJson(status, { codeDescription: "[TEST] CODIGO_DE_TESTE" }),
    );
    const erro = await criar(f.fetch)
      .getItem(ITEM)
      .catch((e: unknown) => e);
    expect(erro).toMatchObject({ status });
    expect(f.chamadas.filter(ehGet)).toHaveLength(1);
    expect(f.chamadas.filter(ehAuth)).toHaveLength(1);
  });
});

describe("nada vaza", () => {
  it("nenhuma mensagem logada contém segredo, apiKey ou texto do corpo", async () => {
    const espiao = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const f = fetchFalso((c) => {
      if (ehAuth(c)) return respostaJson(200, { apiKey: "[TEST] apikey-secreta" });
      return respostaJson(403, {
        code: 403,
        message: "[TEST] texto-do-corpo",
        codeDescription: "FORBIDDEN_X",
      });
    });
    await criar(f.fetch)
      .getItem(ITEM)
      .catch(() => undefined);
    const textos = espiao.mock.calls.map((args) => args.map(String).join(" "));
    expect(textos).toHaveLength(1);
    for (const texto of textos) {
      expect(texto).not.toContain(SEGREDO);
      expect(texto).not.toContain("apikey-secreta");
      expect(texto).not.toContain("texto-do-corpo");
    }
  });
});
