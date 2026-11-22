import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, type InitialEntry, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeaturesProvider } from "@/app/features";
import { HideValuesProvider } from "@/components/ui/hide-values";
import { criarRotas } from "@/routes";
import { SessionProvider } from "@/session/SessionProvider";
import { SESSAO_DE_TESTE } from "../helpers/app";
import { instalarMatchMedia } from "../helpers/larguras";

// A tela do Pix enviado e a Compra em modo fila (TASK-0404), com a API falsa: Lembrar (chave, texto, regra), a fila
// ("N de M", "faltam", o próximo depois do atual), o voltar do topo, o pagamento de cartão (ligar relê a fila), a TED
// marcada como pagamento e os textos do nome. Dados [TEST].

type Chamada = { metodo: string; caminho: string; corpo: unknown };
type ItemDaFila = { id: string; data: string; caminho: string };

const CATEGORIA = { id: "cat1", name: "[TEST] Serviços", parentName: null };

const PIX = {
  id: "p3",
  movement: "pix_enviado",
  baseMovement: "pix_enviado",
  localDate: "2026-11-08",
  occurredAt: "2026-11-08T17:32:00Z",
  amountCents: -15000,
  originalDescription: "PIX ENVIADO [TEST] JOAO P SILVA",
  customName: null,
  displayName: "Pix para [TEST] JOAO P SILVA",
  category: null as typeof CATEGORIA | null,
  categorizedBy: null,
  aiSuggestion: null,
  spendType: "prazeres",
  spendTypeSource: "padrao",
  hidden: false,
  hiddenReason: null,
  installment: null,
  card: null,
  account: { id: "a1", label: "[TEST] Banco" },
  bill: null,
  cycle: null,
  counterparty: {
    name: "[TEST] JOAO P SILVA",
    docMasked: "•••.456.789-••",
    docKind: "cpf",
    bank: "Banco do Brasil",
    pixKeyMasked: null,
  },
  origin: { institution: "[TEST] Banco", connectionLabel: "[TEST] Conexão" },
  cardWouldAccept: false,
  isCardPayment: false,
  canMarkCardPayment: true,
};

const CATEGORIZACAO = {
  transactionId: "p3",
  scope: "destinatario",
  matchLabel: "[TEST] JOAO P SILVA",
  categoryId: null,
  aiCategoryId: null,
  rule: null as null | {
    id: string;
    createdFrom: string;
    setCategoryId: string | null;
    setCustomName: null;
    setSpendType: string | null;
  },
};

type Cena = {
  detalhe: Record<string, unknown>;
  categorizacao: Record<string, unknown>;
  itens: ItemDaFila[];
  total: number;
  chamadas: Chamada[];
  aoLigar?: (ligada: boolean) => void;
};

let cena: Cena;

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

function novaCena(sobre: Partial<Cena> = {}): Cena {
  return {
    detalhe: { ...PIX },
    categorizacao: { ...CATEGORIZACAO },
    itens: [],
    total: 0,
    chamadas: [],
    ...sobre,
  };
}

function instalarFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (caminho: string, init?: RequestInit) => {
      const metodo = init?.method ?? "GET";
      const corpo = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      cena.chamadas.push({ metodo, caminho, corpo });
      if (caminho.startsWith("/api/categorization/queue")) {
        return json({
          counts: { todos: cena.total },
          suggested: {},
          items: cena.itens.map((i) => ({
            transactionId: i.id,
            localDate: i.data,
            detailPath: i.caminho,
          })),
          nextCursor: cena.itens.length > 0 ? "proxima" : null,
          hoje: "2026-11-10",
        });
      }
      if (caminho.endsWith("/categorization")) return json(cena.categorizacao);
      if (caminho.endsWith("/card-payment")) {
        cena.aoLigar?.((corpo as { isCardPayment: boolean }).isCardPayment);
        return json({ isCardPayment: (corpo as { isCardPayment: boolean }).isCardPayment, alsoMarked: 0 });
      }
      if (caminho === "/api/rules") return json({ rule: { id: "r1" } });
      if (caminho.startsWith("/api/transactions/")) return json(cena.detalhe);
      return json({ error: "nao_encontrada" }, 404);
    }),
  );
}

