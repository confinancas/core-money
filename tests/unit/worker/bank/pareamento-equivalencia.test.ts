// TASK-0208: o pareamento indexado por dia dá o mesmo resultado do pareamento antigo (comparação com o grupo inteiro de
// mesmo valor), inclusive na ordem de desempate (menor distância, depois o menor id). A função antiga está copiada aqui
// como referência. Também prova que o custo deixou de crescer par a par.
import { describe, expect, it } from "vitest";
import {
  diaNumero,
  type LinhaClassificavel,
  pairBillPayments,
  pairTransfers,
  parearGuloso,
} from "../../../../src/worker/bank/classify-rules";

type Pareavel = Pick<LinhaClassificavel, "id" | "local_date" | "amount_cents">;

// ---- Referência: o pareamento de antes da TASK-0208 (copiado sem mudança de lógica) ----
const ordemDePar = (a: Pareavel, b: Pareavel): number => {
  if (a.local_date !== b.local_date) return a.local_date < b.local_date ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

function parearGulosoAntigo<T extends Pareavel>(
  candidatos: readonly T[],
  podePar: (a: T, b: T) => boolean,
  maxDias: number,
): Array<[T, T]> {
  const porValor = new Map<number, T[]>();
  for (const candidato of candidatos) {
    const valor = Math.abs(candidato.amount_cents);
    const grupo = porValor.get(valor);
    if (grupo) grupo.push(candidato);
    else porValor.set(valor, [candidato]);
  }

  const pares: Array<[T, T]> = [];
  for (const grupo of porValor.values()) {
    grupo.sort(ordemDePar);
    const usados = new Set<string>();
    for (const a of grupo) {
      if (usados.has(a.id)) continue;
      let melhor: T | null = null;
      let melhorDistancia = Number.POSITIVE_INFINITY;
      for (const b of grupo) {
        if (b === a || usados.has(b.id)) continue;
        const distancia = Math.abs(diaNumero(a.local_date) - diaNumero(b.local_date));
        if (distancia > maxDias || !podePar(a, b)) continue;
        if (
          distancia < melhorDistancia ||
          (distancia === melhorDistancia && melhor !== null && b.id < melhor.id)
        ) {
          melhor = b;
          melhorDistancia = distancia;
        }
      }
      if (melhor !== null) {
        usados.add(a.id);
        usados.add(melhor.id);
        pares.push([a, melhor]);
      }
    }
  }
  return pares;
}

const temProva = (linha: LinhaClassificavel, cpfs: ReadonlySet<string>): boolean => {
  if ((linha.provider_category ?? "").startsWith("Same person transfer")) return true;
  return linha.counterparty_doc_masked !== null && cpfs.has(linha.counterparty_doc_masked);
};

function pairBillPaymentsAntigo(
  cartoes: readonly LinhaClassificavel[],
  saidas: readonly LinhaClassificavel[],
) {
  const ehCartao = (linha: LinhaClassificavel): boolean => linha.card_id !== null;
  return parearGulosoAntigo([...cartoes, ...saidas], (a, b) => ehCartao(a) !== ehCartao(b), 5).map(
    ([a, b]) => (ehCartao(a) ? { cartao: a.id, banco: b.id } : { cartao: b.id, banco: a.id }),
  );
}

function pairTransfersAntigo(
  saidas: readonly LinhaClassificavel[],
  entradas: readonly LinhaClassificavel[],
  cpfsDoLar: readonly string[],
) {
  const cpfs = new Set(cpfsDoLar);
  return parearGulosoAntigo(
    [...saidas, ...entradas],
    (a, b) =>
      a.account_id !== b.account_id &&
      a.amount_cents < 0 !== b.amount_cents < 0 &&
      (temProva(a, cpfs) || temProva(b, cpfs)),
    2,
  ).map(([a, b]) => (a.amount_cents < 0 ? { saida: a.id, entrada: b.id } : { saida: b.id, entrada: a.id }));
}

// ---- Gerador de lotes (determinístico, com semente) ----
function aleatorio(semente: number): () => number {
  let estado = semente >>> 0;
  return () => {
    estado = (Math.imul(estado, 1664525) + 1013904223) >>> 0;
    return estado / 2 ** 32;
  };
}

const CPF = "***.456.789-**";

function linhaDe(
  id: string,
  extra: Partial<LinhaClassificavel> & { local_date: string; amount_cents: number },
): LinhaClassificavel {
  return {
    id,
    account_id: "conta-a",
    card_id: null,
    movement: "pix_enviado",
    movement_original: null,
    movement_locked: 0,
    hidden: 0,
    removed_at: null,
    categorized_by: null,
    categorized_at: null,
    rule_id: null,
    income_kind: null,
    income_subtype: null,
    original_description: "[TEST]",
    provider_category: null,
    provider_operation_type: null,
    counterparty_doc_masked: null,
    ...extra,
  };
}

const diaTexto = (n: number): string => new Date((20_000 + n) * 86_400_000).toISOString().slice(0, 10);

// Valores repetidos (poucos valores), 4 contas, 2 cartões, datas em 30 dias e ids fora da ordem das datas.
function lote(semente: number, tamanho: number) {
  const sorteio = aleatorio(semente);
  const escolhe = <T>(lista: readonly T[]): T => lista[Math.floor(sorteio() * lista.length)] as T;
  const valores = [1000, 2500, 2500, 9990, 15000];
  const contas = ["conta-a", "conta-b", "conta-c", "conta-d"];
  const cartoes = ["cartao-1", "cartao-2"];
  const ids = Array.from({ length: tamanho }, (_, i) => `id-${String(i).padStart(4, "0")}`);
  // Embaralha os ids: a ordem de desempate (menor id) não pode coincidir com a ordem das datas.
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(sorteio() * (i + 1));
    [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
  }
  const cartoesDoLote: LinhaClassificavel[] = [];
  const saidas: LinhaClassificavel[] = [];
  const entradas: LinhaClassificavel[] = [];
  for (const id of ids) {
    const local_date = diaTexto(Math.floor(sorteio() * 30));
    const valor = escolhe(valores);
    const tipo = sorteio();
    if (tipo < 0.25) {
      cartoesDoLote.push(
        linhaDe(id, { local_date, amount_cents: valor, card_id: escolhe(cartoes), account_id: null }),
      );
    } else if (tipo < 0.65) {
      saidas.push(
        linhaDe(id, {
          local_date,
          amount_cents: -valor,
          account_id: escolhe(contas),
          provider_category: sorteio() < 0.3 ? "Same person transfer - PIX" : null,
          counterparty_doc_masked: sorteio() < 0.3 ? CPF : null,
        }),
      );
    } else {
      entradas.push(
        linhaDe(id, {
          local_date,
          amount_cents: valor,
          account_id: escolhe(contas),
          movement: "pix_recebido",
          provider_category: sorteio() < 0.3 ? "Same person transfer - PIX" : null,
          counterparty_doc_masked: sorteio() < 0.3 ? CPF : null,
        }),
      );
    }
  }
  return { cartoes: cartoesDoLote, saidas, entradas };
}

describe("pareamento indexado: mesmo resultado do pareamento antigo (TASK-0208)", () => {
  it("R2 (pairBillPayments): 300 lotes gerados dão os mesmos pares, na mesma ordem", () => {
    let comPares = 0;
    for (let semente = 1; semente <= 300; semente++) {
      const { cartoes, saidas } = lote(semente, 20 + (semente % 60));
      const novo = pairBillPayments(cartoes, saidas);
      expect(novo).toEqual(pairBillPaymentsAntigo(cartoes, saidas));
      comPares += novo.length;
    }
    // O gerador forma pares de verdade (o teste não passa por vazio).
    expect(comPares).toBeGreaterThan(500);
  });

  it("R3 (pairTransfers): 300 lotes gerados dão os mesmos pares, na mesma ordem", () => {
    let comPares = 0;
    for (let semente = 1; semente <= 300; semente++) {
      const { saidas, entradas } = lote(1000 + semente, 20 + (semente % 60));
      const novo = pairTransfers(saidas, entradas, { cpfsDoLar: [CPF] });
      expect(novo).toEqual(pairTransfersAntigo(saidas, entradas, [CPF]));
      comPares += novo.length;
    }
    expect(comPares).toBeGreaterThan(200);
  });

  it("desempate: duas candidatas no mesmo dia (mesma distância), vence o menor id", () => {
    const saida = linhaDe("m-5", { local_date: "2026-11-10", amount_cents: -5000 });
    const mesmoDia = linhaDe("z-1", {
      local_date: "2026-11-11",
      amount_cents: 5000,
      account_id: "conta-b",
      counterparty_doc_masked: CPF,
    });
    const depois = linhaDe("a-9", {
      local_date: "2026-11-11",
      amount_cents: 5000,
      account_id: "conta-b",
      counterparty_doc_masked: CPF,
    });
    const novo = pairTransfers([saida], [mesmoDia, depois], { cpfsDoLar: [CPF] });
    expect(novo).toEqual(pairTransfersAntigo([saida], [mesmoDia, depois], [CPF]));
    expect(novo).toEqual([{ saida: "m-5", entrada: "a-9" }]);
  });

  it("encadeamento guloso: a primeira linha por (data, id) pega o par mais próximo e deixa a outra sem par", () => {
    // Três linhas do mesmo valor: a primeira pareia com a do meio; a terceira fica livre.
    const a = linhaDe("a", { local_date: "2026-11-10", amount_cents: -700, account_id: "conta-a" });
    const b = linhaDe("b", {
      local_date: "2026-11-11",
      amount_cents: 700,
      account_id: "conta-b",
      counterparty_doc_masked: CPF,
    });
    const c = linhaDe("c", {
      local_date: "2026-11-12",
      amount_cents: -700,
      account_id: "conta-a",
      counterparty_doc_masked: CPF,
    });
    const novo = pairTransfers([a, c], [b], { cpfsDoLar: [CPF] });
    expect(novo).toEqual(pairTransfersAntigo([a, c], [b], [CPF]));
    expect(novo).toEqual([{ saida: "a", entrada: "b" }]);
  });
});

describe("pareamento indexado: o custo não cresce par a par (TASK-0208)", () => {
  // Lê local_date por um acessor que conta: cada comparação entre duas linhas passa por ele.
  function comContador(n: number) {
    const contador = { leituras: 0 };
    const linhas = Array.from({ length: n }, (_, i) => {
      const data = diaTexto(i); // um dia por linha: o valor é o mesmo para todas, e a janela é de poucos dias
      return {
        id: `id-${String(i).padStart(4, "0")}`,
        amount_cents: 4200,
        account_id: i % 2 === 0 ? "conta-a" : "conta-b",
        get local_date(): string {
          contador.leituras++;
          return data;
        },
      };
    });
    return { contador, linhas };
  }
  const podePar = (a: { account_id: string }, b: { account_id: string }): boolean =>
    a.account_id !== b.account_id;

  it("400 linhas de mesmo valor: leituras de data proporcionais a n, e o antigo as tinha ao quadrado", () => {
    const novo = comContador(400);
    const paresNovos = parearGuloso(novo.linhas, podePar, 2);
    const antigo = comContador(400);
    const paresAntigos = parearGulosoAntigo(antigo.linhas, podePar, 2);

    expect(paresNovos.map(([a, b]) => [a.id, b.id])).toEqual(paresAntigos.map(([a, b]) => [a.id, b.id]));
    expect(paresNovos.length).toBe(200);
    // O antigo lia a data de cada par possível (cerca de n ao quadrado); o novo lê n vezes uma constante pequena.
    expect(antigo.contador.leituras).toBeGreaterThan(50_000);
    expect(novo.contador.leituras).toBeLessThan(400 * 30);
  });

  it("o custo dobra com o tamanho, não quadruplica", () => {
    const pequeno = comContador(200);
    parearGuloso(pequeno.linhas, podePar, 2);
    const grande = comContador(400);
    parearGuloso(grande.linhas, podePar, 2);
    expect(grande.contador.leituras / pequeno.contador.leituras).toBeLessThan(2.6);
  });
});
