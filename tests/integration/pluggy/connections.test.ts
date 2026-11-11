import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConnectionsResponse,
  CreatedConnectionResponse,
  PreviewItemsResponse,
} from "../../../src/shared/pluggy-api";
import { nomeDaChave } from "../../../src/worker/pluggy/connections";
import { decryptSecret } from "../../../src/worker/security/crypto";
import { COOKIE_DO_CONJUGE, COOKIE_DO_TITULAR, criaLarDeDuas, criaOutroLar } from "../helpers/aparelhos";
import { callApi, semearPronto } from "../helpers/app";
import {
  APIKEY_DE_TESTE,
  appComPluggy,
  CLIENT_ID_NOVO,
  CLIENT_ID_VALIDO,
  ITEM_A,
  ITEM_B,
  ITEM_C,
  ITEM_D,
  ITEM_INEXISTENTE,
  ITEM_SEM_BANCO,
  type PluggyFalso,
  pluggyFalso,
  SEGREDO_NOVO,
  SEGREDO_VALIDO,
} from "../helpers/pluggy";

// Contas do Meu Pluggy (TASK-0203): cenários 1 a 14 da spec, pela API, com o Meu Pluggy falso injetado.
// Todos os dados são [TEST]; nenhuma chamada sai do Worker de teste.

const CHAVES = { clientId: CLIENT_ID_VALIDO, clientSecret: SEGREDO_VALIDO };
const SEGREDO_ERRADO = "TEST-segredo-errado-0203";

