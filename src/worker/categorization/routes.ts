import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { ClassificacaoDeEntrada } from "../../shared/income";
import {
  caminhoDoDetalhe,
  FILTROS_DA_FILA,
  type FiltroDaFila,
  OPCAO_DA_RENDA,
  type TipoDaLinha,
  tituloDaLinha,
} from "../../shared/para-categorizar";
import { todayInSaoPaulo } from "../../shared/sao-paulo-date";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";
import {
  ehEntrada,
  type LinhaDaEntrada,
  sugestaoDaLinha as sugestaoDeEntrada,
} from "../income/classification";
import {
  aceiteDeEntradaStmts,
  desfazerEntradaStmts,
  entradasDaLeitura,
  leituraDasEntradasStmts,
} from "../income/classification-entradas";
import {
  acceptSuggestionStmt,
  clearTransactionCategoryStmt,
  learnFromConfirmationStmts,
  undoLearnedRuleStmts,
} from "./apply";
import { decodeCursor, encodeCursor, queueCountsStmt, queuePageStmt, TAMANHO_DA_PAGINA } from "./queue-query";

// Entradas aceitas por chamada (TASK-0903): cada uma mexe em recebimento e renda; as outras continuam na lista.
const LIMITE_DE_ENTRADAS_NO_ACEITE = 20;

// Fila Para categorizar (TASK-0304). Sessão obrigatória; tudo filtrado pelo lar da sessão. Uma ida ao D1 por rota
// (db.batch). As gravações de categoria saem só de apply.ts. Montadas em /api/categorization.

const lerCorpo = async <T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T | undefined> => {
  let corpo: unknown;
  try {
    corpo = await c.req.json();
  } catch {
    return undefined;
  }
  const lido = schema.safeParse(corpo);
  return lido.success ? lido.data : undefined;
};

const ids = z.array(z.string().min(1)).min(1).max(100);
const corpoDoAceite = z.strictObject({ transactionIds: ids });
const corpoDoDesfazer = z.strictObject({
  items: z
    .array(z.strictObject({ transactionId: z.string().min(1), categoryId: z.string().min(1).nullable() }))
    .min(1)
    .max(100),
});

const semDuplicados = (lista: readonly string[]): string[] => [...new Set(lista)];
const dadosInvalidos = (c: Context<AppEnv>) => apiError(c, 422, "validacao", "Dados inválidos.");

type LinhaDaPagina = {
  id: string;
  movement: string;
  amount_cents: number;
  local_date: string;
  original_description: string;
  custom_name: string | null;
  counterparty_name: string | null;
  banco: string | null;
  card_id: string | null;
  tipo: TipoDaLinha;
  tem: number;
  categoria_id: string | null;
  categoria_nome: string | null;
  categoria_cor: string | null;
  confianca: string | null;
  motivo: string | null;
  renda_tipo: string | null;
  renda_subtipo: string | null;
  renda_nome: string | null;
};

// Sugestão da linha: categoria (saída) ou renda (entrada). Nula quando a linha não tem sugestão utilizável.
function sugestaoDaLinha(linha: LinhaDaPagina) {
  if (linha.tem !== 1) return null;
  if (linha.tipo === "entrada") {
    return {
      option: OPCAO_DA_RENDA[linha.renda_tipo ?? ""] ?? linha.renda_tipo,
      fixedIncomeName: linha.renda_nome,
      incomeSubtype: linha.renda_subtipo,
      confidence: linha.confianca,
      reason: linha.motivo,
    };
  }
  return {
    categoryId: linha.categoria_id,
    categoryName: linha.categoria_nome,
    categoryColor: linha.categoria_cor,
    confidence: linha.confianca,
    reason: linha.motivo,
  };
}

