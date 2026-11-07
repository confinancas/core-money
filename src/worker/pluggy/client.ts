// Cliente da API do Pluggy, só com fetch. Só leitura: o único POST é o /auth.
// Nenhuma retentativa além da que repete a chamada depois de um 401 com apiKey nova: quem repete é a fila (TASK-0204).

import { apagarApiKey, guardarApiKey, lerApiKey } from "./api-key-cache";
import { classifyPluggyResponse, PluggyError } from "./errors";
import type {
  PluggyAccount,
  PluggyBill,
  PluggyIdentity,
  PluggyInvestment,
  PluggyItem,
  PluggyPage,
  PluggyTransaction,
  PluggyTransactionsPage,
} from "./types";

export const PLUGGY_BASE_URL_PADRAO = "https://api.pluggy.ai";

const TIMEOUT_PADRAO_MS = 20_000;
const TAMANHO_DE_PAGINA = 500;
// Teto de páginas das listas paginadas: o plano gratuito limita as chamadas externas por execução.
const MAX_PAGINAS = 3;

export type PluggyClientOptions = {
  clientId: string;
  clientSecret: string;
  // Chave do cache da apiKey (o id da conexão). Dois cacheKey diferentes não se misturam.
  cacheKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

// Primeira página por datas (AAAA-MM-DD) ou página seguinte pelo next da resposta anterior.
export type ParamsTransacoes = { accountId: string; dateFrom: string; dateTo: string } | { next: string };

export type PluggyClient = {
  testKeys(): Promise<void>;
  getItem(itemId: string): Promise<PluggyItem>;
  listAccounts(itemId: string): Promise<PluggyAccount[]>;
  listTransactions(params: ParamsTransacoes): Promise<PluggyTransactionsPage>;
  listBills(accountId: string): Promise<PluggyBill[]>;
  getIdentity(itemId: string): Promise<PluggyIdentity | null>;
  listInvestments(itemId: string): Promise<PluggyInvestment[]>;
};

type Metodo = "GET" | "POST";

const enc = (valor: string): string => encodeURIComponent(valor);

function nomeDoErro(erro: unknown): string {
  if (typeof erro === "object" && erro !== null && "name" in erro && typeof erro.name === "string") {
    return erro.name;
  }
  return "";
}

function ehTempoEsgotado(erro: unknown): boolean {
  const nome = nomeDoErro(erro);
  return nome === "TimeoutError" || nome === "AbortError";
}

function limitePaginas(totalPages: unknown): number {
  const total =
    typeof totalPages === "number" && Number.isInteger(totalPages) && totalPages >= 1 ? totalPages : 1;
  return Math.min(total, MAX_PAGINAS);
}

function exigirLista<T>(valor: unknown, rota: string): T[] {
  if (!Array.isArray(valor)) {
    throw new PluggyError({ kind: "temporary", status: 200, code: "RESPOSTA_INVALIDA", metodo: "GET", rota });
  }
  return valor as T[];
}

function extrairApiKey(corpo: unknown): string | null {
  if (typeof corpo !== "object" || corpo === null) return null;
  const apiKey = (corpo as { apiKey?: unknown }).apiKey;
  return typeof apiKey === "string" && apiKey !== "" ? apiKey : null;
}

function caminhoDeTransacoes(params: ParamsTransacoes): string {
  if ("next" in params) {
    // next é anexado como veio: já é uma query string codificada. Sem "?" na frente, a URL estaria errada.
    if (!params.next.startsWith("?")) {
      throw new PluggyError({
        kind: "bad_request",
        status: 0,
        code: "NEXT_INVALIDO",
        metodo: "GET",
        rota: "/v2/transactions",
      });
    }
    return `/v2/transactions${params.next}`;
  }
  return `/v2/transactions?accountId=${enc(params.accountId)}&dateFrom=${enc(params.dateFrom)}&dateTo=${enc(params.dateTo)}`;
}

export function createPluggyClient(opcoes: PluggyClientOptions): PluggyClient {
  const base = (opcoes.baseUrl ?? PLUGGY_BASE_URL_PADRAO).replace(/\/+$/, "");
  const fetchImpl: typeof fetch = opcoes.fetch ?? ((entrada, init) => fetch(entrada, init));
  const agora = opcoes.now ?? (() => Date.now());
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS;
  const { clientId, clientSecret, cacheKey } = opcoes;

  // Uma chamada HTTP. Não loga nem repete: quem decide é o chamador.
  async function enviar(
    metodo: Metodo,
    rota: string,
    caminho: string,
    apiKey: string | null,
    corpo?: unknown,
  ): Promise<unknown> {
    const cabecalhos: Record<string, string> = { "content-type": "application/json" };
    if (apiKey !== null) cabecalhos["X-API-KEY"] = apiKey;

    let resposta: Response;
    try {
      resposta = await fetchImpl(`${base}${caminho}`, {
        method: metodo,
        headers: cabecalhos,
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (erro) {
      const code = ehTempoEsgotado(erro) ? "TIMEOUT" : "NETWORK";
      throw new PluggyError({ kind: "temporary", status: 0, code, metodo, rota });
    }

    if (!resposta.ok) {
      const corpoErro: unknown = await resposta.json().catch(() => undefined);
      throw classifyPluggyResponse({
        status: resposta.status,
        corpo: corpoErro,
        metodo,
        rota,
        retryAfter: resposta.headers.get("retry-after"),
      });
    }

    try {
      return await resposta.json();
    } catch (erro) {
      const code = ehTempoEsgotado(erro) ? "TIMEOUT" : "INVALID_JSON";
      throw new PluggyError({ kind: "temporary", status: resposta.status, code, metodo, rota });
    }
  }

  // Autentica e guarda a apiKey no cache. Um 401 aqui sai direto como kind auth: nunca repete.
  async function autenticar(): Promise<string> {
    const corpo = await enviar("POST", "/auth", "/auth", null, { clientId, clientSecret });
    const apiKey = extrairApiKey(corpo);
    if (apiKey === null) {
      throw new PluggyError({
        kind: "temporary",
        status: 200,
        code: "RESPOSTA_INVALIDA",
        metodo: "POST",
        rota: "/auth",
      });
    }
    guardarApiKey(cacheKey, apiKey, agora());
    return apiKey;
  }

  async function apiKeyVigente(): Promise<string> {
    return lerApiKey(cacheKey, agora()) ?? (await autenticar());
  }

  // GET com a apiKey do cache. Um 401 apaga o cache, autentica de novo e repete uma vez; outro 401 sai como auth.
  async function pedir<T>(rota: string, caminho: string): Promise<T> {
    const apiKey = await apiKeyVigente();
    try {
      return (await enviar("GET", rota, caminho, apiKey)) as T;
    } catch (erro) {
      if (!(erro instanceof PluggyError) || erro.status !== 401) throw erro;
    }
    apagarApiKey(cacheKey);
    const nova = await autenticar();
    return (await enviar("GET", rota, caminho, nova)) as T;
  }

  // Lista paginada: segue totalPages, no máximo MAX_PAGINAS páginas.
  async function paginado<T>(rota: string, montar: (pagina: number) => string): Promise<T[]> {
    const todas: T[] = [];
    let pagina = 1;
    let limite = 1;
    do {
      const resposta = await pedir<PluggyPage<T>>(rota, montar(pagina));
      todas.push(...exigirLista<T>(resposta?.results, rota));
      limite = limitePaginas(resposta?.totalPages);
      pagina += 1;
    } while (pagina <= limite);
    return todas;
  }

  // Loga só a mensagem do erro (sem segredo, sem corpo) quando a operação falha de vez.
  async function executar<T>(operacao: () => Promise<T>): Promise<T> {
    try {
      return await operacao();
    } catch (erro) {
      if (erro instanceof PluggyError) console.error(erro.message);
      throw erro;
    }
  }

  return {
    testKeys: () =>
      executar(async () => {
        // Sempre pede uma apiKey nova; não olha o cache.
        await autenticar();
      }),

    getItem: (itemId) => executar(() => pedir<PluggyItem>("/items/:id", `/items/${enc(itemId)}`)),

    listAccounts: (itemId) =>
      executar(() =>
        paginado<PluggyAccount>(
          "/accounts",
          (pagina) => `/accounts?itemId=${enc(itemId)}${pagina > 1 ? `&page=${pagina}` : ""}`,
        ),
      ),

    listTransactions: (params) =>
      executar(async () => {
        const resposta = await pedir<PluggyTransactionsPage>("/v2/transactions", caminhoDeTransacoes(params));
        return {
          results: exigirLista<PluggyTransaction>(resposta?.results, "/v2/transactions"),
          next: resposta?.next ?? null,
        };
      }),

    listBills: (accountId) =>
      executar(() =>
        paginado<PluggyBill>(
          "/bills",
          (pagina) => `/bills?accountId=${enc(accountId)}&pageSize=${TAMANHO_DE_PAGINA}&page=${pagina}`,
        ),
      ),

    // 404 aqui quer dizer "sem identidade": devolve null em vez de erro.
    getIdentity: (itemId) =>
      executar(async () => {
        try {
          return await pedir<PluggyIdentity>("/identity", `/identity?itemId=${enc(itemId)}`);
        } catch (erro) {
          if (erro instanceof PluggyError && erro.status === 404) return null;
          throw erro;
        }
      }),

    listInvestments: (itemId) =>
      executar(async () => {
        const resposta = await pedir<PluggyPage<PluggyInvestment>>(
          "/investments",
          `/investments?itemId=${enc(itemId)}&pageSize=${TAMANHO_DE_PAGINA}`,
        );
        return exigirLista<PluggyInvestment>(resposta?.results, "/investments");
      }),
  };
}
