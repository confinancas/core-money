import { SPEND_TYPE_DEFS, type SpendType } from "../../shared/spend-types";

// Tipo de gasto de uma saída (TASK-0802). A precedência é escolhido > regra > categoria > padrão, e compra no cartão
// nunca é Metas nem Investimentos. Este arquivo é o único lugar onde a regra é escrita em SQL: o espelho em TypeScript
// (resolveSpendType) é o mesmo predicado, linha a linha, e a matriz de testes compara os dois.
//
// Quem grava spend_type é src/worker/categorization/apply.ts (herança junto com a categoria), derive.ts (rederivação,
// padrão e regras automáticas) e a carga inicial da migração 0008. Nenhum outro arquivo grava o tipo.

export const ORIGENS_DO_TIPO = ["escolhido", "regra", "categoria", "padrao"] as const;
export type OrigemDoTipo = (typeof ORIGENS_DO_TIPO)[number];

const TIPOS_FORA_DO_CARTAO: readonly string[] = ["metas", "investimentos"];
const TIPO_PADRAO: SpendType = "prazeres";

// Saídas que têm tipo: compra, saída de conta (pix, ted, débito, boleto, outro) e estorno. Entradas, pagamento de
// fatura e transferência não têm tipo (TASK-0802, rodada 2). `a` é o alias da tabela na consulta.
export const movimentosComTipo = (a: string): string =>
  `((${a}.amount_cents < 0 AND ${a}.movement IN ('compra', 'pix_enviado', 'ted_enviada', 'debito', 'boleto', 'outro')) OR ${a}.movement = 'estorno')`;

export type EntradaDeResolucao = {
  atual: { spendType: string | null; source: string | null };
  cartao: boolean;
  // default_spend_type da categoria da saída, e o da mãe (subcategoria). Nulos quando não têm tipo próprio.
  tipoCategoria: string | null;
  tipoMae: string | null;
};

export type TipoResolvido = { spendType: SpendType; source: OrigemDoTipo };

const tipoPermitido = (tipo: string | null, cartao: boolean): string | null =>
  tipo === null || (cartao && TIPOS_FORA_DO_CARTAO.includes(tipo)) ? null : tipo;

// Espelho puro do que tipoDaCategoriaSql faz no SQL. escolhido e regra não mudam; a categoria (própria ou da mãe) vem
// antes do padrão; metas e investimentos não entram no cartão, e a categoria que os tem cai para a mãe e depois para o
// padrão.
export function resolveSpendType(entrada: EntradaDeResolucao): TipoResolvido {
  const origem = entrada.atual.source;
  if (origem === "escolhido" || origem === "regra") {
    return { spendType: (entrada.atual.spendType ?? TIPO_PADRAO) as SpendType, source: origem };
  }
  const tipo =
    tipoPermitido(entrada.tipoCategoria, entrada.cartao) ?? tipoPermitido(entrada.tipoMae, entrada.cartao);
  if (tipo !== null) return { spendType: tipo as SpendType, source: "categoria" };
  return { spendType: TIPO_PADRAO, source: "padrao" };
}

// Expressões SQL do tipo e da origem a partir da categoria. `categoria` é a expressão do id da categoria: "t.category_id"
// (a linha já tem a categoria, na rederivação e no padrão) ou "?" (a mesma instrução grava a categoria nova, em
// apply.ts). A tabela da transação tem o alias t. Cada "?" pede o id da categoria de novo, na ordem em que aparece.
export function tipoDaCategoriaSql(categoria: string, a = "t"): { tipo: string; origem: string } {
  const proprio = `(SELECT c.default_spend_type FROM categories AS c WHERE c.id = ${categoria} AND c.household_id = ${a}.household_id
      AND NOT (${a}.card_id IS NOT NULL AND c.default_spend_type IN ('metas', 'investimentos')))`;
  const mae = `(SELECT p.default_spend_type FROM categories AS c JOIN categories AS p ON p.id = c.parent_id AND p.household_id = c.household_id
      WHERE c.id = ${categoria} AND c.household_id = ${a}.household_id
      AND NOT (${a}.card_id IS NOT NULL AND p.default_spend_type IN ('metas', 'investimentos')))`;
  const herdado = `COALESCE(${proprio}, ${mae})`;
  return {
    tipo: `COALESCE(${herdado}, 'prazeres')`,
    origem: `CASE WHEN ${herdado} IS NULL THEN 'padrao' ELSE 'categoria' END`,
  };
}

// As duas atribuições de uma instrução que grava o tipo pela categoria. O que o casal escolheu (escolhido) e o que uma
// regra gravou (regra) não muda, e entrada, pagamento de fatura e transferência não recebem tipo. Cada "?" dentro delas
// pede o id da categoria, na ordem em que aparece.
export function setDoTipoDaCategoria(categoria: string, a = "t"): string[] {
  const { tipo, origem } = tipoDaCategoriaSql(categoria, a);
  const guarda = `(${a}.spend_type_source IN ('escolhido', 'regra') OR NOT ${movimentosComTipo(a)})`;
  return [
    `spend_type = CASE WHEN ${guarda} THEN ${a}.spend_type ELSE ${tipo} END`,
    `spend_type_source = CASE WHEN ${guarda} THEN ${a}.spend_type_source ELSE ${origem} END`,
  ];
}

// Mesmo critério de "tipo permitido no cartão", para quem valida uma troca de tipo (o PATCH de transação, TASK-0403 e
// 0404, usa isto). Lança RangeError com a mensagem da spec quando a compra é de cartão e o tipo é Metas ou Investimentos.
export function assertSpendTypeAllowed(linha: { cardId: string | null }, tipo: string): void {
  if (!SPEND_TYPE_DEFS.some((def) => def.id === tipo)) throw new RangeError("Tipo de gasto inválido.");
  if (linha.cardId !== null && TIPOS_FORA_DO_CARTAO.includes(tipo)) {
    throw new RangeError("Compra no cartão nunca é Metas nem Investimentos.");
  }
}
