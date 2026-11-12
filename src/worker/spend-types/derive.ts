import { TIPO_DA_REGRA_AUTOMATICA, type TipoDeRegraAutomatica } from "../../shared/spend-types";
import type { Db } from "../db/client";
import { movimentosComTipo, tipoDaCategoriaSql } from "./resolve";

// Rederivação e padrão do tipo de gasto (TASK-0802). Todas as escritas de spend_type que não são a herança da
// categoria (que mora em apply.ts) estão aqui. escolhido nunca muda; regra só muda por outra regra.
export type { TipoDeRegraAutomatica };
export { TIPO_DA_REGRA_AUTOMATICA };

// Tipo padrão de uma linha nova (TASK-0204, B1-1): a gravação já grava o que applyDefaultSpendTypeStmt gravaria (categoria
// nula: o tipo padrão e a origem "padrao") nas linhas que têm tipo. TIPO_PADRAO é o de resolve.ts, e o predicado é o de
// movimentosComTipo, em TypeScript. Quando a classificação ou uma regra muda o movimento para um sem tipo, o padrão sai.
export const TIPO_PADRAO = "prazeres";
export const ORIGEM_PADRAO = "padrao";
const MOVIMENTOS_DE_SAIDA_COM_TIPO: ReadonlySet<string> = new Set([
  "compra",
  "pix_enviado",
  "ted_enviada",
  "debito",
  "boleto",
  "outro",
]);

// Saída com tipo (valor negativo e movimento de saída) ou estorno (qualquer valor).
export const temTipoPadrao = (movimento: string, valorEmCentavos: number): boolean =>
  (valorEmCentavos < 0 && MOVIMENTOS_DE_SAIDA_COM_TIPO.has(movimento)) || movimento === "estorno";

// Os dois sinais do predicado acima que dependem só do movimento; o valor (amount_cents) fica na consulta.
export const classeDeTipoPadrao = (movimento: string): { saida: number; estorno: number } => ({
  saida: MOVIMENTOS_DE_SAIDA_COM_TIPO.has(movimento) ? 1 : 0,
  estorno: movimento === "estorno" ? 1 : 0,
});

// Saídas de conta: o único lugar onde uma regra automática casa (nunca cartão).
const saidaDeConta = (a: string): string =>
  `${a}.account_id IS NOT NULL AND ${a}.amount_cents < 0 AND ${a}.movement IN ('pix_enviado', 'ted_enviada', 'debito', 'boleto', 'outro')`;

// A contraparte normalizada em SQL, em duas camadas (TASK-0802, rodada 2). O UPPER do SQLite só converte ASCII, e uma
// cadeia de 26 REPLACE (maiúsculos e minúsculos juntos) estoura a profundidade do D1 (limite 100). Por isso: a camada 1
// (maiúsculas, sem os acentuados maiúsculos) é a coluna `s` da subconsulta; a camada 2 (sem os acentuados minúsculos)
// é aplicada na consulta de fora, sobre `n.s`. Juntas dão o normalizador da TASK-0207 nas letras do português.
const ACENTOS_MAIUSCULOS: readonly (readonly [string, string])[] = [
  ["Á", "A"],
  ["À", "A"],
  ["Â", "A"],
  ["Ã", "A"],
  ["É", "E"],
  ["Ê", "E"],
  ["Í", "I"],
  ["Ó", "O"],
  ["Ô", "O"],
  ["Õ", "O"],
  ["Ú", "U"],
  ["Ç", "C"],
  ["Ü", "U"],
];
const ACENTOS_MINUSCULOS: readonly (readonly [string, string])[] = [
  ["á", "A"],
  ["à", "A"],
  ["â", "A"],
  ["ã", "A"],
  ["é", "E"],
  ["ê", "E"],
  ["í", "I"],
  ["ó", "O"],
  ["ô", "O"],
  ["õ", "O"],
  ["ú", "U"],
  ["ç", "C"],
  ["ü", "U"],
];
const trocaAcentos = (sql: string, pares: readonly (readonly [string, string])[]): string =>
  pares.reduce((atual, [de, para]) => `REPLACE(${atual}, '${de}', '${para}')`, sql);

// Camada 1: a contraparte em maiúsculas e sem os acentuados maiúsculos (alias da tabela `a`).
const contraparteCamada1 = (a: string): string =>
  trocaAcentos(`UPPER(TRIM(IFNULL(${a}.counterparty_name, '')))`, ACENTOS_MAIUSCULOS);
// Camada 2, sobre a coluna `s` da camada 1 (alias n da subconsulta): sem os acentuados minúsculos.
const contraparteCamada2 = (coluna: string): string => trocaAcentos(coluna, ACENTOS_MINUSCULOS);

// Rederivação: o tipo padrão de uma categoria (ou a mãe) mudou. Afeta as saídas da categoria e das subcategorias que
// herdam (sem tipo próprio). Escolhido e regra não mudam; entrada, pagamento de fatura e transferência não têm tipo.
// Entra no mesmo db.batch() da alteração (categories/repo.ts).
export function rederiveCategorySpendTypesStmt(
  db: Db,
  householdId: string,
  categoryId: string,
): D1PreparedStatement {
  const tipo = tipoDaCategoriaSql("t.category_id");
  return db.$client
    .prepare(
      `UPDATE transactions AS t SET spend_type = ${tipo.tipo}, spend_type_source = ${tipo.origem}
       WHERE t.household_id = ? AND t.category_id IN (SELECT c.id FROM categories AS c WHERE c.household_id = ?
         AND (c.id = ? OR (c.parent_id = ? AND c.default_spend_type IS NULL)))
         AND COALESCE(t.spend_type_source, '') NOT IN ('escolhido', 'regra') AND ${movimentosComTipo("t")}`,
    )
    .bind(householdId, householdId, categoryId, categoryId);
}

