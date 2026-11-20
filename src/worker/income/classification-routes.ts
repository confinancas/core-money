import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import {
  applyClassificationDelta,
  type ClassificacaoDeEntrada,
  INCOME_OPTIONS,
  INCOME_SUBTYPES,
  type IncomeOption,
  summarizeCycleIncome,
} from "../../shared/income";
import { chaveVazia } from "../../shared/rule-match";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";
import {
  type Contexto,
  classificacaoDaLinha,
  classifyIncomeStmts,
  ehEntrada,
  entradaDoCiclo,
  iguaisDaRegraStmts,
  type LinhaDaEntrada,
  lerContexto,
  opcaoDoTipo,
  previewIncomeClassification,
  regraDoRemetenteStmts,
  sugestaoDaLinha,
} from "./classification";
import { computeCycleIncome } from "./cycle-income";

// Rotas do Pix recebido (TASK-0903): leitura, prévia e gravação da classificação de uma entrada. Sessão obrigatória; o
// lar vem da sessão, e outro lar ou transação inexistente dá 404. Montadas em /api/transactions.

const OPCOES = Object.keys(INCOME_OPTIONS) as [IncomeOption, ...IncomeOption[]];

const corpoDaPrevia = z.strictObject({
  option: z.enum(OPCOES),
  fixedIncomeId: z.string().min(1).optional(),
  incomeSubtype: z.enum(INCOME_SUBTYPES).optional(),
});
const corpoDaGravacao = corpoDaPrevia.extend({ remember: z.boolean() });

async function lerCorpo<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T | undefined> {
  let corpo: unknown;
  try {
    corpo = await c.req.json();
  } catch {
    return undefined;
  }
  const lido = schema.safeParse(corpo);
  return lido.success ? lido.data : undefined;
}

// Valida a escolha contra a renda e o tipo. Devolve a classificação, ou os campos com erro (422).
function validaEscolha(
  corpo: z.infer<typeof corpoDaPrevia>,
  contexto: Contexto,
): { ok: true; classificacao: ClassificacaoDeEntrada } | { ok: false; fields: Record<string, string> } {
  const config = INCOME_OPTIONS[corpo.option];
  if (config.exigeRenda) {
    const renda = contexto.rendas.find((r) => r.id === corpo.fixedIncomeId);
    if (!renda) return { ok: false, fields: { fixedIncomeId: "Escolha a renda fixa." } };
  }
  if (config.exigeSubtipo && !corpo.incomeSubtype) {
    return { ok: false, fields: { incomeSubtype: "Escolha o tipo de entrada." } };
  }
  return {
    ok: true,
    classificacao: {
      option: corpo.option,
      fixedIncomeId: config.exigeRenda ? (corpo.fixedIncomeId ?? null) : null,
      incomeSubtype: config.exigeSubtipo ? (corpo.incomeSubtype ?? null) : null,
    },
  };
}

