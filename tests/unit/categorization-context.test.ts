import { describe, expect, it } from "vitest";
import {
  buildSystemBlocks,
  itemParaIA,
  type LinhaCategoria,
  type LinhaRegra,
  type LinhaRenda,
  montaContexto,
  textoDoContexto,
} from "../../src/worker/categorization/context";

const categoria = (
  id: string,
  name: string,
  parent: string | null = null,
  extra: Partial<LinhaCategoria> = {},
): LinhaCategoria => ({
  id,
  name,
  color: "#7C4DFF",
  parent_id: parent,
  ai_hint: null,
  default_spend_type: null,
  sort: 0,
  ...extra,
});

const renda = (id: string, name: string, extra: Partial<LinhaRenda> = {}): LinhaRenda => ({
  id,
  name,
  currency: "BRL",
  usual_day: 5,
  arrival: "auto",
  ...extra,
});

const regra = (id: string, extra: Partial<LinhaRegra>): LinhaRegra => ({
  id,
  scope: "estabelecimento",
  match_value: "LOJA",
  set_category_id: null,
  set_income_kind: null,
  set_income_subtype: null,
  set_fixed_income_id: null,
  created_at: "2026-11-01T00:00:00.000Z",
  ...extra,
});

const entradas = () => ({
  categorias: [
    categoria("cat-restaurantes", "Restaurantes e delivery", null, { ai_hint: "iFood e bares" }),
    categoria("cat-mercado", "Mercado"),
    categoria("cat-saude", "Saúde"),
    categoria("cat-academia", "Academia", "cat-saude"),
  ],
  rendas: [
    renda("renda-usd", "Salário em dólar", { currency: "USD", arrival: "partes" }),
    renda("renda-brl", "Salário", { arrival: "auto" }),
  ],
  regras: [regra("r-1", { match_value: "PAG*JOSEDASILVA", set_category_id: "cat-restaurantes" })],
  documento: "Pix de amigos é salário.",
});

describe("montaContexto: códigos e linhas", () => {
  it("categorias na ordem da árvore, com o caminho e a dica; subcategoria como Pai › Filha", () => {
    const ctx = montaContexto(entradas());
    const linhas = textoDoContexto(ctx).split("\n");
    expect(linhas).toContain("c2 | Restaurantes e delivery | dica: iFood e bares");
    expect(linhas.some((linha) => linha.startsWith("c3 | Saúde › Academia") || linha === "c3 | Saúde")).toBe(
      true,
    );
    expect(ctx.codigos.categorias.get("c2")).toBe("cat-restaurantes");
  });

  it("rendas com nome, moeda, dia e como chega, sem valor", () => {
    const texto = textoDoContexto(montaContexto(entradas()));
    expect(texto).toContain("r2 | Salário em dólar | USD | dia 5 | em partes: conta + Pix de terceiros");
    expect(texto).toContain("r1 | Salário | BRL | dia 5 | na conta");
  });

  it("documento vazio vira (vazio)", () => {
    const ctx = montaContexto({ ...entradas(), documento: "   " });
    expect(ctx.documento).toBe("(vazio)");
  });

  it("regra de remetente com parte do salário usa a renda fixa; destinatário só o nome, sem documento", () => {
    const ctx = montaContexto({
      ...entradas(),
      regras: [
        regra("r-rem", {
          scope: "remetente",
          match_value: "MARIANA S|123.***",
          set_income_kind: "parte_salario",
          set_fixed_income_id: "renda-usd",
        }),
        regra("r-dest", {
          scope: "destinatario",
          match_value: "JOAO P SILVA|***.456",
          set_category_id: "cat-mercado",
        }),
        regra("r-sem-renda", {
          scope: "remetente",
          match_value: "FULANO|",
          set_income_kind: "parte_salario",
          set_fixed_income_id: "renda-inexistente",
        }),
      ],
    });
    const texto = textoDoContexto(ctx);
    expect(texto).toContain('remetente "MARIANA S" → salario r2');
    expect(texto).toContain('destinatario "JOAO P SILVA" → c1');
    expect(texto).not.toContain("123.***");
    expect(texto).not.toContain("FULANO");
  });

  it("no máximo 300 regras, as mais recentes, em ordem (created_at, id)", () => {
    const muitas = Array.from({ length: 305 }, (_, i) =>
      regra(`r-${String(i).padStart(3, "0")}`, {
        match_value: `LOJA ${i}`,
        set_category_id: "cat-mercado",
        created_at: `2026-11-01T00:00:${String(i).padStart(2, "0")}.000Z`,
      }),
    );
    const ctx = montaContexto({
      ...entradas(),
      regras: muitas.map((item, i) => ({
        ...item,
        created_at: `2026-${String(10 + Math.floor(i / 100)).padStart(2, "0")}-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
      })),
    });
    expect(ctx.regras).toHaveLength(300);
  });
});

describe("buildSystemBlocks: cache estável (cenário 13)", () => {
  it("o mesmo conjunto gera o mesmo texto, mesmo com as listas embaralhadas", () => {
    const original = entradas();
    const embaralhado = {
      categorias: [...original.categorias].reverse(),
      rendas: [...original.rendas].reverse(),
      regras: [...original.regras].reverse(),
      documento: original.documento,
    };
    const a = buildSystemBlocks(montaContexto(original));
    const b = buildSystemBlocks(montaContexto(embaralhado));
    expect(b).toEqual(a);
  });

  it("mudar uma categoria muda o texto", () => {
    const a = textoDoContexto(montaContexto(entradas()));
    const trocada = entradas();
    trocada.categorias[1] = categoria("cat-mercado", "Supermercado");
    expect(textoDoContexto(montaContexto(trocada))).not.toBe(a);
  });

  it("cache_control só no último bloco; o primeiro são as instruções fixas", () => {
    const blocos = buildSystemBlocks(montaContexto(entradas()));
    expect(blocos).toHaveLength(2);
    expect(blocos[0]).not.toHaveProperty("cache_control");
    expect(blocos[1]).toMatchObject({ cache_control: { type: "ephemeral" } });
    expect(blocos[0]?.text).toContain("Você categoriza transações financeiras");
  });
});

describe("itemParaIA: a mensagem só leva dados da transação", () => {
  const base = {
    id: "tx-1",
    movement: "compra",
    amount_cents: -8900,
    card_id: "cartao",
    original_description: "PAG*JOSEDASILVA",
    custom_name: null,
    counterparty_name: null,
    counterparty_doc_masked: null,
    installment_number: 2,
    installment_total: 10,
    local_date: "2026-10-10",
  };

  it("valor sem sinal com vírgula, data, parcela e tipo", () => {
    const item = itemParaIA("t1", base);
    expect(item).toMatchObject({ ref: "t1", entrada: false });
    expect(item.payload).toMatchObject({
      tipo: "compra no cartão",
      descricao: "PAG*JOSEDASILVA",
      valor: "89,00",
      data: "2026-10-10",
      parcela: "2/10",
    });
  });

  it("Pix recebido positivo é entrada; estorno positivo não é", () => {
    expect(
      itemParaIA("t1", {
        ...base,
        movement: "pix_recebido",
        amount_cents: 500,
        installment_number: null,
        installment_total: null,
      }).entrada,
    ).toBe(true);
    expect(itemParaIA("t1", { ...base, movement: "estorno", amount_cents: 500 }).entrada).toBe(false);
  });
});
