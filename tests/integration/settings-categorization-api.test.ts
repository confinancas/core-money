import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/worker/app";
import { createDb } from "../../src/worker/db/client";
import { newMeter } from "../../src/worker/db/metered-d1";
import { saveSecret } from "../../src/worker/security/secrets";
import { aquecerOPortao, callApi, semearPronto } from "./helpers/app";
import { AGORA, criarLar, criarOutroLar, criarRegra, inserirTransacao, type Lar } from "./helpers/regras";

// Configurações › Categorias e IA (TASK-0305): GET /api/rules, o documento da IA, o estado da categorização, a edição
// de categorias e o retroativo de regra de destinatário. Tudo com D1 local e lares [TEST].

beforeEach(async () => {
  await semearPronto(env.DB);
  await aquecerOPortao(createApp({}));
});

const CHAVE_DE_TESTE = "sk-ant-TESTE-0305-chave-ficticia-nao-usar";

const appDoLar = (lar: { householdId: string; memberId: string }, agora?: () => Date) =>
  createApp({ resolveSession: async () => lar, agora });

const guardarChave = () => saveSecret(createDb(env.DB, newMeter()), env, "claude_api_key", CHAVE_DE_TESTE);

const idDaCategoria = async (lar: Lar, nome: string): Promise<string> => {
  const linha = await env.DB.prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
    .bind(lar.householdId, nome)
    .first<{ id: string }>();
  if (!linha) throw new Error(`categoria ${nome} não existe`);
  return linha.id;
};

async function valorDoBanco(sql: string, ...valores: unknown[]): Promise<string | null> {
  const linha = await env.DB.prepare(sql)
    .bind(...valores)
    .first<Record<string, string | null>>();
  return linha ? (Object.values(linha)[0] ?? null) : null;
}

const filaComErro = (transacao: string, erro: string) =>
  env.DB.prepare(
    "INSERT INTO categorization_queue (transaction_id, enqueued_at, attempts, last_error) VALUES (?, ?, 1, ?)",
  )
    .bind(transacao, AGORA, erro)
    .run();

describe("sessão obrigatória", () => {
  it("sem sessão, as rotas novas respondem 401", async () => {
    const semSessao = createApp({});
    expect((await callApi(semSessao, "GET", "/api/rules")).status).toBe(401);
    expect((await callApi(semSessao, "GET", "/api/ai-rules-document")).status).toBe(401);
    expect(
      (await callApi(semSessao, "PUT", "/api/ai-rules-document", { text: "x", baseUpdatedAt: null })).status,
    ).toBe(401);
    expect((await callApi(semSessao, "GET", "/api/categorization/status")).status).toBe(401);
  });
});

