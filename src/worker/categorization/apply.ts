import {
  COUNTERPARTY_KEY_SQL,
  ESTABLISHMENT_KEY_SQL,
  type RuleScope,
  SCOPE_MOVEMENTS,
} from "../../shared/rule-match";
import type { Db } from "../db/client";

// Único arquivo que grava category_id (TASK-0302). Toda escrita de categoria, nome, tipo ou movimento por regra ou
// por escolha do casal sai daqui. As chaves de casamento vêm do servidor (ESTABLISHMENT_KEY_SQL e COUNTERPARTY_KEY_SQL,
// com o alias t). Escrita nunca toca ai_category_id (a sugestão da IA fica como está).

// Regra já pronta para gravar: a categoria aqui é a categoria ativa, ou null (categoria arquivada não grava).
export type RegraParaAplicar = {
  id: string;
  scope: RuleScope;
  matchValue: string;
  setCustomName: string | null;
  setCategoryId: string | null;
  setSpendType: string | null;
  setMovement: string | null;
};

const TIPOS_FORA_DO_CARTAO: ReadonlySet<string> = new Set(["metas", "investimentos"]);
const LIMITE_DA_FATIA = 500;
const FATIAS_POR_REQUISICAO = 4;

const marcas = (quantidade: number): string => Array.from({ length: quantidade }, () => "?").join(", ");

const chaveDoEscopo = (escopo: RuleScope): string =>
  escopo === "estabelecimento" ? ESTABLISHMENT_KEY_SQL : COUNTERPARTY_KEY_SQL;

type Escrita = { sets: string[]; params: unknown[] };

// SET de uma regra, só com o que ela faz. Nome só quando a transação não tem nome próprio. Tipo de gasto nunca
// metas/investimentos numa compra de cartão (quando o cartão é conhecido, nem entra no SET). Movimento grava o
// anterior. A marca de categorização (categorized_*, rule_id) só entra quando grava categoria ou movimento.
function escritaDaRegra(
  regra: RegraParaAplicar,
  agora: string,
  cartaoConhecido: { cardId: string | null } | null,
): Escrita | null {
  const sets: string[] = [];
  const params: unknown[] = [];
  const tipo = regra.setSpendType;
  const tipoBloqueado =
    tipo !== null &&
    cartaoConhecido !== null &&
    cartaoConhecido.cardId !== null &&
    TIPOS_FORA_DO_CARTAO.has(tipo);
  const gravaCategoria = regra.setCategoryId !== null;
  const gravaMovimento = regra.setMovement !== null;
  const marca = gravaCategoria || gravaMovimento;

  if (regra.setCustomName !== null) {
    sets.push("custom_name = CASE WHEN custom_name IS NULL THEN ? ELSE custom_name END");
    params.push(regra.setCustomName);
  }
  if (tipo !== null && !tipoBloqueado) {
    const bloqueio = "card_id IS NOT NULL AND ? IN ('metas', 'investimentos')";
    sets.push(`spend_type = CASE WHEN ${bloqueio} THEN spend_type ELSE ? END`);
    params.push(tipo, tipo);
    sets.push(`spend_type_source = CASE WHEN ${bloqueio} THEN spend_type_source ELSE 'regra' END`);
    params.push(tipo);
  }
  if (gravaMovimento) {
    sets.push(
      "movement_original = CASE WHEN movement = ? THEN movement_original ELSE COALESCE(movement_original, movement) END",
    );
    params.push(regra.setMovement);
    sets.push("movement = ?");
    params.push(regra.setMovement);
    sets.push("movement_locked = 1");
  }
  if (gravaCategoria) {
    sets.push("category_id = ?");
    params.push(regra.setCategoryId);
  }
  if (marca) {
    sets.push("categorized_at = ?", "categorized_by = 'regra'", "rule_id = ?");
    params.push(agora, regra.id);
  }
  if (sets.length === 0) return null;
  return { sets, params };
}

