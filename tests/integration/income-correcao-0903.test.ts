import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/worker/app";
import { processNewTransactions } from "../../src/worker/categorization/pipeline";
import { classifyIncomeStmts } from "../../src/worker/income/classification";
import { aquecerOPortao, semearPronto } from "./helpers/app";
import {
  appDoLar,
  chamar,
  criarPix,
  criarRenda,
  dbDeTeste,
  linhaDa,
  prepararCiclos,
  recebimentosDa,
  sugerir,
} from "./helpers/pix-recebido";
import { AGORA, contar, criarLar } from "./helpers/regras";

// Rodada de correção da TASK-0903: cenário 11 sem corrida, aceite e desfazer de entradas do mesmo remetente, prévia numa
// transação oculta por outro motivo e o 422 de opção. Dados [TEST].

beforeEach(async () => {
  await semearPronto(env.DB);
  await aquecerOPortao(createApp({}));
});

const url = (id: string) => `/api/transactions/${id}/income-classification`;

describe("cenário 11: duas gravações ao mesmo tempo no mesmo Pix", () => {
  // Escolha adotada: a troca sempre apaga o recebimento da transação, dentro do mesmo lote atômico do D1. Vale a última
  // gravação, sem 409 e sem lote condicional ao estado lido antes (que a outra gravação pode ter mudado).
  for (const ordem of [
    ["salario", "variavel"],
    ["variavel", "salario"],
  ] as const) {
    it(`ordem ${ordem.join(" e ")}: variável nunca convive com recebimento, e a renda do ciclo não dobra`, async () => {
      const lar = await criarLar();
      await prepararCiclos(lar);
      const renda = await criarRenda(lar, "[TEST] Salário");
      const pix = await criarPix(lar, 150_000);
      const app = appDoLar(lar);
      const corpos = {
        salario: { option: "salario", fixedIncomeId: renda, remember: false },
        variavel: { option: "variavel", incomeSubtype: "venda", remember: false },
      };

      const respostas = await Promise.all(ordem.map((opcao) => chamar(app, "PUT", url(pix), corpos[opcao])));

      expect(respostas.map((r) => r.status)).toEqual([200, 200]);
      const linha = await linhaDa(pix);
      const recebimentos = await recebimentosDa(pix);
      if (linha?.income_kind === "variavel") expect(recebimentos).toHaveLength(0);
      else {
        expect(linha?.income_kind).toBe("parte_salario");
        expect(recebimentos).toHaveLength(1);
      }
      const leitura = await chamar(app, "GET", url(pix));
      expect(leitura.corpo.cycleIncomeCents).toBe(150_000);
    });
  }

  it("leitura velha: a troca para variável apaga o recebimento mesmo que a leitura não o tenha visto", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const renda = await criarRenda(lar, "[TEST] Salário");
    const pix = await criarPix(lar, 150_000);
    const app = appDoLar(lar);
    await chamar(app, "PUT", url(pix), { option: "salario", fixedIncomeId: renda, remember: false });
    expect(await recebimentosDa(pix)).toHaveLength(1);

    // O que a outra gravação leu antes de a primeira terminar: a entrada ainda sem classificação.
    const medidor = dbDeTeste();
    await medidor.$client.batch(
      classifyIncomeStmts(medidor, lar.householdId, {
        linha: {
          id: pix,
          amount_cents: 150_000,
          local_date: "2026-10-20",
          cycle_key: "2026-10",
          income_kind: null,
          fixed_income_id: null,
          hidden_reason: null,
        },
        classificacao: { option: "variavel", fixedIncomeId: null, incomeSubtype: "venda" },
        by: lar.memberId,
        confirmedBy: lar.memberId,
        ruleId: null,
        agora: AGORA,
        modo: "trocar",
      }),
    );

    expect((await linhaDa(pix))?.income_kind).toBe("variavel");
    expect(await recebimentosDa(pix)).toHaveLength(0);
  });
});

async function doisDoMesmoRemetente(lar: Awaited<ReturnType<typeof criarLar>>) {
  const renda = await criarRenda(lar, "[TEST] Salário em dólar");
  const a = await criarPix(lar, 100_000);
  const b = await criarPix(lar, 150_000, "[TEST] Fulana", { dia: "2026-10-21" });
  await sugerir(a, { kind: "parte_salario", rendaId: renda });
  await sugerir(b, { kind: "parte_salario", rendaId: renda });
  return { renda, a, b };
}