// Instalação pronta com um lar de duas pessoas (titular e cônjuge, cada um com a sessão no próprio aparelho).
beforeEach(async () => {
  await semearPronto(env.DB);
  await criaLarDeDuas();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Resposta = { status: number; corpo: unknown; texto: string };

async function pedir(
  app: ReturnType<typeof appComPluggy>,
  metodo: string,
  caminho: string,
  corpo?: unknown,
  cookie: string | null = COOKIE_DO_TITULAR,
  ambiente = env,
): Promise<Resposta> {
  const cabecalhos: Record<string, string> = cookie === null ? {} : { cookie };
  const resposta = await callApi(app, metodo, caminho, corpo, cabecalhos, ambiente);
  const texto = await resposta.text();
  return { status: resposta.status, corpo: texto === "" ? null : (JSON.parse(texto) as unknown), texto };
}

const contagem = async (sql: string, ...valores: unknown[]): Promise<number> => {
  const linha = await env.DB.prepare(sql)
    .bind(...valores)
    .first<{ n: number }>();
  return linha?.n ?? 0;
};

// Cria a conexão [TEST] Conta A com o item A (Itaú). Devolve o id da conexão.
async function criaConexaoA(
  app: ReturnType<typeof appComPluggy>,
  rotulo = "[TEST] Conta A",
): Promise<string> {
  const criada = await pedir(app, "POST", "/api/pluggy-connections", {
    label: rotulo,
    ...CHAVES,
    items: [{ itemId: ITEM_A }],
  });
  expect(criada.status).toBe(201);
  return (criada.corpo as CreatedConnectionResponse).connection.id;
}

const SEGREDOS = [SEGREDO_VALIDO, SEGREDO_NOVO, CLIENT_ID_VALIDO, CLIENT_ID_NOVO, APIKEY_DE_TESTE];
const semSegredos = (texto: string) => SEGREDOS.every((segredo) => !texto.includes(segredo));

describe("Meu Pluggy: caminho feliz e a cifra (cenário 1)", () => {
  it("testa as chaves, mostra o banco, grava a conexão cifrada e a lista traz só a forma", async () => {
    const falso = pluggyFalso();
    const app = appComPluggy(falso);

    expect((await pedir(app, "POST", "/api/pluggy-connections/test-keys", CHAVES)).status).toBe(200);

    const previa = await pedir(app, "POST", "/api/pluggy-connections/preview-items", {
      ...CHAVES,
      itemIds: [ITEM_A],
    });
    expect(previa.status).toBe(200);
    const [item] = (previa.corpo as PreviewItemsResponse).items;
    expect(item).toMatchObject({
      itemId: ITEM_A,
      institutionName: "Itaú",
      summary: "Conta corrente e cartão final 0921",
      alreadyConnected: false,
    });

    const criada = await pedir(app, "POST", "/api/pluggy-connections", {
      label: "[TEST] Conta A",
      ...CHAVES,
      items: [{ itemId: ITEM_A }],
    });
    expect(criada.status).toBe(201);
    const corpo = criada.corpo as CreatedConnectionResponse;
    expect(corpo.connection).toMatchObject({ label: "[TEST] Conta A", cpfMasked: "***.000.000-**" });
    expect(corpo.bankItems).toEqual([{ id: ITEM_A, institutionName: "Itaú" }]);

    // Cifrada: a linha não tem o texto puro, e abre só com o nome de cada cifra (ADR-004).
    const linha = await env.DB.prepare(
      "SELECT client_id_enc, iv, client_secret_enc, client_secret_iv FROM pluggy_connections WHERE id = ?",
    )
      .bind(corpo.connection.id)
      .first<{ client_id_enc: string; iv: string; client_secret_enc: string; client_secret_iv: string }>();
    expect(linha?.client_id_enc).toBeTruthy();
    expect(linha?.client_id_enc).not.toBe(CLIENT_ID_VALIDO);
    expect(linha?.client_secret_enc).toBeTruthy();
    expect(linha?.client_secret_enc).not.toBe(SEGREDO_VALIDO);
    expect(linha?.client_secret_iv).not.toBe(linha?.iv);
    const abertoId = await decryptSecret(env.MASTER_KEY, nomeDaChave(corpo.connection.id, "client_id"), {
      ciphertext: linha?.client_id_enc ?? "",
      iv: linha?.iv ?? "",
    });
    expect(abertoId).toBe(CLIENT_ID_VALIDO);
    const abertoSecret = await decryptSecret(env.MASTER_KEY, `pluggy:${corpo.connection.id}:client_secret`, {
      ciphertext: linha?.client_secret_enc ?? "",
      iv: linha?.client_secret_iv ?? "",
    });
    expect(abertoSecret).toBe(SEGREDO_VALIDO);

    const banco = await env.DB.prepare("SELECT institution_name, status FROM bank_items WHERE id = ?")
      .bind(ITEM_A)
      .first<{ institution_name: string; status: string }>();
    expect(banco).toEqual({ institution_name: "Itaú", status: "ativo" });

    const lista = await pedir(app, "GET", "/api/pluggy-connections");
    expect(lista.status).toBe(200);
    const conexoes = (lista.corpo as ConnectionsResponse).connections;
    expect(conexoes).toHaveLength(1);
    expect(conexoes[0]).toMatchObject({
      label: "[TEST] Conta A",
      hasKeys: true,
      cpfMasked: "***.000.000-**",
    });
    expect(conexoes[0]?.bankItems[0]).toMatchObject({ id: ITEM_A, institutionName: "Itaú", status: "ativo" });

    // Nenhuma resposta leva as chaves (cenário 10 também cobre os erros).
    for (const resposta of [previa, criada, lista]) expect(semSegredos(resposta.texto)).toBe(true);
  });
});

describe("Meu Pluggy: chaves erradas e Pluggy fora (cenários 2 e 3)", () => {
  it("chave recusada: 422 com a mensagem da spec, e nada é gravado", async () => {
    const app = appComPluggy(pluggyFalso());
    const teste = await pedir(app, "POST", "/api/pluggy-connections/test-keys", {
      clientId: CLIENT_ID_VALIDO,
      clientSecret: SEGREDO_ERRADO,
    });
    expect(teste.status).toBe(422);
    expect(teste.corpo).toMatchObject({
      error: "chaves_invalidas",
      message: "O Meu Pluggy recusou estas chaves. Confira o Client ID e o Client Secret.",
    });

    const criada = await pedir(app, "POST", "/api/pluggy-connections", {
      label: "[TEST] Conta A",
      clientId: CLIENT_ID_VALIDO,
      clientSecret: SEGREDO_ERRADO,
      items: [{ itemId: ITEM_A }],
    });
    expect(criada.status).toBe(422);
    expect(criada.corpo).toMatchObject({ error: "chaves_invalidas" });
    expect(await contagem("SELECT COUNT(*) AS n FROM pluggy_connections")).toBe(0);
    expect(await contagem("SELECT COUNT(*) AS n FROM bank_items")).toBe(0);
    expect(semSegredos(teste.texto + criada.texto)).toBe(true);
  });

  it("Pluggy fora (503 no /auth): 502 pluggy_indisponivel, e nada é gravado", async () => {
    const app = appComPluggy(pluggyFalso({ statusDoAuth: 503 }));
    const teste = await pedir(app, "POST", "/api/pluggy-connections/test-keys", CHAVES);
    expect(teste.status).toBe(502);
    expect(teste.corpo).toMatchObject({
      error: "pluggy_indisponivel",
      message: "O Meu Pluggy não respondeu. Tente de novo em instantes.",
    });

    const criada = await pedir(app, "POST", "/api/pluggy-connections", {
      label: "[TEST] Conta A",
      ...CHAVES,
      items: [{ itemId: ITEM_A }],
    });
    expect(criada.status).toBe(502);
    expect(await contagem("SELECT COUNT(*) AS n FROM pluggy_connections")).toBe(0);
  });
});

describe("Meu Pluggy: id errado e banco sem nome (cenários 4 e 5)", () => {
  it("id que o Pluggy não acha: a prévia marca nao_encontrado e a criação responde 422 sem gravar", async () => {
    const app = appComPluggy(pluggyFalso());
    const previa = await pedir(app, "POST", "/api/pluggy-connections/preview-items", {
      ...CHAVES,
      itemIds: [ITEM_INEXISTENTE, ITEM_A],
    });
    expect(previa.status).toBe(200);
    const [inexistente, existente] = (previa.corpo as PreviewItemsResponse).items;
    expect(inexistente).toEqual({ itemId: ITEM_INEXISTENTE, error: "nao_encontrado" });
    expect(existente).toMatchObject({ itemId: ITEM_A, institutionName: "Itaú" });

    const criada = await pedir(app, "POST", "/api/pluggy-connections", {
      label: "[TEST] Conta A",
      ...CHAVES,
      items: [{ itemId: ITEM_INEXISTENTE }],
    });
    expect(criada.status).toBe(422);
    expect(criada.corpo).toMatchObject({
      error: "item_nao_encontrado",
      message: "Não achamos este id no Meu Pluggy. Confira se copiou o id inteiro.",
    });
    expect(await contagem("SELECT COUNT(*) AS n FROM pluggy_connections")).toBe(0);
  });

  it("banco sem nome: 422 nome_do_banco sem o nome; com o nome enviado, grava; o nome deduzido vale mais", async () => {
    const app = appComPluggy(pluggyFalso());
    const semNome = await pedir(app, "POST", "/api/pluggy-connections", {
      label: "[TEST] Conta B",
      ...CHAVES,
      items: [{ itemId: ITEM_SEM_BANCO }],
    });
    expect(semNome.status).toBe(422);
    expect(semNome.corpo).toMatchObject({ error: "nome_do_banco", message: "Diga qual é o banco." });
    expect(await contagem("SELECT COUNT(*) AS n FROM pluggy_connections")).toBe(0);

    const comNome = await pedir(app, "POST", "/api/pluggy-connections", {
      label: "[TEST] Conta B",
      ...CHAVES,
      items: [{ itemId: ITEM_SEM_BANCO, institutionName: "[TEST] Banco Teste" }],
    });
    expect(comNome.status).toBe(201);
    expect((comNome.corpo as CreatedConnectionResponse).bankItems).toEqual([
      { id: ITEM_SEM_BANCO, institutionName: "[TEST] Banco Teste" },
    ]);

    const deduzido = await pedir(app, "POST", "/api/pluggy-connections", {
      label: "[TEST] Conta C",
      ...CHAVES,
      items: [{ itemId: ITEM_A, institutionName: "Outro nome" }],
    });
    expect(deduzido.status).toBe(201);
    expect((deduzido.corpo as CreatedConnectionResponse).bankItems[0]?.institutionName).toBe("Itaú");
  });
});

// Meu Pluggy falso que responde `status` em todo GET /items/:id, como o real faz com um id cortado (400) ou de outra
// conta (403). O resto segue o falso padrão.
function pluggyComItemRecusado(status: 400 | 403): PluggyFalso {
  const base = pluggyFalso();
  const comItemRecusado = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(entrada));
    if ((init?.method ?? "GET") === "GET" && url.pathname.startsWith("/items/")) {
      base.chamadas.push({ metodo: "GET", caminho: url.pathname, query: url.search });
      return new Response(JSON.stringify({ code: status, codeDescription: "TEST_ITEM_RECUSADO" }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    return base.fetch(entrada, init);
  }) as typeof fetch;
  return { fetch: comItemRecusado, chamadas: base.chamadas };
}

describe("Meu Pluggy: id cortado ou de outra conta (TASK-0203, achado 4)", () => {
  // Id cortado (o Pluggy responde 400) e id de outra conta (403): ambos viram "não achamos", sem 502.
  it.each<[400 | 403, string]>([
    [400, ITEM_A.slice(0, -4)],
    [403, ITEM_A],
  ])(
    "GET /items/:id com %i: a prévia marca nao_encontrado e a criação responde 422 sem gravar",
    async (status, id) => {
      const falso = pluggyComItemRecusado(status);
      const app = appComPluggy(falso);

      const previa = await pedir(app, "POST", "/api/pluggy-connections/preview-items", {
        ...CHAVES,
        itemIds: [id],
      });
      expect(previa.status).toBe(200);
      expect((previa.corpo as PreviewItemsResponse).items).toEqual([{ itemId: id, error: "nao_encontrado" }]);
      expect(falso.chamadas.some((chamada) => chamada.caminho === `/items/${id}`)).toBe(true);

      const criada = await pedir(app, "POST", "/api/pluggy-connections", {
        label: "[TEST] Conta A",
        ...CHAVES,
        items: [{ itemId: id }],
      });
      expect(criada.status).toBe(422);
      expect(criada.corpo).toMatchObject({
        error: "item_nao_encontrado",
        message: "Não achamos este id no Meu Pluggy. Confira se copiou o id inteiro.",
      });
      expect(await contagem("SELECT COUNT(*) AS n FROM pluggy_connections")).toBe(0);
      expect(await contagem("SELECT COUNT(*) AS n FROM bank_items")).toBe(0);
    },
  );
});

describe("Meu Pluggy: rótulo e banco repetidos (cenários 6 e 7)", () => {
  it("rótulo repetido vira 409; rótulo genérico vira 400 com a mensagem do campo", async () => {
    const app = appComPluggy(pluggyFalso());
    await criaConexaoA(app);
    const repetido = await pedir(app, "POST", "/api/pluggy-connections", {
      label: "[TEST] Conta A",
      ...CHAVES,
      items: [{ itemId: ITEM_B }],
    });
    expect(repetido.status).toBe(409);
    expect(repetido.corpo).toMatchObject({
      error: "rotulo_em_uso",
      message: "Já existe uma conexão com este nome.",
    });

    for (const generico of ["Sua conta", "minha conta", "conta"]) {
      const recusado = await pedir(app, "POST", "/api/pluggy-connections", {
        label: generico,
        ...CHAVES,
        items: [{ itemId: ITEM_B }],
      });
      expect(recusado.status).toBe(400);
      expect(recusado.corpo).toMatchObject({
        error: "validacao",
        fields: { label: "Use o nome de quem é a conta, para aparecer igual para os dois." },
      });
    }
  });

  it("banco já no Matrimoney: a prévia marca alreadyConnected, e criar ou adicionar dá 409", async () => {
    const app = appComPluggy(pluggyFalso());
    const conexao = await criaConexaoA(app);

    const previa = await pedir(app, "POST", "/api/pluggy-connections/preview-items", {
      ...CHAVES,
      itemIds: [ITEM_A],
    });
    expect((previa.corpo as PreviewItemsResponse).items[0]).toMatchObject({ alreadyConnected: true });

    const criadaDeNovo = await pedir(app, "POST", "/api/pluggy-connections", {
      label: "[TEST] Conta B",
      ...CHAVES,
      items: [{ itemId: ITEM_A }],
    });
    expect(criadaDeNovo.status).toBe(409);
    expect(criadaDeNovo.corpo).toMatchObject({
      error: "banco_ja_conectado",
      message: "Este banco já está conectado.",
    });

    const adicionadoDeNovo = await pedir(app, "POST", `/api/pluggy-connections/${conexao}/bank-items`, {
      items: [{ itemId: ITEM_A }],
    });
    expect(adicionadoDeNovo.status).toBe(409);
    expect(adicionadoDeNovo.corpo).toMatchObject({ error: "banco_ja_conectado" });
  });
});

// Conexão [TEST] Conta A com quatro bancos ativos (A, B, C e D). O nome vai junto: o falso não deduz o de todos.
async function criaConexaoComQuatroBancos(app: ReturnType<typeof appComPluggy>): Promise<string> {
  const criada = await pedir(app, "POST", "/api/pluggy-connections", {
    label: "[TEST] Conta A",
    ...CHAVES,
    items: [ITEM_A, ITEM_B, ITEM_C, ITEM_D].map((itemId) => ({
      itemId,
      institutionName: "[TEST] Banco Teste",
    })),
  });
  expect(criada.status).toBe(201);
  return (criada.corpo as CreatedConnectionResponse).connection.id;
}

describe("Meu Pluggy: outro banco da mesma conta, o limite e a prévia pela conexão (cenário 8)", () => {
  it("adiciona outro banco na mesma conexão e respeita o limite de 5 bancos ativos", async () => {
    const app = appComPluggy(pluggyFalso());
    const conexao = await criaConexaoA(app);

    const previa = await pedir(app, "POST", "/api/pluggy-connections/preview-items", {
      connectionId: conexao,
      itemIds: [ITEM_C],
    });
    expect(previa.status).toBe(200);
    expect((previa.corpo as PreviewItemsResponse).items[0]).toMatchObject({
      itemId: ITEM_C,
      summary: "poupança",
      alreadyConnected: false,
    });

    const adicionado = await pedir(app, "POST", `/api/pluggy-connections/${conexao}/bank-items`, {
      items: [{ itemId: ITEM_B }],
    });
    expect(adicionado.status).toBe(201);
    expect(adicionado.corpo).toEqual({ bankItems: [{ id: ITEM_B, institutionName: "Nubank" }] });

    const lista = (await pedir(app, "GET", "/api/pluggy-connections")).corpo as ConnectionsResponse;
    expect(lista.connections[0]?.bankItems.map((banco) => banco.id)).toEqual([ITEM_A, ITEM_B]);

    // Três bancos a mais, um deles desconectado (não conta): chega a 5 ativos; o próximo passa do limite.
    for (const id of ["lim-01", "lim-02", "lim-03"]) {
      await env.DB.prepare(
        "INSERT INTO bank_items (id, connection_id, institution_name, status, created_at) VALUES (?, ?, 'Limite', 'ativo', ?)",
      )
        .bind(id, conexao, new Date().toISOString())
        .run();
    }
    await env.DB.prepare(
      "INSERT INTO bank_items (id, connection_id, institution_name, status, disconnected_at, created_at) VALUES ('lim-desligado', ?, 'Limite', 'ativo', ?, ?)",
    )
      .bind(conexao, new Date().toISOString(), new Date().toISOString())
      .run();

    const alemDoLimite = await pedir(app, "POST", `/api/pluggy-connections/${conexao}/bank-items`, {
      items: [{ itemId: ITEM_C, institutionName: "[TEST] Poupança" }],
    });
    expect(alemDoLimite.status).toBe(422);
    expect(alemDoLimite.corpo).toMatchObject({
      error: "limite_meu_pluggy",
      message: "O Meu Pluggy gratuito aceita até 5 bancos por conta.",
    });
  });

  it("com 4 ativos, o 5º banco entra (o limite é 5, e o 5º cabe); o 6º é recusado antes de consultar o Pluggy", async () => {
    const falso = pluggyFalso();
    const app = appComPluggy(falso);
    const conexao = await criaConexaoComQuatroBancos(app);

    const quinto = await pedir(app, "POST", `/api/pluggy-connections/${conexao}/bank-items`, {
      items: [{ itemId: ITEM_SEM_BANCO, institutionName: "[TEST] Banco Teste" }],
    });
    expect(quinto.status).toBe(201);
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM bank_items WHERE connection_id = ? AND disconnected_at IS NULL",
        conexao,
      ),
    ).toBe(5);

    const chamadasAntes = falso.chamadas.length;
    const sexto = await pedir(app, "POST", `/api/pluggy-connections/${conexao}/bank-items`, {
      items: [{ itemId: ITEM_INEXISTENTE }],
    });
    expect(sexto.status).toBe(422);
    expect(sexto.corpo).toMatchObject({ error: "limite_meu_pluggy" });
    // O limite é conferido antes do Pluggy: o 6º nem chega a ser consultado.
    expect(falso.chamadas).toHaveLength(chamadasAntes);
    expect(await contagem("SELECT COUNT(*) AS n FROM bank_items WHERE connection_id = ?", conexao)).toBe(5);
  });

  it("um banco desconectado não conta no limite: com 4 ativos e 1 desconectado (5 linhas), o 5º ativo entra", async () => {
    const app = appComPluggy(pluggyFalso());
    const conexao = await criaConexaoComQuatroBancos(app);
    const agora = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO bank_items (id, connection_id, institution_name, status, disconnected_at, created_at) VALUES ('lim-desligado', ?, 'Limite', 'ativo', ?, ?)",
    )
      .bind(conexao, agora, agora)
      .run();

    const quinto = await pedir(app, "POST", `/api/pluggy-connections/${conexao}/bank-items`, {
      items: [{ itemId: ITEM_SEM_BANCO, institutionName: "[TEST] Banco Teste" }],
    });
    expect(quinto.status).toBe(201);
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM bank_items WHERE connection_id = ? AND disconnected_at IS NULL",
        conexao,
      ),
    ).toBe(5);
  });

  it("a prévia pela conexão só lê o que é desta conta: 404 para outro lar", async () => {
    const app = appComPluggy(pluggyFalso());
    const conexao = await criaConexaoA(app);
    const outro = await criaOutroLar();
    const previa = await pedir(
      app,
      "POST",
      "/api/pluggy-connections/preview-items",
      { connectionId: conexao, itemIds: [ITEM_A] },
      `mm_sess=${outro.token}`,
    );
    expect(previa.status).toBe(404);
    expect(previa.corpo).toMatchObject({ error: "conexao_nao_encontrada" });
  });
});