// Escolha manual do casal (PUT) ou gravação de uma regra de "Aplicar a todas" feita pela transação escolhida.
// by = member_id, ou 'regra'. ruleId nulo numa mudança manual sem "Aplicar a todas".
export function setTransactionCategoryStmt(
  db: Db,
  entrada: {
    householdId: string;
    transactionId: string;
    categoryId: string;
    by: string;
    ruleId: string | null;
    now: string;
  },
): D1PreparedStatement {
  return db.$client
    .prepare(
      "UPDATE transactions SET category_id = ?, categorized_at = ?, categorized_by = ?, rule_id = ? WHERE id = ? AND household_id = ?",
    )
    .bind(
      entrada.categoryId,
      entrada.now,
      entrada.by,
      entrada.ruleId,
      entrada.transactionId,
      entrada.householdId,
    );
}

// Importação (passo 3 do afterIngest): a regra gravada numa transação. Nulo quando a regra não tem o que gravar
// (só nome, com categoria arquivada). cardId, quando conhecido, impede metas/investimentos num cartão.
export function applyRuleToTransactionStmt(
  db: Db,
  entrada: {
    householdId: string;
    transactionId: string;
    rule: RegraParaAplicar;
    cardId: string | null;
    now: string;
  },
): D1PreparedStatement | null {
  const escrita = escritaDaRegra(entrada.rule, entrada.now, { cardId: entrada.cardId });
  if (escrita === null) return null;
  return db.$client
    .prepare(`UPDATE transactions AS t SET ${escrita.sets.join(", ")} WHERE t.id = ? AND t.household_id = ?`)
    .bind(...escrita.params, entrada.transactionId, entrada.householdId);
}

// Retroativo (uma fatia), numa só consulta: a regra é lida dentro de cada comando, pelo id (CTE "regra"). Assim a
// fatia não precisa de ida antes do lote. A regra desativada, sem categoria ativa e sem movimento não casa: a CTE
// fica vazia e nada grava (o EXISTS da versão anterior). Cada UPDATE pega até 500 linhas do lar com a chave e o escopo
// da regra que ainda não têm esta regra (rule_id). "Todas" inclui as escolhidas à mão e as ocultas. Devolve 4 UPDATE e
// 1 COUNT do que falta. Só escopo estabelecimento (a compra); o status da regra vai no mesmo lote (statusDaRegraStmt).
const MOVIMENTOS_DA_COMPRA = "('compra', 'estorno', 'debito', 'boleto')";

const CTE_DA_REGRA = `WITH regra AS (
    SELECT r.id AS id, r.match_value AS chave, r.set_custom_name AS nome,
      CASE WHEN c.id IS NOT NULL THEN r.set_category_id END AS categoria,
      r.set_spend_type AS tipo, r.set_movement AS movimento
    FROM rules AS r
    LEFT JOIN categories AS c ON c.id = r.set_category_id AND c.household_id = r.household_id AND c.archived_at IS NULL
    WHERE r.id = ? AND r.household_id = ? AND r.disabled_at IS NULL AND r.scope = 'estabelecimento'
      AND (c.id IS NOT NULL OR r.set_movement IS NOT NULL)
  )`;

const MARCA_DA_REGRA =
  "((SELECT categoria FROM regra) IS NOT NULL OR (SELECT movimento FROM regra) IS NOT NULL)";

const SET_DA_FATIA = `custom_name = CASE WHEN (SELECT nome FROM regra) IS NOT NULL AND custom_name IS NULL
      THEN (SELECT nome FROM regra) ELSE custom_name END,
    spend_type = CASE WHEN (SELECT tipo FROM regra) IS NOT NULL
      AND NOT (card_id IS NOT NULL AND (SELECT tipo FROM regra) IN ('metas', 'investimentos'))
      THEN (SELECT tipo FROM regra) ELSE spend_type END,
    spend_type_source = CASE WHEN (SELECT tipo FROM regra) IS NOT NULL
      AND NOT (card_id IS NOT NULL AND (SELECT tipo FROM regra) IN ('metas', 'investimentos'))
      THEN 'regra' ELSE spend_type_source END,
    movement_original = CASE WHEN (SELECT movimento FROM regra) IS NOT NULL AND movement <> (SELECT movimento FROM regra)
      THEN COALESCE(movement_original, movement) ELSE movement_original END,
    movement = COALESCE((SELECT movimento FROM regra), movement),
    movement_locked = CASE WHEN (SELECT movimento FROM regra) IS NOT NULL THEN 1 ELSE movement_locked END,
    category_id = COALESCE((SELECT categoria FROM regra), category_id),
    categorized_at = CASE WHEN ${MARCA_DA_REGRA} THEN ? ELSE categorized_at END,
    categorized_by = CASE WHEN ${MARCA_DA_REGRA} THEN 'regra' ELSE categorized_by END,
    rule_id = CASE WHEN ${MARCA_DA_REGRA} THEN (SELECT id FROM regra) ELSE rule_id END`;