describe("aceite e desfazer de dois Pix do mesmo remetente", () => {
  it("um é aceito e o outro é resolvido como igual (nunca os dois), sem recebimento de sobra", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const { a, b, renda } = await doisDoMesmoRemetente(lar);
    const app = appDoLar(lar);

    const aceite = await chamar(app, "POST", "/api/categorization/accept", { transactionIds: [a, b] });

    expect(aceite.status).toBe(200);
    const aceitos = aceite.corpo.accepted.map((x: { transactionId: string }) => x.transactionId);
    const iguais = aceite.corpo.alsoResolved.map((x: { transactionId: string }) => x.transactionId);
    expect(aceitos).toHaveLength(1);
    expect(iguais).toHaveLength(1);
    expect(aceitos[0]).not.toBe(iguais[0]);
    expect(aceite.corpo.skipped).toEqual([]);
    const regraDoAceito = aceite.corpo.accepted[0].ruleId as string;
    expect(regraDoAceito).toBeTruthy();
    expect(aceite.corpo.alsoResolved[0].ruleId).toBe(regraDoAceito);

    const doIgual = await linhaDa(iguais[0]);
    expect(doIgual?.categorized_by).toBe("regra");
    expect(doIgual?.rule_id).toBe(regraDoAceito);
    expect(await recebimentosDa(aceitos[0])).toEqual([
      { fixed_income_id: renda, confirmed_by: lar.memberId },
    ]);
    expect(await recebimentosDa(iguais[0])).toEqual([{ fixed_income_id: renda, confirmed_by: "regra" }]);

    const leitura = await chamar(app, "GET", url(aceitos[0]));
    expect(leitura.corpo.cycleIncomeCents).toBe(250_000);
  });

  it("o desfazer devolve os dois à fila, sem recebimento nem regra (cenário 17)", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const { a, b } = await doisDoMesmoRemetente(lar);
    const app = appDoLar(lar);
    const aceite = await chamar(app, "POST", "/api/categorization/accept", { transactionIds: [a, b] });
    const itens = [
      ...aceite.corpo.accepted.map((x: { transactionId: string }) => x.transactionId),
      ...aceite.corpo.alsoResolved.map((x: { transactionId: string }) => x.transactionId),
    ].map((transactionId) => ({ transactionId, categoryId: null }));

    const desfeito = await chamar(app, "POST", "/api/categorization/undo", { items: itens });

    expect(desfeito.status).toBe(200);
    for (const id of [a, b]) {
      expect((await linhaDa(id))?.income_kind).toBeNull();
      expect((await linhaDa(id))?.categorized_at).toBeNull();
      expect(await recebimentosDa(id)).toHaveLength(0);
    }
    expect(
      await contar("SELECT COUNT(*) AS total FROM rules WHERE scope = 'remetente' AND disabled_at IS NULL"),
    ).toBe(0);
    expect((await chamar(app, "GET", url(a))).corpo.cycleIncomeCents).toBe(0);
  });

  it("desfazer só a aceita (sem o igual na lista) também tira o igual da mesma confirmação", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const { a, b } = await doisDoMesmoRemetente(lar);
    const app = appDoLar(lar);
    const aceite = await chamar(app, "POST", "/api/categorization/accept", { transactionIds: [a, b] });
    const aceita = aceite.corpo.accepted[0].transactionId as string;
    const igual = aceite.corpo.alsoResolved[0].transactionId as string;

    await chamar(app, "POST", "/api/categorization/undo", {
      items: [{ transactionId: aceita, categoryId: null }],
    });

    expect((await linhaDa(igual))?.income_kind).toBeNull();
    expect(await recebimentosDa(igual)).toHaveLength(0);
    expect(await recebimentosDa(aceita)).toHaveLength(0);
  });
});