describe("Meu Pluggy: trocar chaves (cenários 9, 13 e 14)", () => {
  it("chave trocada recusada: 422, nada muda; chave válida: os bancos com ação necessária voltam a ativo", async () => {
    const app = appComPluggy(pluggyFalso());
    const conexao = await criaConexaoA(app);
    await env.DB.prepare("UPDATE bank_items SET status = 'acao_necessaria' WHERE id = ?").bind(ITEM_A).run();
    const antes = await env.DB.prepare(
      "SELECT client_secret_enc, client_secret_iv FROM pluggy_connections WHERE id = ?",
    )
      .bind(conexao)
      .first<{ client_secret_enc: string; client_secret_iv: string }>();

    const recusada = await pedir(app, "PUT", `/api/pluggy-connections/${conexao}/keys`, {
      clientId: CLIENT_ID_NOVO,
      clientSecret: SEGREDO_ERRADO,
    });
    expect(recusada.status).toBe(422);
    expect(
      await contagem(
        "SELECT COUNT(*) AS n FROM bank_items WHERE id = ? AND status = 'acao_necessaria'",
        ITEM_A,
      ),
    ).toBe(1);
    const depois = await env.DB.prepare(
      "SELECT client_secret_enc, client_secret_iv FROM pluggy_connections WHERE id = ?",
    )
      .bind(conexao)
      .first<{ client_secret_enc: string; client_secret_iv: string }>();
    expect(depois).toEqual(antes);

    const aceita = await pedir(app, "PUT", `/api/pluggy-connections/${conexao}/keys`, {
      clientId: CLIENT_ID_NOVO,
      clientSecret: SEGREDO_NOVO,
    });
    expect(aceita.status).toBe(200);
    expect(aceita.corpo).toEqual({ ok: true });
    expect(
      await contagem("SELECT COUNT(*) AS n FROM bank_items WHERE id = ? AND status = 'ativo'", ITEM_A),
    ).toBe(1);

    const novoSegredo = await env.DB.prepare(
      "SELECT client_secret_enc, client_secret_iv FROM pluggy_connections WHERE id = ?",
    )
      .bind(conexao)
      .first<{ client_secret_enc: string; client_secret_iv: string }>();
    expect(
      await decryptSecret(env.MASTER_KEY, `pluggy:${conexao}:client_secret`, {
        ciphertext: novoSegredo?.client_secret_enc ?? "",
        iv: novoSegredo?.client_secret_iv ?? "",
      }),
    ).toBe(SEGREDO_NOVO);
    expect(semSegredos(recusada.texto + aceita.texto)).toBe(true);
  });

  it("trocar a qualquer momento não mexe nos bancos nem no histórico", async () => {
    const app = appComPluggy(pluggyFalso());
    const conexao = await criaConexaoA(app);
    const banco = await env.DB.prepare("SELECT created_at, institution_name FROM bank_items WHERE id = ?")
      .bind(ITEM_A)
      .first<{ created_at: string; institution_name: string }>();

    const troca = await pedir(app, "PUT", `/api/pluggy-connections/${conexao}/keys`, {
      clientId: CLIENT_ID_NOVO,
      clientSecret: SEGREDO_NOVO,
    });
    expect(troca.status).toBe(200);
    const lista = (await pedir(app, "GET", "/api/pluggy-connections")).corpo as ConnectionsResponse;
    expect(lista.connections[0]?.bankItems).toEqual([
      expect.objectContaining({ id: ITEM_A, institutionName: banco?.institution_name, status: "ativo" }),
    ]);
    const depois = await env.DB.prepare("SELECT created_at FROM bank_items WHERE id = ?")
      .bind(ITEM_A)
      .first<{ created_at: string }>();
    expect(depois?.created_at).toBe(banco?.created_at);
  });

  it("sem chaves (restaurada): a lista mostra hasKeys falso, o outro banco pede as chaves, e colar de novo volta", async () => {
    const app = appComPluggy(pluggyFalso());
    const conexao = await criaConexaoA(app);
    await env.DB.prepare(
      "UPDATE pluggy_connections SET client_id_enc = NULL, iv = NULL, client_secret_enc = NULL, client_secret_iv = NULL WHERE id = ?",
    )
      .bind(conexao)
      .run();

    const lista = (await pedir(app, "GET", "/api/pluggy-connections")).corpo as ConnectionsResponse;
    expect(lista.connections[0]?.hasKeys).toBe(false);

    const semChaves = await pedir(app, "POST", `/api/pluggy-connections/${conexao}/bank-items`, {
      items: [{ itemId: ITEM_B }],
    });
    expect(semChaves.status).toBe(409);
    expect(semChaves.corpo).toMatchObject({ error: "sem_chaves" });

    const colada = await pedir(app, "PUT", `/api/pluggy-connections/${conexao}/keys`, CHAVES);
    expect(colada.status).toBe(200);
    const depois = (await pedir(app, "GET", "/api/pluggy-connections")).corpo as ConnectionsResponse;
    expect(depois.connections[0]?.hasKeys).toBe(true);
    const adicionado = await pedir(app, "POST", `/api/pluggy-connections/${conexao}/bank-items`, {
      items: [{ itemId: ITEM_B }],
    });
    expect(adicionado.status).toBe(201);
  });

  it("a troca só devolve a ativo o banco com ação necessária desta conexão: instável, outra conexão e outro lar ficam", async () => {
    const app = appComPluggy(pluggyFalso());
    const conexao = await criaConexaoA(app);
    const adicionado = await pedir(app, "POST", `/api/pluggy-connections/${conexao}/bank-items`, {
      items: [{ itemId: ITEM_C, institutionName: "[TEST] Poupança" }],
    });
    expect(adicionado.status).toBe(201);
    const outraConexao = await pedir(app, "POST", "/api/pluggy-connections", {
      label: "[TEST] Conta B",
      ...CHAVES,
      items: [{ itemId: ITEM_B }],
    });
    expect(outraConexao.status).toBe(201);
    const doOutroLar = await criaOutroLar();
    const deOutroLar = await pedir(
      app,
      "POST",
      "/api/pluggy-connections",
      {
        label: "[TEST] Conta do outro lar",
        ...CHAVES,
        items: [{ itemId: ITEM_D, institutionName: "[TEST] Banco Teste" }],
      },
      `mm_sess=${doOutroLar.token}`,
    );
    expect(deOutroLar.status).toBe(201);

    await env.DB.prepare("UPDATE bank_items SET status = 'acao_necessaria' WHERE id = ?").bind(ITEM_A).run();
    await env.DB.prepare("UPDATE bank_items SET status = 'instavel' WHERE id = ?").bind(ITEM_C).run();
    await env.DB.prepare("UPDATE bank_items SET status = 'acao_necessaria' WHERE id = ?").bind(ITEM_B).run();
    await env.DB.prepare("UPDATE bank_items SET status = 'acao_necessaria' WHERE id = ?").bind(ITEM_D).run();

    const troca = await pedir(app, "PUT", `/api/pluggy-connections/${conexao}/keys`, {
      clientId: CLIENT_ID_NOVO,
      clientSecret: SEGREDO_NOVO,
    });
    expect(troca.status).toBe(200);

    const statusDo = async (id: string) =>
      (
        await env.DB.prepare("SELECT status FROM bank_items WHERE id = ?")
          .bind(id)
          .first<{ status: string }>()
      )?.status;
    expect(await statusDo(ITEM_A)).toBe("ativo");
    expect(await statusDo(ITEM_C)).toBe("instavel");
    expect(await statusDo(ITEM_B)).toBe("acao_necessaria");
    expect(await statusDo(ITEM_D)).toBe("acao_necessaria");
  });

  it("cifra que não abre (chave mestra diferente): 409 chaves_ilegiveis na prévia", async () => {
    const app = appComPluggy(pluggyFalso());
    const conexao = await criaConexaoA(app);
    const outraMestra = { ...env, MASTER_KEY: "WlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlo=" };
    const previa = await pedir(
      app,
      "POST",
      "/api/pluggy-connections/preview-items",
      { connectionId: conexao, itemIds: [ITEM_C] },
      COOKIE_DO_TITULAR,
      outraMestra,
    );
    expect(previa.status).toBe(409);
    expect(previa.corpo).toMatchObject({ error: "chaves_ilegiveis" });
  });
});