const FILTRO_DA_FATIA = `t.household_id = ? AND t.establishment_key = regra.chave AND t.movement IN ${MOVIMENTOS_DA_COMPRA}
    AND (t.rule_id IS NULL OR t.rule_id <> regra.id) AND t.id <> ?`;

export function applyRuleRetroactiveSliceStmts(
  db: Db,
  entrada: {
    householdId: string;
    ruleId: string;
    excludeTransactionId: string | null;
    now: string;
  },
): D1PreparedStatement[] {
  const { householdId, ruleId, now } = entrada;
  const excluida = entrada.excludeTransactionId ?? "";
  const comandos: D1PreparedStatement[] = [];
  for (let fatia = 0; fatia < FATIAS_POR_REQUISICAO; fatia++) {
    comandos.push(
      db.$client
        .prepare(
          `${CTE_DA_REGRA}
          UPDATE transactions AS u SET ${SET_DA_FATIA}
          WHERE u.id IN (SELECT t.id FROM transactions AS t JOIN regra ON 1 = 1 WHERE ${FILTRO_DA_FATIA} LIMIT ${LIMITE_DA_FATIA})`,
        )
        .bind(ruleId, householdId, now, householdId, excluida),
    );
  }
  comandos.push(
    db.$client
      .prepare(
        `${CTE_DA_REGRA}
        SELECT COUNT(*) AS restantes FROM transactions AS t JOIN regra ON 1 = 1 WHERE ${FILTRO_DA_FATIA}`,
      )
      .bind(ruleId, householdId, householdId, excluida),
  );
  return comandos;
}

// Status da regra da fatia, no mesmo lote: existe no lar? está ativa? Quem chama responde 404 ou 409 com isto.
export function statusDaRegraStmt(db: Db, householdId: string, ruleId: string): D1PreparedStatement {
  return db.$client
    .prepare(
      `SELECT (SELECT COUNT(*) FROM rules WHERE id = ? AND household_id = ?) AS existe,
        (SELECT COUNT(*) FROM rules WHERE id = ? AND household_id = ? AND disabled_at IS NULL) AS ativa`,
    )
    .bind(ruleId, householdId, ruleId, householdId);
}

// Os iguais que esperavam (quando nasce uma regra por "Lembrar" ou por confirmação): as outras transações da chave que
// nenhuma pessoa escolheu seguem a regra. Só com categoria ativa ou com movimento. Devolve os ids que mudaram.
export function applyRuleToPendingStmt(
  db: Db,
  entrada: {
    householdId: string;
    rule: RegraParaAplicar;
    excludeTransactionId: string | null;
    now: string;
  },
): D1PreparedStatement | null {
  const { rule } = entrada;
  if (rule.setCategoryId === null && rule.setMovement === null) return null;
  const escrita = escritaDaRegra(rule, entrada.now, null);
  if (escrita === null) return null;
  const movimentos = SCOPE_MOVEMENTS[rule.scope];
  return db.$client
    .prepare(
      `UPDATE transactions AS t SET ${escrita.sets.join(", ")}
        WHERE t.household_id = ? AND ${chaveDoEscopo(rule.scope)} = ? AND t.movement IN (${marcas(movimentos.length)})
        AND t.removed_at IS NULL AND (t.category_id IS NULL OR t.categorized_by = 'ia') AND t.id <> ?
        RETURNING id, category_id`,
    )
    .bind(
      ...escrita.params,
      entrada.householdId,
      rule.matchValue,
      ...movimentos,
      entrada.excludeTransactionId ?? "",
    );
}