export function categorizacaoRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  // Contagens (por filtro, com as sugeridas) e uma página de 50, numa só ida ao D1.
  rotas.get("/queue", async (c) => {
    const { householdId } = getSession(c);
    const filtroBruto = c.req.query("filtro") ?? "todos";
    if (!(FILTROS_DA_FILA as readonly string[]).includes(filtroBruto)) return dadosInvalidos(c);
    const filtro = filtroBruto as FiltroDaFila;
    const cursorBruto = c.req.query("cursor");
    let cursor: { localDate: string; id: string } | null = null;
    if (cursorBruto !== undefined) {
      cursor = decodeCursor(cursorBruto);
      if (cursor === null) return dadosInvalidos(c);
    }

    const [contagem, pagina] = await c.var.db.$client.batch([
      queueCountsStmt(c.var.db, householdId),
      queuePageStmt(c.var.db, { householdId, filtro, cursor }),
    ]);
    const linhaDaContagem = (contagem?.results?.[0] ?? {}) as Record<string, number>;
    const hoje = todayInSaoPaulo(agora());
    const linhas = (pagina?.results ?? []) as unknown as LinhaDaPagina[];
    const naPagina = linhas.slice(0, TAMANHO_DA_PAGINA);
    const ultima = naPagina[naPagina.length - 1];

    return c.json(
      {
        counts: {
          todos: linhaDaContagem.todos ?? 0,
          pix: linhaDaContagem.pix ?? 0,
          cartao: linhaDaContagem.cartao ?? 0,
          entradas: linhaDaContagem.entradas ?? 0,
        },
        suggested: {
          todos: linhaDaContagem.sugeridas_todos ?? 0,
          pix: linhaDaContagem.sugeridas_pix ?? 0,
          cartao: linhaDaContagem.sugeridas_cartao ?? 0,
          entradas: linhaDaContagem.sugeridas_entradas ?? 0,
        },
        items: naPagina.map((linha) => ({
          transactionId: linha.id,
          kind: linha.tipo,
          movement: linha.movement,
          title: tituloDaLinha({
            movement: linha.movement,
            customName: linha.custom_name,
            counterpartyName: linha.counterparty_name,
            originalDescription: linha.original_description,
          }),
          localDate: linha.local_date,
          institutionName: linha.banco,
          amountCents: linha.amount_cents,
          suggestion: sugestaoDaLinha(linha),
          detailPath: caminhoDoDetalhe({ id: linha.id, tipo: linha.tipo, movement: linha.movement }),
        })),
        nextCursor:
          linhas.length > TAMANHO_DA_PAGINA && ultima ? encodeCursor(ultima.local_date, ultima.id) : null,
        hoje,
      },
      200,
    );
  });

  // Aceitar: a sugestão das linhas vira a categoria, e a confirmação aprende (regra, iguais). Um lote só.
  rotas.post("/accept", async (c) => {
    const { householdId, memberId } = getSession(c);
    const corpo = await lerCorpo(c, corpoDoAceite);
    if (!corpo) return dadosInvalidos(c);
    const lista = semDuplicados(corpo.transactionIds);
    const db = c.var.db;
    const now = agora().toISOString();

    const aceites = lista.map((transactionId) =>
      acceptSuggestionStmt(db, { householdId, transactionId, memberId, now }),
    );
    const aprende = learnFromConfirmationStmts(db, { householdId, transactionIds: lista, memberId, now });
    // A leitura das entradas (TASK-0903) vai no mesmo lote: sem entrada, o aceite continua em uma chamada.
    const [linhasLidas, rendasLidas, ...resultados] = await db.$client.batch([
      ...leituraDasEntradasStmts(db, householdId, lista),
      ...aceites,
      ...aprende.comandos,
    ]);
    const { linhas, rendas } = entradasDaLeitura(linhasLidas, rendasLidas);

    const categoriaDeCadaAceite = new Map<string, string>();
    lista.forEach((transactionId, indice) => {
      const linha = (resultados[indice]?.results ?? [])[0] as { category_id: string } | undefined;
      if (linha) categoriaDeCadaAceite.set(transactionId, linha.category_id);
    });
    const regraDaAceita = new Map<string, string | null>();
    for (const linha of (resultados[aceites.length + aprende.indiceDosVinculos]?.results ?? []) as {
      id: string;
      rule_id: string | null;
    }[]) {
      regraDaAceita.set(linha.id, linha.rule_id);
    }
    const iguais = (resultados[aceites.length + aprende.indiceDosIguais]?.results ?? []) as {
      id: string;
      category_id: string;
      rule_id: string | null;
      is_backfill: number;
    }[];

    // Entradas com sugestão de renda (TASK-0903): uma ida para ler, outra para gravar. Até 20 por chamada.
    const entradasParaAceitar: { linha: LinhaDaEntrada; classificacao: ClassificacaoDeEntrada }[] = [];
    for (const transactionId of lista) {
      const linha = linhas.get(transactionId);
      if (!linha || !ehEntrada(linha) || linha.income_kind !== null || linha.categorized_at !== null)
        continue;
      if (linha.is_backfill !== 0) continue;
      const sugestao = sugestaoDeEntrada(linha, rendas);
      if (sugestao === null || entradasParaAceitar.length >= LIMITE_DE_ENTRADAS_NO_ACEITE) continue;
      entradasParaAceitar.push({ linha, classificacao: sugestao });
    }
    const aceitasEntrada = new Set<string>();
    const entradasAceitas: { transactionId: string; categoryId: null; ruleId: null }[] = [];
    const iguaisDeEntrada: { transactionId: string; categoryId: null; ruleId: null }[] = [];
    if (entradasParaAceitar.length > 0) {
      const comandos: D1PreparedStatement[] = [];
      const indices: number[] = [];
      for (const { linha, classificacao } of entradasParaAceitar) {
        const aceite = aceiteDeEntradaStmts(db, householdId, { linha, classificacao, memberId, agora: now });
        if (aceite.indiceDosIguais >= 0) indices.push(comandos.length + aceite.indiceDosIguais);
        comandos.push(...aceite.comandos);
      }
      const resultadosDasEntradas = await db.$client.batch(comandos);
      for (const { linha } of entradasParaAceitar) {
        aceitasEntrada.add(linha.id);
        entradasAceitas.push({ transactionId: linha.id, categoryId: null, ruleId: null });
      }
      for (const indice of indices) {
        for (const igual of (resultadosDasEntradas[indice]?.results ?? []) as { id: string }[]) {
          iguaisDeEntrada.push({ transactionId: igual.id, categoryId: null, ruleId: null });
        }
      }
    }

    const aceitas = lista.filter((transactionId) => categoriaDeCadaAceite.has(transactionId));
    return c.json(
      {
        accepted: [
          ...aceitas.map((transactionId) => ({
            transactionId,
            categoryId: categoriaDeCadaAceite.get(transactionId) ?? null,
            ruleId: regraDaAceita.get(transactionId) ?? null,
          })),
          ...entradasAceitas,
        ],
        alsoResolved: [
          ...iguais
            .filter((linha) => !categoriaDeCadaAceite.has(linha.id) && linha.is_backfill === 0)
            .map((linha) => ({
              transactionId: linha.id,
              categoryId: linha.category_id,
              ruleId: linha.rule_id,
            })),
          ...iguaisDeEntrada,
        ],
        skipped: lista.filter(
          (transactionId) => !categoriaDeCadaAceite.has(transactionId) && !aceitasEntrada.has(transactionId),
        ),
      },
      200,
    );
  });

  // Desfazer: a linha volta à fila (ou à sugestão da IA, no histórico) e, se a confirmação tinha criado a regra, ela
  // sai junto e as linhas dela voltam. O que mudou depois (outra categoria ou outra pessoa) volta em skipped.
  rotas.post("/undo", async (c) => {
    const { householdId, memberId } = getSession(c);
    const corpo = await lerCorpo(c, corpoDoDesfazer);
    if (!corpo) return dadosInvalidos(c);
    const db = c.var.db;
    const now = agora().toISOString();
    // categoryId nulo é uma entrada do Pix recebido (TASK-0903); o resto é saída, como antes.
    const itens = corpo.items.filter(
      (item): item is { transactionId: string; categoryId: string } => item.categoryId !== null,
    );
    const entradas = corpo.items.filter((item) => item.categoryId === null).map((item) => item.transactionId);

    const desfazer = undoLearnedRuleStmts(db, { householdId, items: itens, memberId, now });
    const limpezas = itens.map((item) =>
      clearTransactionCategoryStmt(db, {
        householdId,
        transactionId: item.transactionId,
        categoryId: item.categoryId,
        memberId,
      }),
    );
    // Entradas (TASK-0903) no mesmo lote: não precisam de leitura, então o desfazer continua em uma chamada.
    const comandosDasEntradas: D1PreparedStatement[] = [];
    const indicesDasEntradas: { id: string; indice: number }[] = [];
    for (const transactionId of entradas) {
      const desfaz = desfazerEntradaStmts(db, householdId, { transactionId, memberId, agora: now });
      indicesDasEntradas.push({
        id: transactionId,
        indice:
          desfazer.comandos.length + limpezas.length + comandosDasEntradas.length + desfaz.indiceDaVolta,
      });
      comandosDasEntradas.push(...desfaz.comandos);
    }
    const resultados = await db.$client.batch([...desfazer.comandos, ...limpezas, ...comandosDasEntradas]);

    const desfeitas = new Set<string>();
    itens.forEach((item, indice) => {
      if ((resultados[desfazer.comandos.length + indice]?.results ?? []).length > 0) {
        desfeitas.add(item.transactionId);
      }
    });
    const voltas = (resultados[desfazer.indiceDasVoltas]?.results ?? []) as { id: string }[];
    const undone = [...desfeitas, ...voltas.map((linha) => linha.id).filter((id) => !desfeitas.has(id))];

    const desfeitasEntrada = new Set<string>();
    for (const { id, indice } of indicesDasEntradas) {
      if ((resultados[indice]?.results ?? []).length > 0) desfeitasEntrada.add(id);
    }

    return c.json(
      {
        undone: [...undone, ...desfeitasEntrada],
        skipped: [
          ...itens.map((item) => item.transactionId).filter((id) => !desfeitas.has(id)),
          ...entradas.filter((id) => !desfeitasEntrada.has(id)),
        ],
      },
      200,
    );
  });

  return rotas;
}

export type { TipoDaLinha };