describe("GET /api/rules", () => {
  it("cenário 6: escopo e busca, só regras ativas e só do lar", async () => {
    const lar = await criarLar();
    await criarRegra(lar, { scope: "estabelecimento", matchValue: "[TEST] PADARIA", createdFrom: "lembrar" });
    await criarRegra(lar, {
      scope: "destinatario",
      matchValue: "[TEST] JOAO|***",
      createdFrom: "confirmacao",
    });
    await criarRegra(lar, { scope: "remetente", matchValue: "[TEST] MARIA|***", createdFrom: "manual" });
    await criarRegra(lar, {
      scope: "destinatario",
      matchValue: "[TEST] ANTIGA|***",
      createdFrom: "confirmacao",
      disabledAt: AGORA,
    });
    const app = appDoLar(lar);

    const todas = (await (await callApi(app, "GET", "/api/rules")).json()) as {
      total: number;
      items: unknown[];
    };
    expect(todas.total).toBe(3);
    expect(todas.items).toHaveLength(3);

    const pixEnviados = (await (
      await callApi(app, "GET", "/api/rules?escopo=destinatario&busca=joao")
    ).json()) as { total: number; items: Array<{ matchLabel: string; scope: string }> };
    expect(pixEnviados.total).toBe(1);
    expect(pixEnviados.items[0]).toMatchObject({ matchLabel: "[TEST] JOAO", scope: "destinatario" });
    expect(JSON.stringify(pixEnviados)).not.toContain("***");

    const remetenteJoao = (await (
      await callApi(app, "GET", "/api/rules?escopo=remetente&busca=joao")
    ).json()) as { total: number };
    expect(remetenteJoao.total).toBe(0);
    expect((await callApi(app, "GET", "/api/rules?escopo=arvore")).status).toBe(400);
    expect((await callApi(app, "GET", "/api/rules?cursor=nao-e-cursor-valido!")).status).toBe(400);
  });

  it("pagina de 50 com cursor opaco", async () => {
    const lar = await criarLar();
    for (let i = 0; i < 53; i++) {
      await criarRegra(lar, {
        scope: "estabelecimento",
        matchValue: `[TEST] LOJA ${i}`,
        createdFrom: "lembrar",
      });
    }
    const app = appDoLar(lar);
    const primeira = (await (await callApi(app, "GET", "/api/rules")).json()) as {
      total: number;
      items: unknown[];
      nextCursor: string | null;
    };
    expect(primeira.total).toBe(53);
    expect(primeira.items).toHaveLength(50);
    expect(primeira.nextCursor).not.toBeNull();
    const segunda = (await (
      await callApi(app, "GET", `/api/rules?cursor=${encodeURIComponent(primeira.nextCursor ?? "")}`)
    ).json()) as { items: unknown[]; nextCursor: string | null };
    expect(segunda.items).toHaveLength(3);
    expect(segunda.nextCursor).toBeNull();
  });

  it("cenário 11: lar sem regras, lista vazia", async () => {
    const lar = await criarLar();
    const corpo = (await (await callApi(appDoLar(lar), "GET", "/api/rules")).json()) as {
      total: number;
      items: unknown[];
    };
    expect(corpo).toMatchObject({ total: 0, items: [] });
  });

  it("cenário 12: o lar B não vê as regras nem o documento do lar A", async () => {
    const lar = await criarLar();
    const outro = await criarOutroLar();
    await criarRegra(lar, { scope: "estabelecimento", matchValue: "[TEST] SO DO A", createdFrom: "lembrar" });
    const appA = appDoLar(lar);
    await callApi(appA, "PUT", "/api/ai-rules-document", {
      text: "[TEST] documento do lar A",
      baseUpdatedAt: null,
    });

    const appB = appDoLar(outro);
    const regrasB = (await (await callApi(appB, "GET", "/api/rules")).json()) as { total: number };
    expect(regrasB.total).toBe(0);
    const documentoB = (await (await callApi(appB, "GET", "/api/ai-rules-document")).json()) as {
      text: string;
    };
    expect(documentoB).toEqual({ text: "", updatedAt: null });
  });

  it("apply-retroactive: destinatário e remetente dão 422; estabelecimento segue", async () => {
    const lar = await criarLar();
    const dest = await criarRegra(lar, {
      scope: "destinatario",
      matchValue: "[TEST] MARIA|***",
      createdFrom: "confirmacao",
    });
    const rem = await criarRegra(lar, {
      scope: "remetente",
      matchValue: "[TEST] ANA|***",
      createdFrom: "manual",
    });
    const estab = await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: "[TEST] MERCADO",
      createdFrom: "lembrar",
    });
    const app = appDoLar(lar);
    expect((await callApi(app, "POST", `/api/rules/${dest}/apply-retroactive`)).status).toBe(422);
    expect((await callApi(app, "POST", `/api/rules/${rem}/apply-retroactive`)).status).toBe(422);
    expect((await callApi(app, "POST", `/api/rules/${estab}/apply-retroactive`)).status).toBe(200);
  });
});

describe("cenário 7: desfazer regra", () => {
  it("some da lista e a contagem cai; as compras antigas ficam como estavam", async () => {
    const lar = await criarLar();
    const servicos = await idDaCategoria(lar, "Serviços");
    const regra = await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: "PAG JOSEDASILVA",
      setCategoryId: servicos,
      createdFrom: "aplicar_todas",
    });
    const compra = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -4590,
      descricao: "PAG*JOSEDASILVA",
      categoryId: servicos,
      categorizedBy: "rule",
      ruleId: regra,
    });
    const app = appDoLar(lar);
    expect(((await (await callApi(app, "GET", "/api/rules")).json()) as { total: number }).total).toBe(1);

    expect((await callApi(app, "DELETE", `/api/rules/${regra}`)).status).toBe(204);

    expect(((await (await callApi(app, "GET", "/api/rules")).json()) as { total: number }).total).toBe(0);
    expect(await valorDoBanco("SELECT category_id FROM transactions WHERE id = ?", compra)).toBe(servicos);
  });
});