function montar(entradas: InitialEntry[], indice = 0) {
  const roteador = createMemoryRouter(criarRotas(), { initialEntries: entradas, initialIndex: indice });
  render(
    <FeaturesProvider valores={{ ia: false, assistente: true, voz: false }}>
      <HideValuesProvider>
        <SessionProvider valores={SESSAO_DE_TESTE}>
          <RouterProvider router={roteador} />
        </SessionProvider>
      </HideValuesProvider>
    </FeaturesProvider>,
  );
  return roteador;
}

const fila = (...ids: [string, string][]): ItemDaFila[] =>
  ids.map(([id, data]) => ({ id, data, caminho: `/pix/${id}` }));

beforeEach(() => {
  instalarMatchMedia(1440);
  cena = novaCena();
  instalarFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const chamadasA = (metodo: string, trecho: string) =>
  cena.chamadas.filter((c) => c.metodo === metodo && c.caminho.includes(trecho));

describe("Lembrar para os próximos Pix", () => {
  it("sem categoria: chave desligada e desabilitada, com o texto de escolher a categoria", async () => {
    montar(["/pix/p3"]);
    const chave = await screen.findByRole("switch", { name: /Lembrar para os próximos Pix/ });
    expect(chave).toHaveAttribute("aria-checked", "false");
    expect(chave).toBeDisabled();
    expect(screen.getByText("Escolha a categoria para poder lembrar.")).toBeInTheDocument();
  });

  it("com categoria e sem regra: chave ligada por padrão, sem aviso de regra", async () => {
    cena = novaCena({ detalhe: { ...PIX, category: CATEGORIA, categorizedBy: "pessoa" } });
    instalarFetch();
    montar(["/pix/p3"]);
    const chave = await screen.findByRole("switch", { name: /Lembrar para os próximos Pix/ });
    expect(chave).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(/já seguem uma regra/)).toBeNull();
  });

  it("com categoria e com regra: chave ligada e o texto da regra existente", async () => {
    cena = novaCena({
      detalhe: { ...PIX, category: CATEGORIA, categorizedBy: "pessoa" },
      categorizacao: {
        ...CATEGORIZACAO,
        rule: {
          id: "r0",
          createdFrom: "lembrar",
          setCategoryId: "cat1",
          setCustomName: null,
          setSpendType: "prazeres",
        },
      },
    });
    instalarFetch();
    montar(["/pix/p3"]);
    const chave = await screen.findByRole("switch", { name: /Lembrar para os próximos Pix/ });
    expect(chave).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(
        "Os próximos Pix para [TEST] JOAO P SILVA já seguem uma regra. Para desfazer, use Configurações › Regras.",
      ),
    ).toBeInTheDocument();
  });

  it("sem destinatário (escopo nulo ou sem rótulo): o cartão do Lembrar some", async () => {
    cena = novaCena({ categorizacao: { ...CATEGORIZACAO, scope: null, matchLabel: null } });
    instalarFetch();
    montar(["/pix/p3"]);
    await screen.findByRole("heading", { name: "Esse lugar aceitava cartão" });
    expect(screen.queryByRole("switch", { name: /Lembrar/ })).toBeNull();
    cleanup();

    cena = novaCena({ categorizacao: { ...CATEGORIZACAO, matchLabel: null } });
    instalarFetch();
    montar(["/pix/p3"]);
    await screen.findByRole("heading", { name: "Esse lugar aceitava cartão" });
    expect(screen.queryByRole("switch", { name: /Lembrar/ })).toBeNull();
    cleanup();

    // Escopo que não é o do destinatário, mesmo com rótulo: o cartão some.
    cena = novaCena({ categorizacao: { ...CATEGORIZACAO, scope: "estabelecimento" } });
    instalarFetch();
    montar(["/pix/p3"]);
    await screen.findByRole("heading", { name: "Esse lugar aceitava cartão" });
    expect(screen.queryByRole("switch", { name: /Lembrar/ })).toBeNull();
  });

  it("Salvar com Lembrar ligado grava a regra 'lembrar' e não chama a regra com a chave desligada", async () => {
    cena = novaCena({ detalhe: { ...PIX, category: CATEGORIA, categorizedBy: "pessoa" } });
    instalarFetch();
    montar(["/inicio", "/pix/p3"], 1);
    await screen.findByRole("switch", { name: /Lembrar para os próximos Pix/ });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(chamadasA("POST", "/api/rules")).toHaveLength(1));
    expect(chamadasA("POST", "/api/rules")[0]?.corpo).toMatchObject({
      transactionId: "p3",
      createdFrom: "lembrar",
      set: { categoryId: "cat1" },
    });
  });

  it("Salvar sem categoria não chama a regra", async () => {
    const roteador = montar(["/inicio", "/pix/p3"], 1);
    await screen.findByRole("button", { name: "Salvar" });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(roteador.state.location.pathname).toBe("/inicio"));
    expect(chamadasA("POST", "/api/rules")).toHaveLength(0);
  });
});

