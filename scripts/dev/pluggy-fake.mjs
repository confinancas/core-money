#!/usr/bin/env node
// Meu Pluggy falso para o E2E (TASK-0203): o Worker de teste aponta PLUGGY_BASE_URL para cá, e nenhuma chamada sai
// para o Pluggy de verdade. Os dados são [TEST] e seguem a forma das fixtures da TASK-0201. Só fala o que o app
// usa: /auth, /items/:id, /accounts, /identity. O resto responde 404. Porta: PLUGGY_FAKE_PORTA (base + 3 do bloco).
import { createServer } from "node:http";

// Sem porta fixa: quem sobe o falso (scripts/dev/e2e-server.mjs) passa a porta base + 3 do bloco de portas do E2E.
const PORTA = Number(process.env.PLUGGY_FAKE_PORTA);
if (!Number.isInteger(PORTA) || PORTA < 1024 || PORTA > 65535) {
  throw new Error("PLUGGY_FAKE_PORTA precisa ser uma porta (inteiro de 1024 a 65535).");
}

// Par de chaves que o falso aceita, e a apiKey que ele devolve. Qualquer outro par responde 401.
const CLIENT_ID_VALIDO = "11111111-1111-4111-8111-111111111111";
const SEGREDO_VALIDO = "TEST-segredo-valido-0203";
const CLIENT_ID_NOVO = "22222222-2222-4222-8222-222222222222";
const SEGREDO_NOVO = "TEST-segredo-novo-0203";
const APIKEY = "[TEST] apikey-pluggy-falsa-0203";

// Itens: ITEM_A (Itaú), ITEM_B (cartão Nubank), ITEM_SEM_BANCO (as contas não dizem o banco). Outro id: 404.
const ITEM_A = "00000000-0000-4000-8000-0000000000a1";
const ITEM_B = "00000000-0000-4000-8000-0000000000b2";
const ITEM_SEM_BANCO = "00000000-0000-4000-8000-0000000000e5";
const ITENS = {
  [ITEM_A]: { cor: "#6A3DE8" },
  [ITEM_B]: { cor: "#6A3DE8" },
  [ITEM_SEM_BANCO]: { cor: "#6A3DE8" },
};

const CONTAS = {
  [ITEM_A]: [
    {
      id: "00000000-0000-4000-8000-000000000011",
      itemId: ITEM_A,
      type: "BANK",
      subtype: "CHECKING_ACCOUNT",
      number: "[TEST] 000001-0",
      name: "[TEST] Conta Corrente Teste",
      marketingName: "[TEST] Itaú Conta Corrente",
      balance: 1234.56,
      currencyCode: "BRL",
      bankData: { overdraftUsedLimit: 0, closingBalance: 1234.56 },
      creditData: null,
    },
    {
      id: "00000000-0000-4000-8000-000000000013",
      itemId: ITEM_A,
      type: "CREDIT",
      subtype: "CREDIT_CARD",
      number: "************0921",
      name: "[TEST] Cartão Teste",
      marketingName: "[TEST] Cartão Itaú Teste",
      balance: 1845.37,
      currencyCode: "BRL",
      bankData: null,
      creditData: { balanceCloseDate: "2026-11-03T00:00:00.000Z", creditLimit: 5000 },
    },
  ],
  [ITEM_B]: [
    {
      id: "00000000-0000-4000-8000-0000000000b1",
      itemId: ITEM_B,
      type: "CREDIT",
      subtype: "CREDIT_CARD",
      number: "************5678",
      name: "[TEST] Cartão Teste",
      marketingName: "[TEST] Cartão Nubank Teste",
      balance: 310.4,
      currencyCode: "BRL",
      bankData: null,
      creditData: { balanceCloseDate: "2026-11-03T00:00:00.000Z", creditLimit: 3000 },
    },
  ],
  [ITEM_SEM_BANCO]: [
    {
      id: "00000000-0000-4000-8000-0000000000e1",
      itemId: ITEM_SEM_BANCO,
      type: "BANK",
      subtype: "CHECKING_ACCOUNT",
      number: "[TEST] 000009-0",
      name: "[TEST] Conta Teste",
      marketingName: "[TEST] Conta Teste",
      balance: 10,
      currencyCode: "BRL",
      bankData: null,
      creditData: null,
    },
  ],
};