describe("GET /api/categorization/status", () => {
  it("cenário 1: contagens e chave ausente", async () => {
    const lar = await criarLar();
    await criarRegra(lar, { scope: "estabelecimento", matchValue: "[TEST] A", createdFrom: "lembrar" });
    await criarRegra(lar, { scope: "estabelecimento", matchValue: "[TEST] B", createdFrom: "lembrar" });
    const corpo = (await (
      await callApi(appDoLar(lar), "GET", "/api/categorization/status")
    ).json()) as Record<string, unknown>;
    expect(corpo).toMatchObject({
      categoriesCount: 15,
      activeRulesCount: 2,
      keyMasked: null,
      keyState: "sem_chave",
      model: null,
    });
  });

  it("cenário 13: com a chave, só a máscara sai, nunca a chave inteira", async () => {
    const lar = await criarLar();
    await guardarChave();
    const texto = await (await callApi(appDoLar(lar), "GET", "/api/categorization/status")).text();
    expect(texto).not.toContain(CHAVE_DE_TESTE);
    expect(texto).not.toContain("TESTE-0305");
    const corpo = JSON.parse(texto) as { keyState: string; keyMasked: string; model: string };
    expect(corpo).toMatchObject({ keyState: "ok", model: "claude-haiku-5-5" });
    expect(corpo.keyMasked.startsWith("sk-ant-")).toBe(true);
  });

  it("cenário 2: last_error 'chave' na fila vira problema_chave, e volta a ok sem a fila", async () => {
    const lar = await criarLar();
    await guardarChave();
    const transacao = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -1000,
      descricao: "[TEST] X",
    });
    await filaComErro(transacao, "chave");
    const app = appDoLar(lar);
    const comErro = (await (await callApi(app, "GET", "/api/categorization/status")).json()) as {
      keyState: string;
    };
    expect(comErro.keyState).toBe("problema_chave");

    await env.DB.prepare("DELETE FROM categorization_queue WHERE transaction_id = ?").bind(transacao).run();
    const depois = (await (await callApi(app, "GET", "/api/categorization/status")).json()) as {
      keyState: string;
    };
    expect(depois.keyState).toBe("ok");
  });

  it("N17: chave nova há pouco com erro na fila tem chaveNovaRecente; chave antiga, não", async () => {
    const lar = await criarLar();
    await guardarChave();
    const transacao = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -1000,
      descricao: "[TEST] Y",
    });
    await filaComErro(transacao, "chave");
    const recente = (await (await callApi(appDoLar(lar), "GET", "/api/categorization/status")).json()) as {
      chaveNovaRecente: boolean;
    };
    expect(recente.chaveNovaRecente).toBe(true);
    await env.DB.prepare("UPDATE app_secrets SET updated_at = ? WHERE name = 'claude_api_key'")
      .bind("2026-01-01T00:00:00.000Z")
      .run();
    const antiga = (await (await callApi(appDoLar(lar), "GET", "/api/categorization/status")).json()) as {
      chaveNovaRecente: boolean;
    };
    expect(antiga.chaveNovaRecente).toBe(false);
  });

  it("cenário 3: last_error 'indisponivel' vira indisponivel", async () => {
    const lar = await criarLar();
    await guardarChave();
    const transacao = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -1000,
      descricao: "[TEST] Z",
    });
    await filaComErro(transacao, "indisponivel");
    const corpo = (await (await callApi(appDoLar(lar), "GET", "/api/categorization/status")).json()) as {
      keyState: string;
    };
    expect(corpo.keyState).toBe("indisponivel");
  });

  it("N8: chave ilegível vira problema_chave, mesmo sem last_error, e sem máscara", async () => {
    const lar = await criarLar();
    await guardarChave();
    await env.DB.prepare(
      "UPDATE app_secrets SET ciphertext = 'AAAA', iv = 'AAAA' WHERE name = 'claude_api_key'",
    ).run();
    const corpo = (await (await callApi(appDoLar(lar), "GET", "/api/categorization/status")).json()) as {
      keyState: string;
      keyMasked: string | null;
    };
    expect(corpo.keyState).toBe("problema_chave");
    expect(corpo.keyMasked).toBeNull();
  });

  it("erro da fila de outro lar não muda o estado do lar", async () => {
    const lar = await criarLar();
    const outro = await criarOutroLar();
    const transacao = await inserirTransacao(
      { ...lar, householdId: outro.householdId, memberId: outro.memberId },
      {
        movement: "compra",
        amountCents: -1000,
        descricao: "[TEST] W",
      },
    );
    await filaComErro(transacao, "chave");
    await guardarChave();
    const corpo = (await (await callApi(appDoLar(lar), "GET", "/api/categorization/status")).json()) as {
      keyState: string;
    };
    expect(corpo.keyState).toBe("ok");
  });
});

