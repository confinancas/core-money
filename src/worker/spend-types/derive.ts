import { TIPO_DA_REGRA_AUTOMATICA, type TipoDeRegraAutomatica } from "../../shared/spend-types";
import type { Db } from "../db/client";
import { tipoDaCategoriaSql } from "./resolve";

// Rederivação e padrão do tipo de gasto (TASK-0802). Todas as escritas de spend_type que não são a herança da
// categoria (que mora em apply.ts) estão aqui. escolhido nunca muda; regra só muda por outra regra.
export type { TipoDeRegraAutomatica };
export { TIPO_DA_REGRA_AUTOMATICA };

// Saídas que têm tipo: compra, saída de conta (pix, ted, débito, boleto, outro) e estorno. Entradas, pagamento de
// fatura e transferência não têm. `a` é o alias da tabela na consulta.
const movimentosComTipo = (a: string): string =>
  `((${a}.amount_cents < 0 AND ${a}.movement IN ('compra', 'pix_enviado', 'ted_enviada', 'debito', 'boleto', 'outro')) OR ${a}.movement = 'estorno')`;

// Saídas de conta: o único lugar onde uma regra automática casa (nunca cartão).
const saidaDeConta = (a: string): string =>
  `${a}.account_id IS NOT NULL AND ${a}.amount_cents < 0 AND ${a}.movement IN ('pix_enviado', 'ted_enviada', 'debito', 'boleto', 'outro')`;

// Contraparte normalizada em SQL: maiúsculas, sem os acentos mais comuns do português (o normalizador da TASK-0207 tira
// todos; uma cadeia de REPLACE mais longa estoura a profundidade da expressão do D1, limite de 100).
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
const textoDaContraparte = (a: string): string =>
  ACENTOS_MAIUSCULOS.reduce(
    (sql, [de, para]) => `REPLACE(${sql}, '${de}', '${para}')`,
    `UPPER(TRIM(IFNULL(${a}.counterparty_name, '')))`,
  );

// Casa do texto da regra: no estabelecimento (a chave da importação já vem normalizada) ou no nome da contraparte.
const casaRegra = (a: string): string =>
  `(CASE WHEN instr(${a}.establishment_key, r.match_value) > 0 THEN 1 ELSE instr(${textoDaContraparte(a)}, r.match_value) > 0 END)`;

// Rederivação: o tipo padrão de uma categoria (ou a mãe) mudou. Afeta as linhas da categoria e das subcategorias que
// herdam (sem tipo próprio). Escolhido e regra não mudam. Entra no mesmo db.batch() da alteração (categories/repo.ts).
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
         AND COALESCE(t.spend_type_source, '') NOT IN ('escolhido', 'regra')`,
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

// Regras automáticas (corretora e caixinha) nas saídas de conta. Vale quando há uma regra do tipo no lar que casa. Não
// sobrescreve escolhido nem regra. alvo: os ids (importação) ou "all" (o lar inteiro: criação e reversão de regra).
export function applyAutomaticKindStmtFor(
  db: Db,
  householdId: string,
  kind: TipoDeRegraAutomatica,
  alvo: readonly string[] | "all",
): D1PreparedStatement {
  const tipo = TIPO_DA_REGRA_AUTOMATICA[kind];
  if (alvo === "all") {
    return db.$client
      .prepare(
        `UPDATE transactions AS t SET spend_type = ?, spend_type_source = 'regra'
         WHERE t.household_id = ? AND ${saidaDeConta("t")}
           AND COALESCE(t.spend_type_source, '') NOT IN ('escolhido', 'regra')
           AND EXISTS (SELECT 1 FROM automatic_rules AS r WHERE r.household_id = t.household_id AND r.kind = ? AND ${casaRegra("t")})`,
      )
      .bind(tipo, householdId, kind);
  }
  return db.$client
    .prepare(
      `UPDATE transactions AS t SET spend_type = ?, spend_type_source = 'regra'
       WHERE t.id IN (SELECT x.id FROM json_each(?) AS j CROSS JOIN transactions AS x ON x.id = j.value AND x.household_id = ?
         WHERE ${saidaDeConta("x")} AND COALESCE(x.spend_type_source, '') NOT IN ('escolhido', 'regra')
           AND EXISTS (SELECT 1 FROM automatic_rules AS r WHERE r.household_id = x.household_id AND r.kind = ? AND ${casaRegra("x")}))`,
    )
    .bind(tipo, JSON.stringify(alvo), householdId, kind);
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
// categoria ou o padrão. Depois apaga a regra e reaplica as que sobram do mesmo tipo, no mesmo lote. Quem chama lê
// os changes: reversão menos reaplicação é o número de linhas que deixaram a regra.
export function revertAutomaticRuleStmts(
  db: Db,
  householdId: string,
  regra: { id: string; kind: TipoDeRegraAutomatica; matchValue: string },
): D1PreparedStatement[] {
  const tipo = tipoDaCategoriaSql("t.category_id");
  const reverte = db.$client
    .prepare(
      `UPDATE transactions AS t SET spend_type = ${tipo.tipo}, spend_type_source = ${tipo.origem}
       WHERE t.household_id = ? AND ${saidaDeConta("t")}
         AND t.spend_type_source = 'regra' AND t.spend_type = ?
         AND (CASE WHEN instr(t.establishment_key, ?) > 0 THEN 1
           ELSE instr(${textoDaContraparte("t")}, ?) > 0 END)`,
    )
    .bind(householdId, TIPO_DA_REGRA_AUTOMATICA[regra.kind], regra.matchValue, regra.matchValue);
  const apaga = db.$client
    .prepare("DELETE FROM automatic_rules WHERE id = ? AND household_id = ?")
    .bind(regra.id, householdId);
  return [reverte, apaga, applyAutomaticKindStmtFor(db, householdId, regra.kind, "all")];
}