// Padrão: as saídas recém-gravadas sem origem recebem o tipo da categoria, ou Prazeres. A lista de ids é o laço de fora
// (json_each com CROSS JOIN): cada linha é buscada pela chave primária.
export function applyDefaultSpendTypeStmt(
  db: Db,
  householdId: string,
  ids: readonly string[],
): D1PreparedStatement {
  const tipo = tipoDaCategoriaSql("t.category_id");
  return db.$client
    .prepare(
      `UPDATE transactions AS t SET spend_type = ${tipo.tipo}, spend_type_source = ${tipo.origem}
       WHERE t.id IN (SELECT x.id FROM json_each(?) AS j CROSS JOIN transactions AS x ON x.id = j.value AND x.household_id = ?
         WHERE x.spend_type_source IS NULL AND ${movimentosComTipo("x")})`,
    )
    .bind(JSON.stringify(ids), householdId);
}

// Regras automáticas (corretora e caixinha) nas saídas de conta. Vale quando há uma regra do tipo no lar que casa (o
// lar da regra é o da linha). Não sobrescreve escolhido nem regra. alvo: os ids (importação) ou "all" (o lar inteiro:
// criação de regra). A subconsulta n traz id, lar, chave do estabelecimento e a contraparte da camada 1.
export function applyAutomaticKindStmtFor(
  db: Db,
  householdId: string,
  kind: TipoDeRegraAutomatica,
  alvo: readonly string[] | "all",
): D1PreparedStatement {
  const tipo = TIPO_DA_REGRA_AUTOMATICA[kind];
  const candidatas =
    alvo === "all"
      ? `SELECT x.id AS id, x.household_id AS household_id, x.establishment_key AS chave, ${contraparteCamada1("x")} AS s
         FROM transactions AS x
         WHERE x.household_id = ? AND ${saidaDeConta("x")} AND COALESCE(x.spend_type_source, '') NOT IN ('escolhido', 'regra')`
      : `SELECT x.id AS id, x.household_id AS household_id, x.establishment_key AS chave, ${contraparteCamada1("x")} AS s
         FROM json_each(?) AS j CROSS JOIN transactions AS x ON x.id = j.value AND x.household_id = ?
         WHERE ${saidaDeConta("x")} AND COALESCE(x.spend_type_source, '') NOT IN ('escolhido', 'regra')`;
  const casa = `(CASE WHEN instr(n.chave, r.match_value) > 0 THEN 1 ELSE instr(${contraparteCamada2("n.s")}, r.match_value) > 0 END)`;
  const sql = `UPDATE transactions AS t SET spend_type = ?, spend_type_source = 'regra'
    WHERE t.id IN (SELECT n.id FROM (${candidatas}) AS n
      WHERE EXISTS (SELECT 1 FROM automatic_rules AS r WHERE r.household_id = n.household_id AND r.kind = ? AND ${casa}))`;
  const valores =
    alvo === "all" ? [tipo, householdId, kind] : [tipo, JSON.stringify(alvo), householdId, kind];
  return db.$client.prepare(sql).bind(...valores);
}

// Passo 4 do afterIngest, para um lote de ids inseridos: padrão, depois corretora e caixinha, num único db.batch().
export async function applySpendTypesOnImport(
  db: Db,
  householdId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  await db.$client.batch([
    applyDefaultSpendTypeStmt(db, householdId, ids),
    applyAutomaticKindStmtFor(db, householdId, "corretora", ids),
    applyAutomaticKindStmtFor(db, householdId, "caixinha", ids),
  ]);
}

// Reverte as linhas que uma regra automática pôs (origem regra, com o tipo dela e o texto que casa) para o tipo da
// categoria ou o padrão. Não toca linha que uma regra com tipo do casal gravou (rule_id aponta para uma regra com
// set_spend_type), nem a escolhida. Depois apaga a regra e reaplica as que sobram do mesmo tipo, no mesmo lote. Quem
// chama lê os changes: reversão menos reaplicação é o número de linhas que deixaram a regra.
export function revertAutomaticRuleStmts(
  db: Db,
  householdId: string,
  regra: { id: string; kind: TipoDeRegraAutomatica; matchValue: string },
): D1PreparedStatement[] {
  const tipo = tipoDaCategoriaSql("t.category_id");
  const reverte = db.$client
    .prepare(
      `UPDATE transactions AS t SET spend_type = ${tipo.tipo}, spend_type_source = ${tipo.origem}
       WHERE t.id IN (SELECT n.id FROM (
           SELECT x.id AS id, x.establishment_key AS chave, ${contraparteCamada1("x")} AS s
           FROM transactions AS x
           WHERE x.household_id = ? AND ${saidaDeConta("x")} AND x.spend_type_source = 'regra' AND x.spend_type = ?
             AND NOT EXISTS (SELECT 1 FROM rules AS cr WHERE cr.id = x.rule_id AND cr.set_spend_type IS NOT NULL)
         ) AS n
         WHERE (CASE WHEN instr(n.chave, ?) > 0 THEN 1 ELSE instr(${contraparteCamada2("n.s")}, ?) > 0 END))`,
    )
    .bind(householdId, TIPO_DA_REGRA_AUTOMATICA[regra.kind], regra.matchValue, regra.matchValue);
  const apaga = db.$client
    .prepare("DELETE FROM automatic_rules WHERE id = ? AND household_id = ?")
    .bind(regra.id, householdId);
  return [reverte, apaga, applyAutomaticKindStmtFor(db, householdId, regra.kind, "all")];
}