export function classificacaoDeEntradaRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  // Leitura: a entrada, a sugestão, as rendas, a regra e a renda do ciclo (2 lotes).
  rotas.get("/:id/income-classification", async (c) => {
    const { householdId } = getSession(c);
    const id = c.req.param("id");
    const db = c.var.db;
    const contexto = await lerContexto(db, householdId, id);
    const linha = contexto.linha;
    if (linha === null) return apiError(c, 404, "nao_encontrada", "Este Pix não foi encontrado.");
    if (!ehEntrada(linha)) return apiError(c, 422, "nao_e_entrada");

    const ciclo =
      linha.cycle_key === null ? null : await computeCycleIncome(db, householdId, linha.cycle_key);
    const sugestao = sugestaoDaLinha(linha, contexto.rendas);
    const regra = contexto.regra;
    const regraOpcao = regra ? opcaoDoTipo(regra.set_income_kind) : null;
    return c.json(
      {
        transaction: paraTransacao(linha),
        classification: classificacaoDaLinha(linha),
        aiSuggestion:
          sugestao === null
            ? null
            : { ...sugestao, confidence: linha.ai_confidence, reason: linha.ai_reason },
        fixedIncomes: contexto.rendas.map((r) => ({ id: r.id, name: r.name, currency: r.currency })),
        rule:
          regra && regraOpcao
            ? {
                id: regra.id,
                option: regraOpcao,
                fixedIncomeId: regraOpcao === "salario" ? regra.set_fixed_income_id : null,
                incomeSubtype: regraOpcao === "variavel" ? regra.set_income_subtype : null,
              }
            : null,
        canRemember: !chaveVazia(linha.contraparte_chave),
        cycleIncomeCents: ciclo?.totalCents ?? 0,
      },
      200,
    );
  });

  // Prévia (2 lotes): a renda do ciclo antes e depois da troca. Nada é gravado.
  rotas.post("/:id/income-classification/preview", async (c) => {
    const { householdId } = getSession(c);
    const id = c.req.param("id");
    const corpo = await lerCorpo(c, corpoDaPrevia);
    if (!corpo) return apiError(c, 422, "validacao", "Dados inválidos.");
    const contexto = await lerContexto(c.var.db, householdId, id);
    const linha = contexto.linha;
    if (linha === null) return apiError(c, 404, "nao_encontrada", "Este Pix não foi encontrado.");
    if (!ehEntrada(linha)) return apiError(c, 422, "nao_e_entrada");
    const escolha = validaEscolha(corpo, contexto);
    if (!escolha.ok) return apiError(c, 422, "validacao", undefined, { fields: escolha.fields });
    const previa = await previewIncomeClassification(c.var.db, householdId, linha, escolha.classificacao);
    return c.json(previa, 200);
  });

  // Gravação (2 lotes de leitura e 1 de escrita): a renda do ciclo, a classificação, o recebimento e a regra.
  rotas.put("/:id/income-classification", async (c) => {
    const { householdId, memberId } = getSession(c);
    const id = c.req.param("id");
    const corpo = await lerCorpo(c, corpoDaGravacao);
    if (!corpo) return apiError(c, 422, "validacao", "Dados inválidos.");
    const db = c.var.db;
    const contexto = await lerContexto(db, householdId, id);
    const linha: LinhaDaEntrada | null = contexto.linha;
    if (linha === null) return apiError(c, 404, "nao_encontrada", "Este Pix não foi encontrado.");
    if (!ehEntrada(linha)) return apiError(c, 422, "nao_e_entrada");

    const escolha = validaEscolha(corpo, contexto);
    if (!escolha.ok) return apiError(c, 422, "validacao", undefined, { fields: escolha.fields });
    if (corpo.remember && chaveVazia(linha.contraparte_chave)) {
      return apiError(c, 422, "validacao", undefined, {
        fields: { remember: "Este Pix não tem remetente para lembrar." },
      });
    }
    const nova = escolha.classificacao;
    const agora0 = agora().toISOString();

    // Renda do ciclo depois da troca (a mesma soma da tela da Renda), antes de gravar.
    const ciclo =
      linha.cycle_key === null ? null : await computeCycleIncome(db, householdId, linha.cycle_key);
    const depois =
      ciclo === null
        ? 0
        : (() => {
            const ajustado = applyClassificationDelta(
              entradaDoCiclo(ciclo),
              classificacaoDaLinha(linha),
              nova,
              linha.amount_cents,
            );
            return summarizeCycleIncome(ajustado.rendas, ajustado.variavelCents).totalCents;
          })();

    const idDaRegra = corpo.remember ? crypto.randomUUID() : null;
    const comandos = [
      ...regraDoRemetenteStmts(db, householdId, {
        chave: linha.contraparte_chave,
        classificacao: nova,
        lembrar: corpo.remember,
        regraAtiva: contexto.regra,
        memberId,
        agora: agora0,
        id: idDaRegra ?? crypto.randomUUID(),
      }),
    ];
    comandos.push(
      ...classifyIncomeStmts(db, householdId, {
        linha,
        classificacao: nova,
        by: memberId,
        confirmedBy: memberId,
        ruleId: idDaRegra,
        agora: agora0,
        modo: "trocar",
      }),
    );
    let indiceDosIguais = -1;
    if (corpo.remember) {
      const iguais = iguaisDaRegraStmts(db, householdId, {
        excludeId: linha.id,
        chave: linha.contraparte_chave,
        classificacao: nova,
        agora: agora0,
      });
      indiceDosIguais = comandos.length + iguais.indiceDosIguais;
      comandos.push(...iguais.comandos);
    }
    const resultados = await db.$client.batch(comandos);
    const alsoResolved =
      indiceDosIguais < 0
        ? []
        : ((resultados[indiceDosIguais]?.results ?? []) as { id: string }[]).map(
            (linhaIgual) => linhaIgual.id,
          );

    return c.json(
      {
        classification: nova,
        rule: idDaRegra === null ? null : { id: idDaRegra },
        cycleIncomeCents: depois,
        alsoResolved,
      },
      200,
    );
  });

  return rotas;
}

function paraTransacao(linha: LinhaDaEntrada) {
  return {
    id: linha.id,
    movement: linha.movement,
    amountCents: linha.amount_cents,
    occurredAt: linha.occurred_at,
    localDate: linha.local_date,
    counterpartyName: linha.counterparty_name,
    counterpartyDocMasked: linha.counterparty_doc_masked,
    counterpartyBank: linha.counterparty_bank,
    pixKeyMasked: linha.pix_key_masked,
    institutionName: linha.institution_name,
    connectionLabel: linha.connection_label,
    originalDescription: linha.original_description,
    cycleKey: linha.cycle_key,
    cycleStartsOn: linha.starts_on,
    cycleEndsOn: linha.ends_on,
  };
}