describe("GET e PUT /api/ai-rules-document", () => {
  it("cenários 8 e 9: salva; a gravação com a base antiga dá 409 com a versão salva", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const primeira = await callApi(app, "PUT", "/api/ai-rules-document", {
      text: "  [TEST] Pix para a diarista é Serviços  ",
      baseUpdatedAt: null,
    });
    expect(primeira.status).toBe(200);
    const salvo = (await primeira.json()) as { text: string; updatedAt: string };
    expect(salvo.text).toBe("[TEST] Pix para a diarista é Serviços");
    expect(Number.isNaN(Date.parse(salvo.updatedAt))).toBe(false);

    // Outra pessoa (B) tinha lido a versão sem texto: a gravação dela com base nula não passa.
    const conflito = await callApi(app, "PUT", "/api/ai-rules-document", {
      text: "[TEST] de B",
      baseUpdatedAt: null,
    });
    expect(conflito.status).toBe(409);
    const corpoConflito = (await conflito.json()) as {
      error: string;
      current: { text: string; updatedAt: string };
    };
    expect(corpoConflito.error).toBe("conflito");
    expect(corpoConflito.current).toEqual({ text: salvo.text, updatedAt: salvo.updatedAt });

    // Com a base atual, a gravação passa.
    const ok = await callApi(app, "PUT", "/api/ai-rules-document", {
      text: "[TEST] de A, depois de ver a versão",
      baseUpdatedAt: salvo.updatedAt,
    });
    expect(ok.status).toBe(200);
    const lido = (await (await callApi(app, "GET", "/api/ai-rules-document")).json()) as { text: string };
    expect(lido.text).toBe("[TEST] de A, depois de ver a versão");
  });

  it("cenário 10: 4.001 caracteres dão 422 e nada é gravado", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const r = await callApi(app, "PUT", "/api/ai-rules-document", {
      text: "a".repeat(4001),
      baseUpdatedAt: null,
    });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { fields: { text: string } }).fields.text).toBe("Use até 4.000 caracteres.");
    const lido = (await (await callApi(app, "GET", "/api/ai-rules-document")).json()) as { text: string };
    expect(lido.text).toBe("");
  });

  it("corpo inválido dá 400", async () => {
    const lar = await criarLar();
    expect((await callApi(appDoLar(lar), "PUT", "/api/ai-rules-document", { text: 1 })).status).toBe(400);
  });
});

describe("categorias: arquivada debaixo de subcategoria e a cascata", () => {
  it("não deixa mover uma principal com subcategorias arquivadas para dentro de outra", async () => {
    const lar = await criarLar();
    const app = appDoLar(lar);
    const saude = await idDaCategoria(lar, "Saúde");
    const lazer = await idDaCategoria(lar, "Lazer");
    expect((await callApi(app, "PATCH", `/api/categories/${saude}`, { archived: true })).status).toBe(200);
    const movida = await callApi(app, "PATCH", `/api/categories/${saude}`, { parentId: lazer });
    expect(movida.status).toBe(422);
    expect(((await movida.json()) as { fields: { parentId: string } }).fields.parentId).toBe(
      "Uma categoria com subcategorias não pode ficar dentro de outra.",
    );
  });

  it("a cascata não reescreve o archived_at de uma subcategoria já arquivada", async () => {
    const lar = await criarLar();
    const academia = await idDaCategoria(lar, "Academia");
    const saude = await idDaCategoria(lar, "Saúde");
    const t0 = "2026-11-01T10:00:00.000Z";
    const t1 = "2026-11-05T10:00:00.000Z";
    await callApi(
      appDoLar(lar, () => new Date(t0)),
      "PATCH",
      `/api/categories/${academia}`,
      { archived: true },
    );
    expect(await valorDoBanco("SELECT archived_at FROM categories WHERE id = ?", academia)).toBe(t0);

    await callApi(
      appDoLar(lar, () => new Date(t1)),
      "PATCH",
      `/api/categories/${saude}`,
      { archived: true },
    );
    expect(await valorDoBanco("SELECT archived_at FROM categories WHERE id = ?", academia)).toBe(t0);
    expect(await valorDoBanco("SELECT archived_at FROM categories WHERE id = ?", saude)).toBe(t1);
  });
});

describe("F1: renomear pela API não muda o tipo padrão nem o das transações", () => {
  it("PATCH só com o nome deixa default_spend_type e o tipo das transações como estavam", async () => {
    const lar = await criarLar();
    const restaurantes = await idDaCategoria(lar, "Restaurantes e delivery");
    const tipoPadrao = await valorDoBanco("SELECT default_spend_type FROM categories WHERE id = ?", restaurantes);
    const compra = await inserirTransacao(lar, {
      movement: "compra",
      amountCents: -3000,
      descricao: "[TEST] RESTAURANTE 0305",
      categoryId: restaurantes,
      spendType: "prazeres",
      spendTypeSource: "categoria",
    });
    const app = appDoLar(lar);
    const r = await callApi(app, "PATCH", `/api/categories/${restaurantes}`, { name: "[TEST] Restaurantes 0305" });
    expect(r.status).toBe(200);
    expect(await valorDoBanco("SELECT default_spend_type FROM categories WHERE id = ?", restaurantes)).toBe(tipoPadrao);
    expect(await valorDoBanco("SELECT spend_type FROM transactions WHERE id = ?", compra)).toBe("prazeres");
  });
});