const IDENTIDADE = {
  id: "00000000-0000-4000-8000-000000000031",
  document: "000.000.000-00",
  documentType: "CPF",
  fullName: "[TEST] Pessoa Teste",
};

function enviar(res, status, corpo) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(corpo));
}

function item(id) {
  return {
    id,
    connector: {
      id: 200,
      name: "MeuPluggy",
      primaryColor: ITENS[id].cor,
      type: "PERSONAL_BANK",
      isSandbox: false,
    },
    status: "UPDATED",
    executionStatus: "SUCCESS",
    error: null,
    lastUpdatedAt: "2026-11-06T03:00:00.000Z",
    consentExpiresAt: "2027-10-01T00:00:00.000Z",
    products: ["ACCOUNTS", "CREDIT_CARDS", "TRANSACTIONS", "IDENTITY"],
  };
}

const servidor = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const caminho = url.pathname;
  const corpo = [];
  req.on("data", (pedaco) => corpo.push(pedaco));
  req.on("end", () => {
    if (req.method === "POST" && caminho === "/auth") {
      let dados = {};
      try {
        dados = JSON.parse(Buffer.concat(corpo).toString("utf8") || "{}");
      } catch {
        dados = {};
      }
      const aceita =
        (dados.clientId === CLIENT_ID_VALIDO && dados.clientSecret === SEGREDO_VALIDO) ||
        (dados.clientId === CLIENT_ID_NOVO && dados.clientSecret === SEGREDO_NOVO);
      if (aceita) return enviar(res, 200, { apiKey: APIKEY });
      return enviar(res, 401, {
        code: 401,
        codeDescription: "CLIENT_KEYS_UNAUTHORIZED",
        message: "[TEST] recusado",
      });
    }

    if (req.headers["x-api-key"] !== APIKEY) {
      return enviar(res, 401, { code: 401, codeDescription: "CLIENT_KEYS_UNAUTHORIZED" });
    }

    if (req.method === "GET" && caminho.startsWith("/items/")) {
      const id = caminho.slice("/items/".length);
      if (!(id in ITENS)) return enviar(res, 404, { code: 404, codeDescription: "ITEM_NOT_FOUND" });
      return enviar(res, 200, item(id));
    }
    if (req.method === "GET" && caminho === "/accounts") {
      const itemId = url.searchParams.get("itemId") ?? "";
      if (!(itemId in ITENS)) return enviar(res, 404, { code: 404, codeDescription: "ITEM_NOT_FOUND" });
      const contas = CONTAS[itemId] ?? [];
      return enviar(res, 200, { page: 1, total: contas.length, totalPages: 1, results: contas });
    }
    if (req.method === "GET" && caminho === "/identity") {
      return enviar(res, 200, { ...IDENTIDADE, itemId: url.searchParams.get("itemId") });
    }
    // Importação do histórico (TASK-0204): sem movimentos nem faturas; cada janela demora um pouco, para a barra aparecer.
    if (req.method === "GET" && (caminho === "/investments" || caminho === "/bills")) {
      return enviar(res, 200, { page: 1, total: 0, totalPages: 1, results: [] });
    }
    if (req.method === "GET" && caminho === "/v2/transactions") {
      setTimeout(() => enviar(res, 200, { results: [], next: null }), 250);
      return;
    }
    return enviar(res, 404, { code: 404, codeDescription: "ROUTE_NOT_FOUND" });
  });
});

servidor.listen(PORTA, "127.0.0.1", () => {
  process.stdout.write(`pluggy-fake pronto em http://127.0.0.1:${PORTA}\n`);
});

for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, () => {
    servidor.close(() => process.exit(0));
  });
}
