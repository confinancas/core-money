// Servidor local que responde como o Pluggy com as fixtures. Serve aos testes e à sonda com PLUGGY_BASE_URL.
// Uso manual: npx tsx tests/fixtures/pluggy/servidor.ts  (imprime a URL e fica no ar até Ctrl+C).

import { readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));

export const ITEM_ID = "00000000-0000-4000-8000-000000000001";

export function lerFixture(nome: string): unknown {
  return JSON.parse(readFileSync(join(DIR, nome), "utf8")) as unknown;
}

export type ServidorFixtures = { url: string; fechar: () => Promise<void> };

// substituicoes: fixtures trocadas por outras (nome do arquivo → objeto). Serve aos testes de campo nulo.
export function iniciarServidorFixtures(
  substituicoes: Record<string, unknown> = {},
): Promise<ServidorFixtures> {
  const apiKey = (lerFixture("auth.json") as { apiKey: string }).apiKey;
  const ler = (nome: string): unknown => (nome in substituicoes ? substituicoes[nome] : lerFixture(nome));
  const servidor = createServer((req, res) => tratar(req, res, apiKey, ler));
  return new Promise((resolver, rejeitar) => {
    servidor.once("error", rejeitar);
    servidor.listen(0, "127.0.0.1", () => {
      const { port } = servidor.address() as AddressInfo;
      resolver({
        url: `http://127.0.0.1:${port}`,
        fechar: () =>
          new Promise<void>((ok) => {
            servidor.close(() => ok());
          }),
      });
    });
  });
}

function enviarJson(res: ServerResponse, status: number, corpo: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(corpo));
}

const ROTAS_SIMPLES: Record<string, string | undefined> = {
  "/accounts": "accounts.json",
  "/bills": "bills.json",
  "/identity": "identity.json",
  "/investments": "investments.json",
};

function tratar(
  req: IncomingMessage,
  res: ServerResponse,
  apiKeyValida: string,
  ler: (nome: string) => unknown,
): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const caminho = url.pathname;

  if (req.method === "POST" && caminho === "/auth") {
    req.resume();
    enviarJson(res, 200, ler("auth.json"));
    return;
  }

  if (req.headers["x-api-key"] !== apiKeyValida) {
    enviarJson(res, 401, {
      code: 401,
      message: "[TEST] chave não autorizada",
      codeDescription: "CLIENT_KEYS_UNAUTHORIZED",
    });
    return;
  }

  if (req.method !== "GET") {
    enviarJson(res, 405, {
      code: 405,
      message: "[TEST] método não aceito",
      codeDescription: "METHOD_NOT_ALLOWED",
    });
    return;
  }

  if (caminho.startsWith("/items/")) {
    if (caminho === `/items/${ITEM_ID}`) {
      enviarJson(res, 200, ler("item-meupluggy.json"));
    } else {
      enviarJson(res, 404, {
        code: 404,
        message: "[TEST] item não encontrado",
        codeDescription: "ITEM_NOT_FOUND",
      });
    }
    return;
  }

  // Com after, é a segunda página de transações; sem after, a primeira (que traz next).
  const arquivo =
    caminho === "/v2/transactions"
      ? url.searchParams.has("after")
        ? "transactions-page2.json"
        : "transactions-page1.json"
      : ROTAS_SIMPLES[caminho];

  if (arquivo !== undefined) {
    enviarJson(res, 200, ler(arquivo));
    return;
  }

  enviarJson(res, 404, { code: 404, message: "[TEST] rota não existe", codeDescription: "ROUTE_NOT_FOUND" });
}

// Chaves que são vocabulário do Pluggy (tipos, status, códigos) ou do conector: aparecem na saída por definição.
const CHAVES_DE_VOCABULARIO = new Set([
  "type",
  "subtype",
  "status",
  "executionStatus",
  "operationType",
  "paymentMethod",
  "products",
  "currencyCode",
  "category",
  "categoryId",
  "documentType",
  "code",
  "codeDescription",
]);

// Valores das fixtures que não podem aparecer numa saída: ids, nomes, descrições, documentos, números e valores.
// Ignora o vocabulário do Pluggy e o bloco connector (nome público do conector, MeuPluggy).
export function valoresSensiveis(): string[] {
  const valores = new Set<string>();
  const recolher = (valor: unknown, chave: string): void => {
    if (typeof valor === "string") {
      if (!CHAVES_DE_VOCABULARIO.has(chave) && valor.length >= 4) valores.add(valor);
      return;
    }
    if (typeof valor === "number") {
      if (Math.abs(valor) >= 100) valores.add(String(valor));
      return;
    }
    if (Array.isArray(valor)) {
      for (const item of valor) recolher(item, chave);
      return;
    }
    if (typeof valor === "object" && valor !== null) {
      for (const [chaveFilha, filho] of Object.entries(valor)) {
        if (chaveFilha === "connector") continue;
        recolher(filho, chaveFilha);
      }
    }
  };
  for (const nome of readdirSync(DIR)) {
    if (nome.endsWith(".json")) recolher(lerFixture(nome), "");
  }
  return [...valores];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const servidor = await iniciarServidorFixtures();
  process.stdout.write(`${servidor.url}\n`);
}