describe("Meu Pluggy: ordem da lista", () => {
  it("com duas conexões, a lista segue a data de criação (a mais antiga primeiro), e não o rótulo nem a ordem do pedido", async () => {
    const app = appComPluggy(pluggyFalso());
    const primeira = await criaConexaoA(app);
    const segunda = await pedir(app, "POST", "/api/pluggy-connections", {
      label: "[TEST] Conta B",
      ...CHAVES,
      items: [{ itemId: ITEM_B }],
    });
    expect(segunda.status).toBe(201);
    const idDaSegunda = (segunda.corpo as CreatedConnectionResponse).connection.id;

    // A conta "B" foi criada por último, mas com a data mais antiga: a lista tem de seguir a data, não o rótulo.
    await env.DB.prepare("UPDATE pluggy_connections SET created_at = ? WHERE id = ?")
      .bind("2026-11-01T10:00:00.000Z", idDaSegunda)
      .run();
    await env.DB.prepare("UPDATE pluggy_connections SET created_at = ? WHERE id = ?")
      .bind("2026-11-02T10:00:00.000Z", primeira)
      .run();

    const lista = (await pedir(app, "GET", "/api/pluggy-connections")).corpo as ConnectionsResponse;
    expect(lista.connections.map((conexao) => conexao.label)).toEqual(["[TEST] Conta B", "[TEST] Conta A"]);
  });
});

