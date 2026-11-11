// Saída estruturada da categorização (TASK-0303). O schema é constante: um enum de códigos mudaria a cada categoria
// editada, então os códigos são conferidos aqui, no servidor, por parseSuggestions.
import { AI_CONFIDENCES, type AiConfidence } from "../../shared/categorization";

export const SUGGESTIONS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sugestoes"],
  properties: {
    sugestoes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "categoria", "entrada", "renda", "subtipo", "certeza", "motivo"],
        properties: {
          ref: { type: "string" },
          categoria: { anyOf: [{ type: "string" }, { type: "null" }] },
          entrada: {
            anyOf: [
              { type: "string", enum: ["salario", "variavel", "reembolso", "transferencia"] },
              { type: "null" },
            ],
          },
          renda: { anyOf: [{ type: "string" }, { type: "null" }] },
          subtipo: {
            anyOf: [{ type: "string", enum: ["venda", "rendimento", "cashback", "outro"] }, { type: "null" }],
          },
          certeza: { type: "string", enum: ["pouca", "media", "alta"] },
          motivo: { type: "string" },
        },
      },
    },
  },
} as const;

export type RefDaSugestao = { ref: string; entrada: boolean };

// Os códigos da resposta (c1, r2...) viram ids só aqui, no servidor.
export type CodigosDoContexto = {
  categorias: ReadonlyMap<string, string>;
  rendas: ReadonlyMap<string, string>;
};

// O que se grava em ai_* de uma transação. Sem sugestão, tudo nulo.
export type GravavelDaIA = {
  aiCategoryId: string | null;
  aiIncomeKind: string | null;
  aiIncomeSubtype: string | null;
  aiFixedIncomeId: string | null;
  aiConfidence: AiConfidence | null;
  aiReason: string | null;
};

export const SEM_SUGESTAO: GravavelDaIA = {
  aiCategoryId: null,
  aiIncomeKind: null,
  aiIncomeSubtype: null,
  aiFixedIncomeId: null,
  aiConfidence: null,
  aiReason: null,
};

export const temSugestao = (gravavel: GravavelDaIA): boolean =>
  gravavel.aiCategoryId !== null || gravavel.aiIncomeKind !== null;

export type ResultadoDoParse =
  | { ok: true; porRef: Map<string, GravavelDaIA>; codigoInvalido: number }
  | { ok: false; erro: "saida_invalida" };

const MOTIVO_MAXIMO = 60;

// Entrada do schema -> tipo gravado. "salario" é a parte do salário (exige renda fixa), como em INCOME_OPTIONS.
const ENTRADAS: Record<string, { kind: string; precisaRenda: boolean }> = {
  salario: { kind: "parte_salario", precisaRenda: true },
  variavel: { kind: "variavel", precisaRenda: false },
  reembolso: { kind: "reembolso", precisaRenda: false },
  transferencia: { kind: "transferencia", precisaRenda: false },
};

const SUBTIPOS: readonly string[] = ["venda", "rendimento", "cashback", "outro"];
const ehTexto = (valor: unknown): valor is string => typeof valor === "string";

// Null ou ausente é "sem valor". Texto só vale se estiver na lista da própria tabela (propriedade própria, não herdada).
const ehEntradaValida = (valor: unknown): boolean =>
  valor === null || valor === undefined || (ehTexto(valor) && Object.hasOwn(ENTRADAS, valor));
const ehSubtipoValido = (valor: unknown): boolean =>
  valor === null || valor === undefined || (ehTexto(valor) && SUBTIPOS.includes(valor));
const ehObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

// Motivo: sem espaços nas pontas, até 60 caracteres, vazio vira nulo.
export function motivoDaSugestao(motivo: unknown): string | null {
  if (!ehTexto(motivo)) return null;
  const limpo = motivo.trim().slice(0, MOTIVO_MAXIMO).trim();
  return limpo === "" ? null : limpo;
}

// Lê o JSON da resposta com as regras da spec: ref desconhecida é ignorada; ref repetida vale a primeira; categoria ou
// renda fora dos códigos vira sem sugestão (e conta codigo_invalido); campos de entrada numa saída (e o contrário) são
// ignorados. Quem não aparece no mapa é tratado por quem chama como sem_resposta.
export function parseSuggestions(
  texto: string,
  refs: readonly RefDaSugestao[],
  codigos: CodigosDoContexto,
): ResultadoDoParse {
  let raiz: unknown;
  try {
    raiz = JSON.parse(texto);
  } catch {
    return { ok: false, erro: "saida_invalida" };
  }
  if (!ehObjeto(raiz) || !Array.isArray(raiz.sugestoes)) return { ok: false, erro: "saida_invalida" };

  const entradaDaRef = new Map(refs.map((item) => [item.ref, item.entrada]));
  const porRef = new Map<string, GravavelDaIA>();
  let codigoInvalido = 0;

  for (const item of raiz.sugestoes) {
    if (!ehObjeto(item) || !ehTexto(item.ref)) continue;
    const entrada = entradaDaRef.get(item.ref);
    if (entrada === undefined || porRef.has(item.ref)) continue;

    const certeza = AI_CONFIDENCES.find((nivel) => nivel === item.certeza);
    if (certeza === undefined) {
      porRef.set(item.ref, SEM_SUGESTAO);
      continue;
    }
    // entrada e subtipo só valem dentro da lista da saída estruturada. Valor fora dela (inclusive uma propriedade herdada
    // de objeto, como "constructor") é saída inválida: conta tentativa, e não grava nada do lote.
    if (!ehEntradaValida(item.entrada) || !ehSubtipoValido(item.subtipo)) {
      return { ok: false, erro: "saida_invalida" };
    }
    const motivo = motivoDaSugestao(item.motivo);

    if (!entrada) {
      if (!ehTexto(item.categoria)) {
        porRef.set(item.ref, SEM_SUGESTAO);
        continue;
      }
      const categoriaId = codigos.categorias.get(item.categoria);
      if (categoriaId === undefined) {
        codigoInvalido++;
        porRef.set(item.ref, SEM_SUGESTAO);
        continue;
      }
      porRef.set(item.ref, {
        ...SEM_SUGESTAO,
        aiCategoryId: categoriaId,
        aiConfidence: certeza,
        aiReason: motivo,
      });
      continue;
    }

    const regra = ehTexto(item.entrada) ? ENTRADAS[item.entrada] : undefined;
    if (regra === undefined) {
      porRef.set(item.ref, SEM_SUGESTAO);
      continue;
    }
    if (regra.precisaRenda) {
      if (!ehTexto(item.renda)) {
        porRef.set(item.ref, SEM_SUGESTAO);
        continue;
      }
      const rendaId = codigos.rendas.get(item.renda);
      if (rendaId === undefined) {
        codigoInvalido++;
        porRef.set(item.ref, SEM_SUGESTAO);
        continue;
      }
      porRef.set(item.ref, {
        ...SEM_SUGESTAO,
        aiIncomeKind: regra.kind,
        aiFixedIncomeId: rendaId,
        aiConfidence: certeza,
        aiReason: motivo,
      });
      continue;
    }
    const subtipo = regra.kind === "variavel" ? (ehTexto(item.subtipo) ? item.subtipo : "outro") : null;
    porRef.set(item.ref, {
      ...SEM_SUGESTAO,
      aiIncomeKind: regra.kind,
      aiIncomeSubtype: subtipo,
      aiConfidence: certeza,
      aiReason: motivo,
    });
  }
  return { ok: true, porRef, codigoInvalido };
}
