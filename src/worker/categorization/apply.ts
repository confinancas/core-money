import {
  COUNTERPARTY_KEY_SQL,
  ESTABLISHMENT_KEY_SQL,
  type RuleScope,
  SCOPE_MOVEMENTS,
} from "../../shared/rule-match";
import type { Db } from "../db/client";
import { movimentosComTipo, setDoTipoDaCategoria, tipoDaCategoriaSql } from "../spend-types/resolve";

// Único arquivo que grava category_id (TASK-0302). Toda escrita de categoria, nome, tipo ou movimento por regra ou
// por escolha do casal sai daqui. As chaves de casamento vêm do servidor (ESTABLISHMENT_KEY_SQL e COUNTERPARTY_KEY_SQL,
// com o alias t). Escrita nunca toca ai_category_id (a sugestão da IA fica como está).
// TASK-0802: a mesma instrução que grava a categoria grava o tipo de gasto pela categoria (herança), exceto quando o
// casal escolheu o tipo (escolhido) ou uma regra o gravou (regra), e só em saída (entrada não tem tipo). Ver
// src/worker/spend-types/resolve.ts.

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

// SET do tipo pela categoria (TASK-0802) e os parâmetros dele: o id da categoria vai em cada "?" do SQL, na ordem.
function tipoPelaCategoria(categoriaId: string): { sets: string[]; params: string[] } {
  const sets = setDoTipoDaCategoria("?");
  const vezes = (sets.join(" ").match(/\?/g) ?? []).length;
  return { sets, params: Array.from({ length: vezes }, () => categoriaId) };
}

const chaveDoEscopo = (escopo: RuleScope): string =>
  escopo === "estabelecimento" ? ESTABLISHMENT_KEY_SQL : COUNTERPARTY_KEY_SQL;

type Escrita = { sets: string[]; params: unknown[] };

// Um id de categoria para cada "?" de um trecho de SQL, na ordem em que aparecem.
const pedidosDaCategoria = (sql: string, categoriaId: string): string[] =>
  Array.from({ length: (sql.match(/\?/g) ?? []).length }, () => categoriaId);

// O tipo que a regra grava na linha (TASK-0802, rodada 2). escolhido nunca muda por regra. Metas e Investimentos não
// entram numa compra de cartão: ali a linha mantém o que tem, ou, quando a regra grava uma categoria, herda o tipo dela
// (como a fatia retroativa). Na conta, a regra grava o tipo. O cartão é lido na própria linha (card_id), não de fora.
function tipoDaRegraNaLinha(tipo: string, categoriaId: string | null): Escrita {
  if (!TIPOS_FORA_DO_CARTAO.has(tipo)) {
    return {
      sets: [
        "spend_type = CASE WHEN spend_type_source = 'escolhido' THEN spend_type ELSE ? END",
        "spend_type_source = CASE WHEN spend_type_source = 'escolhido' THEN spend_type_source ELSE 'regra' END",
      ],
      params: [tipo],
    };
  }
  if (categoriaId === null) {
    const guarda = "spend_type_source = 'escolhido' OR card_id IS NOT NULL";
    return {
      sets: [
        `spend_type = CASE WHEN ${guarda} THEN spend_type ELSE ? END`,
        `spend_type_source = CASE WHEN ${guarda} THEN spend_type_source ELSE 'regra' END`,
      ],
      params: [tipo],
    };
  }
  const herdado = tipoDaCategoriaSql("?", "t");
  return {
    sets: [
      `spend_type = CASE WHEN spend_type_source = 'escolhido' THEN spend_type WHEN card_id IS NULL THEN ? WHEN spend_type_source = 'regra' THEN spend_type ELSE ${herdado.tipo} END`,
      `spend_type_source = CASE WHEN spend_type_source = 'escolhido' THEN spend_type_source WHEN card_id IS NULL THEN 'regra' WHEN spend_type_source = 'regra' THEN spend_type_source ELSE ${herdado.origem} END`,
    ],
    params: [
      tipo,
      ...pedidosDaCategoria(herdado.tipo, categoriaId),
      ...pedidosDaCategoria(herdado.origem, categoriaId),
    ],
  };
}