describe("Pix sem contraparte e com categoria, em fila (N1)", () => {
  it("o Salvar não cria regra (o cartão do Lembrar não está na tela) e vai ao próximo", async () => {
    cena = novaCena({
      detalhe: {
        ...PIX,
        category: CATEGORIA,
        categorizedBy: "pessoa",
        counterparty: { name: null, docMasked: null, docKind: null, bank: null, pixKeyMasked: null },
      },
      categorizacao: { ...CATEGORIZACAO, scope: "destinatario", matchLabel: null },
      itens: fila(["p4", "2026-11-07"]),
      total: 1,
    });
    instalarFetch();
    const roteador = montar(["/pix/p3?fila=1"]);
    await screen.findByRole("button", { name: /Salvar e ir para o próximo/ });
    expect(screen.queryByRole("switch", { name: /Lembrar/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Salvar e ir para o próximo/ }));
    await waitFor(() => expect(roteador.state.location.pathname).toBe("/pix/p4"));
    expect(chamadasA("POST", "/api/rules")).toHaveLength(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lê só a primeira página quando o item já saiu da fila (a página passa do lugar dele)", async () => {
    cena = novaCena({
      itens: fila(["p4", "2026-11-07"], ["p5", "2026-11-06"]),
      total: 2,
    });
    instalarFetch();
    montar(["/pix/p3?fila=1"]);
    await screen.findByRole("button", { name: /Salvar e ir para o próximo/ });
    expect(chamadasA("GET", "/api/categorization/queue")).toHaveLength(1);
  });
});

describe("modo fila no Pix", () => {
  it("o item na fila: '1 de 8 para categorizar' e 'faltam 7'", async () => {
    cena = novaCena({
      detalhe: { ...PIX, id: "p1", localDate: "2026-11-10" },
      itens: fila(["p1", "2026-11-10"], ["p2", "2026-11-09"]),
      total: 8,
    });
    instalarFetch();
    montar(["/pix/p1?fila=1"]);
    expect(await screen.findByText("1 de 8 para categorizar")).toBeInTheDocument();
    const botao = screen.getByRole("button", { name: /Salvar e ir para o próximo/ });
    expect(botao).toHaveTextContent("· faltam 7");
  });

  it("o item que já saiu da fila: sem subtítulo, e 'faltam' é o total", async () => {
    cena = novaCena({ itens: fila(["p1", "2026-11-10"], ["p2", "2026-11-09"]), total: 4 });
    instalarFetch();
    montar(["/pix/p3?fila=1"]);
    const botao = await screen.findByRole("button", { name: /Salvar e ir para o próximo/ });
    expect(botao).toHaveTextContent("· faltam 4");
    expect(screen.queryByText(/para categorizar$/)).toBeNull();
  });

  it("o último item da fila: 'Salvar e voltar para a fila' e Salvar leva a /para-categorizar", async () => {
    cena = novaCena({ itens: fila(["p3", "2026-11-08"]), total: 1 });
    instalarFetch();
    const roteador = montar(["/pix/p3?fila=1"]);
    expect(await screen.findByText("1 de 1 para categorizar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar e voltar para a fila" }));
    await waitFor(() => expect(roteador.state.location.pathname).toBe("/para-categorizar"));
  });

  it("o próximo é o primeiro depois do atual (o atual já saiu), lendo só a primeira página", async () => {
    cena = novaCena({
      itens: fila(["p1", "2026-11-10"], ["p2", "2026-11-09"], ["p4", "2026-11-07"], ["p5", "2026-11-06"]),
      total: 4,
    });
    instalarFetch();
    const roteador = montar(["/pix/p3?fila=1"]);
    await screen.findByRole("button", { name: /Salvar e ir para o próximo/ });
    const lidasAntes = chamadasA("GET", "/api/categorization/queue").length;
    fireEvent.click(screen.getByRole("button", { name: /Salvar e ir para o próximo/ }));
    await waitFor(() => expect(roteador.state.location.pathname).toBe("/pix/p4"));
    expect(roteador.state.location.search).toBe("?fila=1");
    const lidas = chamadasA("GET", "/api/categorization/queue").slice(lidasAntes);
    expect(lidas).toHaveLength(1);
    expect(lidas[0]?.caminho).not.toContain("cursor");
  });

  it("a seta do topo, em fila, vai para Para categorizar", async () => {
    cena = novaCena({ itens: fila(["p3", "2026-11-08"]), total: 1 });
    instalarFetch();
    const roteador = montar(["/inicio", "/pix/p3?fila=1"], 1);
    const seta = await screen.findByRole("link", { name: "Voltar" });
    expect(seta).toHaveAttribute("href", "/para-categorizar");
    fireEvent.click(seta);
    await waitFor(() => expect(roteador.state.location.pathname).toBe("/para-categorizar"));
  });

  it("ligar o pagamento de cartão relê a fila: o item sai e o subtítulo some", async () => {
    cena = novaCena({
      itens: fila(["p3", "2026-11-08"], ["p4", "2026-11-07"]),
      total: 2,
      aoLigar: (ligada) => {
        cena.detalhe = { ...PIX, movement: "pagamento_fatura", isCardPayment: ligada };
        cena.itens = fila(["p4", "2026-11-07"]);
        cena.total = 1;
      },
    });
    instalarFetch();
    montar(["/pix/p3?fila=1"]);
    expect(await screen.findByText("1 de 2 para categorizar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "É pagamento de cartão" }));
    await screen.findByText("Pagamento de cartão · não conta como gasto");
    await waitFor(() => expect(screen.queryByText("1 de 2 para categorizar")).toBeNull());
    expect(screen.getByRole("button", { name: /Salvar e ir para o próximo/ })).toHaveTextContent(
      "· faltam 1",
    );
  });
});

describe("pagamento de cartão ligado", () => {
  it("TED marcada como pagamento segue TED no título e na pílula, e esconde categoria e chaves", async () => {
    cena = novaCena({
      detalhe: { ...PIX, movement: "pagamento_fatura", baseMovement: "ted_enviada", isCardPayment: true },
    });
    instalarFetch();
    montar(["/pix/p3"]);
    expect(await screen.findByRole("heading", { level: 1, name: /TED enviada/ })).toBeInTheDocument();
    expect(screen.getByText("TED", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("PIX", { exact: true })).toBeNull();
    expect(screen.getByText("Pagamento de cartão · não conta como gasto")).toBeInTheDocument();
    expect(screen.queryByText("Categoria")).toBeNull();
    expect(screen.queryByRole("switch", { name: /Lembrar/ })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Esse lugar aceitava cartão" })).toBeNull();
  });

  it("depois de ligar, o texto dos próximos segue o destinatário (matchLabel lido pela base)", async () => {
    cena = novaCena({
      detalhe: { ...PIX, movement: "pagamento_fatura", isCardPayment: true },
    });
    instalarFetch();
    montar(["/pix/p3"]);
    await screen.findByText("Pagamento de cartão · não conta como gasto");
    expect(
      screen.getByText(/Os próximos para \[TEST\] JOAO P SILVA entram assim sozinhos\./),
    ).toBeInTheDocument();
  });

  it("sem destinatário, o texto dos próximos some, e a chave só aparece com canMarkCardPayment", async () => {
    cena = novaCena({
      categorizacao: { ...CATEGORIZACAO, matchLabel: null },
      detalhe: { ...PIX, canMarkCardPayment: false },
    });
    instalarFetch();
    montar(["/pix/p3"]);
    await screen.findByRole("heading", { name: "Esse lugar aceitava cartão" });
    expect(screen.queryByRole("switch", { name: "É pagamento de cartão" })).toBeNull();
    cleanup();

    cena = novaCena({ categorizacao: { ...CATEGORIZACAO, matchLabel: null } });
    instalarFetch();
    montar(["/pix/p3"]);
    await screen.findByRole("switch", { name: "É pagamento de cartão" });
    expect(screen.queryByText(/Os próximos/)).toBeNull();
  });
});

describe("nome próprio no Pix", () => {
  it("ao abrir a edição: exemplo do Pix, chave 'nos próximos Pix para' desligada", async () => {
    montar(["/pix/p3"]);
    fireEvent.click(await screen.findByRole("button", { name: "Renomear" }));
    expect(await screen.findByPlaceholderText("Ex.: Pedreiro da varanda")).toBeInTheDocument();
    const chave = await screen.findByRole("switch", {
      name: "Usar este nome nos próximos Pix para [TEST] JOAO P SILVA",
    });
    expect(chave).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText(/nas próximas de/)).toBeNull();
  });
});

describe("Compra", () => {
  const COMPRA_NA_CONTA = {
    ...PIX,
    id: "b1",
    movement: "boleto",
    baseMovement: "boleto",
    displayName: "[TEST] PAG CARTAO",
    originalDescription: "[TEST] PAG CARTAO",
    counterparty: null,
    origin: null,
  };

  it("pagamento de cartão ligado: aviso no lugar da categoria, título pela base e frase 'Os próximos de'", async () => {
    cena = novaCena({
      detalhe: { ...COMPRA_NA_CONTA, movement: "pagamento_fatura", isCardPayment: true },
      categorizacao: { ...CATEGORIZACAO, scope: "estabelecimento", matchLabel: "[TEST] PAG CARTAO" },
    });
    instalarFetch();
    montar(["/compras/b1"]);
    expect(await screen.findByRole("heading", { level: 1, name: /Boleto/ })).toBeInTheDocument();
    expect(screen.getByText("Pagamento de cartão · não conta como gasto")).toBeInTheDocument();
    expect(screen.queryByText("Categoria")).toBeNull();
    expect(
      await screen.findByText(/Os próximos de \[TEST\] PAG CARTAO entram assim sozinhos\./),
    ).toBeInTheDocument();
  });

  it("em fila, a seta do topo vai para Para categorizar", async () => {
    cena = novaCena({
      detalhe: { ...COMPRA_NA_CONTA },
      itens: fila(["b1", "2026-11-08"]),
      total: 1,
    });
    instalarFetch();
    const roteador = montar(["/inicio", "/compras/b1?fila=1"], 1);
    const seta = await screen.findByRole("link", { name: "Voltar" });
    expect(seta).toHaveAttribute("href", "/para-categorizar");
    fireEvent.click(seta);
    await waitFor(() => expect(roteador.state.location.pathname).toBe("/para-categorizar"));
  });

  it("em fila, o botão leva ao primeiro depois do atual", async () => {
    cena = novaCena({
      detalhe: { ...COMPRA_NA_CONTA, localDate: "2026-11-08" },
      itens: fila(["p1", "2026-11-10"], ["p4", "2026-11-07"]),
      total: 2,
    });
    instalarFetch();
    const roteador = montar(["/compras/b1?fila=1"]);
    fireEvent.click(await screen.findByRole("button", { name: /Salvar e ir para o próximo/ }));
    await waitFor(() => expect(roteador.state.location.pathname).toBe("/pix/p4"));
  });

  it("ligar o pagamento relê a fila (o subtítulo refaz)", async () => {
    cena = novaCena({
      detalhe: { ...COMPRA_NA_CONTA },
      categorizacao: { ...CATEGORIZACAO, scope: "estabelecimento", matchLabel: "[TEST] PAG CARTAO" },
      itens: fila(["b1", "2026-11-08"], ["p4", "2026-11-07"]),
      total: 2,
      aoLigar: () => {
        cena.detalhe = { ...COMPRA_NA_CONTA, movement: "pagamento_fatura", isCardPayment: true };
        cena.itens = fila(["p4", "2026-11-07"]);
        cena.total = 1;
      },
    });
    instalarFetch();
    montar(["/compras/b1?fila=1"]);
    expect(await screen.findByText("1 de 2 para categorizar")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("switch", { name: "É pagamento de cartão" }));
    await waitFor(() => expect(screen.queryByText("1 de 2 para categorizar")).toBeNull());
    expect(
      within(document.body).getByRole("button", { name: /Salvar e ir para o próximo/ }),
    ).toHaveTextContent("· faltam 1");
  });
});