describe("Meu Pluggy: dois parceiros, sessão e lar (cenários 11 e 12)", () => {
  it("o cônjuge vê a mesma conexão e o mesmo rótulo", async () => {
    const app = appComPluggy(pluggyFalso());
    await criaConexaoA(app);
    const doConjuge = await pedir(app, "GET", "/api/pluggy-connections", undefined, COOKIE_DO_CONJUGE);
    expect(doConjuge.status).toBe(200);
    expect((doConjuge.corpo as ConnectionsResponse).connections.map((conexao) => conexao.label)).toEqual([
      "[TEST] Conta A",
    ]);
  });

  it("sem sessão: 401 em todas as rotas novas", async () => {
    const app = appComPluggy(pluggyFalso());
    const pares: [string, string][] = [
      ["GET", "/api/pluggy-connections"],
      ["POST", "/api/pluggy-connections/test-keys"],
      ["POST", "/api/pluggy-connections/preview-items"],
      ["POST", "/api/pluggy-connections"],
      ["POST", "/api/pluggy-connections/x/bank-items"],
      ["PUT", "/api/pluggy-connections/x/keys"],
    ];
    for (const [metodo, caminho] of pares) {
      const resposta = await pedir(app, metodo, caminho, metodo === "GET" ? undefined : {}, null);
      expect(resposta.status).toBe(401);
    }
  });

  it("conexão de outro lar é 404 em todas as rotas, e a lista não mostra a de outro lar", async () => {
    const app = appComPluggy(pluggyFalso());
    const outro = await criaOutroLar();
    const cookieDoOutro = `mm_sess=${outro.token}`;
    const doOutro = await pedir(
      app,
      "POST",
      "/api/pluggy-connections",
      { label: "[TEST] Conta do outro lar", ...CHAVES, items: [{ itemId: ITEM_A }] },
      cookieDoOutro,
    );
    expect(doOutro.status).toBe(201);
    const conexaoDoOutro = (doOutro.corpo as CreatedConnectionResponse).connection.id;

    const lista = await pedir(app, "GET", "/api/pluggy-connections");
    expect((lista.corpo as ConnectionsResponse).connections).toEqual([]);

    expect(
      (
        await pedir(app, "POST", `/api/pluggy-connections/${conexaoDoOutro}/bank-items`, {
          items: [{ itemId: ITEM_B }],
        })
      ).status,
    ).toBe(404);
    expect((await pedir(app, "PUT", `/api/pluggy-connections/${conexaoDoOutro}/keys`, CHAVES)).status).toBe(
      404,
    );
    expect(
      (
        await pedir(app, "POST", "/api/pluggy-connections/preview-items", {
          connectionId: conexaoDoOutro,
          itemIds: [ITEM_B],
        })
      ).status,
    ).toBe(404);
  });
});