// SET de uma regra, só com o que ela faz. Nome só quando a transação não tem nome próprio. Tipo de gasto pela
// tipoDaRegraNaLinha. Movimento grava o anterior. A marca de categorização (categorized_*, rule_id) só entra quando
// grava categoria ou movimento.
function escritaDaRegra(regra: RegraParaAplicar, agora: string): Escrita | null {
  const sets: string[] = [];
  const params: unknown[] = [];
  const gravaCategoria = regra.setCategoryId !== null;
  const gravaMovimento = regra.setMovement !== null;
  const marca = gravaCategoria || gravaMovimento;

  if (regra.setCustomName !== null) {
    sets.push("custom_name = CASE WHEN custom_name IS NULL THEN ? ELSE custom_name END");
    params.push(regra.setCustomName);
  }
  if (regra.setSpendType !== null) {
    const tipo = tipoDaRegraNaLinha(regra.setSpendType, regra.setCategoryId);
    sets.push(...tipo.sets);
    params.push(...tipo.params);
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
  if (regra.setCategoryId !== null) {
    sets.push("category_id = ?");
    params.push(regra.setCategoryId);
    // Sem tipo na regra, o tipo vem da categoria que ela grava (herança, na mesma instrução).
    if (regra.setSpendType === null) {
      const herdado = tipoPelaCategoria(regra.setCategoryId);
      sets.push(...herdado.sets);
      params.push(...herdado.params);
    }
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
  const tipo = tipoPelaCategoria(entrada.categoryId);
  const sets = ["category_id = ?", ...tipo.sets, "categorized_at = ?", "categorized_by = ?", "rule_id = ?"];
  return db.$client
    .prepare(`UPDATE transactions AS t SET ${sets.join(", ")} WHERE t.id = ? AND t.household_id = ?`)
    .bind(
      entrada.categoryId,
      ...tipo.params,
      entrada.now,
      entrada.by,
      entrada.ruleId,
      entrada.transactionId,
      entrada.householdId,
    );
}

// Importação (passo 3 do afterIngest): a regra gravada numa transação. Nulo quando a regra não tem o que gravar
// (só nome, com categoria arquivada). O cartão é conhecido pela própria linha (card_id), e a regra não grava metas nem
// investimentos nele.
export function applyRuleToTransactionStmt(
  db: Db,
  entrada: {
    householdId: string;
    transactionId: string;
    rule: RegraParaAplicar;
    now: string;
  },
): D1PreparedStatement | null {
  const escrita = escritaDaRegra(entrada.rule, entrada.now);
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

// Tipo da fatia (TASK-0802): escolhido nunca muda; o tipo da regra vale quando não é Metas/Investimentos num cartão;
// sem tipo na regra, a categoria que ela grava dá o tipo (herança), exceto nas linhas que já são regra e nas que não
// têm tipo (entrada, pagamento de fatura, transferência). A alias da tabela no UPDATE é u (ver o FROM da fatia).
const TIPO_DA_REGRA_VALE = `(SELECT tipo FROM regra) IS NOT NULL
      AND NOT (u.card_id IS NOT NULL AND (SELECT tipo FROM regra) IN ('metas', 'investimentos'))`;
const CATEGORIA_DA_REGRA_VALE = `(SELECT categoria FROM regra) IS NOT NULL AND COALESCE(u.spend_type_source, '') <> 'regra'
      AND ${movimentosComTipo("u")}`;
const HERDADO_DA_FATIA = tipoDaCategoriaSql("(SELECT categoria FROM regra)", "u");

const SET_DA_FATIA = `custom_name = CASE WHEN (SELECT nome FROM regra) IS NOT NULL AND custom_name IS NULL
      THEN (SELECT nome FROM regra) ELSE custom_name END,
    spend_type = CASE WHEN u.spend_type_source = 'escolhido' THEN u.spend_type
      WHEN ${TIPO_DA_REGRA_VALE} THEN (SELECT tipo FROM regra)
      WHEN ${CATEGORIA_DA_REGRA_VALE} THEN ${HERDADO_DA_FATIA.tipo}
      ELSE u.spend_type END,
    spend_type_source = CASE WHEN u.spend_type_source = 'escolhido' THEN u.spend_type_source
      WHEN ${TIPO_DA_REGRA_VALE} THEN 'regra'
      WHEN ${CATEGORIA_DA_REGRA_VALE} THEN ${HERDADO_DA_FATIA.origem}
      ELSE u.spend_type_source END,
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
  const escrita = escritaDaRegra(rule, entrada.now);
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