describe("desfazer não tira o que a regra classificou depois (item 6)", () => {
  it("o Pix que a importação classificou pela regra continua classificado, com o recebimento", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const renda = await criarRenda(lar, "[TEST] Salário em dólar");
    const a = await criarPix(lar, 100_000);
    await sugerir(a, { kind: "parte_salario", rendaId: renda });
    const app = appDoLar(lar);
    const aceite = await chamar(app, "POST", "/api/categorization/accept", { transactionIds: [a] });
    const regra = aceite.corpo.accepted[0].ruleId as string;
    expect(regra).toBeTruthy();

    // Depois da confirmação, a importação traz outro Pix do mesmo remetente, em outro instante.
    const b = await criarPix(lar, 150_000, "[TEST] Fulana", { dia: "2026-10-22" });
    await processNewTransactions(dbDeTeste(), lar.householdId, [b], "2026-11-10T13:00:00.000Z");
    expect((await linhaDa(b))?.rule_id).toBe(regra);

    const desfeito = await chamar(app, "POST", "/api/categorization/undo", {
      items: [{ transactionId: a, categoryId: null }],
    });

    expect(desfeito.corpo.undone).toEqual([a]);
    expect((await linhaDa(a))?.income_kind).toBeNull();
    expect(await recebimentosDa(a)).toHaveLength(0);
    expect((await linhaDa(b))?.income_kind).toBe("parte_salario");
    expect(await recebimentosDa(b)).toEqual([{ fixed_income_id: renda, confirmed_by: "regra" }]);
    // A regra continua ativa, porque o Pix da importação ainda a usa.
    expect(
      await contar("SELECT COUNT(*) AS total FROM rules WHERE id = ? AND disabled_at IS NULL", regra),
    ).toBe(1);
  });
});

describe("transação oculta por outro motivo ou removida (item 9)", () => {
  it("a prévia e o PUT não somam a entrada na renda do ciclo", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const pix = await criarPix(lar, 150_000);
    await env.DB.prepare("UPDATE transactions SET hidden = 1, hidden_reason = 'duplicada' WHERE id = ?")
      .bind(pix)
      .run();
    const app = appDoLar(lar);

    const previa = await chamar(app, "POST", `${url(pix)}/preview`, {
      option: "variavel",
      incomeSubtype: "venda",
    });
    expect(previa.corpo.afterCents).toBe(previa.corpo.beforeCents);

    const gravado = await chamar(app, "PUT", url(pix), {
      option: "variavel",
      incomeSubtype: "venda",
      remember: false,
    });
    expect(gravado.status).toBe(200);
    expect(gravado.corpo.cycleIncomeCents).toBe(0);
    expect((await linhaDa(pix))?.hidden).toBe(1);
  });

  it("removida não soma; o reembolso que vira venda soma (a ocultação cai)", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const removida = await criarPix(lar, 150_000);
    await env.DB.prepare("UPDATE transactions SET removed_at = ? WHERE id = ?").bind(AGORA, removida).run();
    const app = appDoLar(lar);
    const previa = await chamar(app, "POST", `${url(removida)}/preview`, {
      option: "variavel",
      incomeSubtype: "venda",
    });
    expect(previa.corpo.afterCents).toBe(previa.corpo.beforeCents);

    const reembolso = await criarPix(lar, 90_000, "[TEST] Beltrana");
    await chamar(app, "PUT", url(reembolso), { option: "reembolso", remember: false });
    const deReembolsoParaVenda = await chamar(app, "POST", `${url(reembolso)}/preview`, {
      option: "variavel",
      incomeSubtype: "venda",
    });
    expect(deReembolsoParaVenda.corpo.afterCents - deReembolsoParaVenda.corpo.beforeCents).toBe(90_000);
  });
});

describe("422 de opção (item 11)", () => {
  it("corpo sem opção, ou com opção desconhecida, devolve fields.option no PUT e na prévia", async () => {
    const lar = await criarLar();
    await prepararCiclos(lar);
    const pix = await criarPix(lar, 150_000);
    const app = appDoLar(lar);
    for (const corpo of [{ remember: false }, { option: "xyz", remember: false }, {}]) {
      const put = await chamar(app, "PUT", url(pix), corpo);
      expect(put.status).toBe(422);
      expect(put.corpo.fields.option).toBe("Escolha uma opção.");
      const previa = await chamar(app, "POST", `${url(pix)}/preview`, corpo);
      expect(previa.status).toBe(422);
      expect(previa.corpo.fields.option).toBe("Escolha uma opção.");
    }
  });
});