describe("Meu Pluggy: nada vaza e o Pluggy é chamado só pelo servidor (cenário 10)", () => {
  it("nos erros, o console não recebe o segredo, a chave nem o Client ID", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const app = appComPluggy(pluggyFalso());
    await pedir(app, "POST", "/api/pluggy-connections/test-keys", {
      clientId: CLIENT_ID_VALIDO,
      clientSecret: SEGREDO_ERRADO,
    });
    await pedir(app, "POST", "/api/pluggy-connections", {
      label: "[TEST] Conta X",
      clientId: CLIENT_ID_VALIDO,
      clientSecret: SEGREDO_ERRADO,
      items: [{ itemId: ITEM_A }],
    });
    const linhas = [...erro.mock.calls, ...aviso.mock.calls].map((args) => args.join(" "));
    for (const linha of linhas) expect(semSegredos(linha)).toBe(true);
  });

  it("uma prévia de cinco bancos faz onze chamadas ao Pluggy (o teto da spec)", async () => {
    const falso = pluggyFalso();
    const app = appComPluggy(falso);
    const previa = await pedir(app, "POST", "/api/pluggy-connections/preview-items", {
      ...CHAVES,
      itemIds: [ITEM_A, ITEM_B, ITEM_C, ITEM_D, ITEM_SEM_BANCO],
    });
    expect(previa.status).toBe(200);
    expect(falso.chamadas).toHaveLength(11);
    expect(falso.chamadas.every((chamada) => chamada.metodo === "GET" || chamada.caminho === "/auth")).toBe(
      true,
    );
  });

  it("sem a chave mestra, a criação responde 500 chave_mestra_ausente e nada é gravado", async () => {
    const app = appComPluggy(pluggyFalso());
    const semMestra = { ...env, MASTER_KEY: "" };
    const criada = await pedir(
      app,
      "POST",
      "/api/pluggy-connections",
      { label: "[TEST] Conta A", ...CHAVES, items: [{ itemId: ITEM_A }] },
      COOKIE_DO_TITULAR,
      semMestra,
    );
    expect(criada.status).toBe(500);
    expect(criada.corpo).toMatchObject({ error: "chave_mestra_ausente" });
    expect(await contagem("SELECT COUNT(*) AS n FROM pluggy_connections")).toBe(0);
  });
});
