import {
  COUNTERPARTY_KEY_SQL,
  ESTABLISHMENT_KEY_SQL,
  type RuleScope,
  SCOPE_MOVEMENTS,
} from "../../shared/rule-match";
import type { Db } from "../db/client";
import { classeDeTipoPadrao } from "../spend-types/derive";
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
function tipoPelaCategoria(categoriaId: string, soSaidas = false): { sets: string[]; params: string[] } {
  const sets = setDoTipoDaCategoria("?", "t", soSaidas);
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
    // O tipo padrão que a gravação põe numa saída (TASK-0204, B1-1) sai quando o movimento novo não tem tipo, e
    // quando a regra não grava tipo nem categoria (com categoria, a herança abaixo já regrava o tipo).
    if (regra.setSpendType === null && regra.setCategoryId === null) {
      const classe = classeDeTipoPadrao(regra.setMovement ?? "");
      const semTipo = "spend_type_source = 'padrao' AND NOT ((amount_cents < 0 AND ?) OR ?)";
      sets.push(`spend_type = CASE WHEN ${semTipo} THEN NULL ELSE spend_type END`);
      params.push(classe.saida, classe.estorno);
      sets.push(`spend_type_source = CASE WHEN ${semTipo} THEN NULL ELSE spend_type_source END`);
      params.push(classe.saida, classe.estorno);
    }
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
  const tipo = tipoPelaCategoria(entrada.categoryId, true);
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

// Sugestão da IA aplicada no histórico (TASK-0303): só a transação de um ciclo mais antigo que o anterior (is_backfill
// = 1), sem categoria, com a categoria sugerida ainda ativa. Grava a categoria, o tipo pela categoria e a marca 'ia'.
// Nenhum outro caminho do cron grava category_id: a sugestão de uma transação nova fica em ai_category_id.
export function applyAiSuggestionStmt(
  db: Db,
  entrada: { householdId: string; transactionId: string; now: string },
): D1PreparedStatement {
  const sets = [
    "category_id = t.ai_category_id",
    ...setDoTipoDaCategoria("t.ai_category_id", "t", true),
    "categorized_at = ?",
    "categorized_by = 'ia'",
    "rule_id = NULL",
  ];
  return db.$client
    .prepare(
      `UPDATE transactions AS t SET ${sets.join(", ")}
        WHERE t.id = ? AND t.household_id = ? AND t.is_backfill = 1 AND t.category_id IS NULL AND t.ai_category_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM categories AS c WHERE c.id = t.ai_category_id AND c.household_id = t.household_id AND c.archived_at IS NULL)`,
    )
    .bind(entrada.now, entrada.transactionId, entrada.householdId);
}

// ── Fila Para categorizar (TASK-0304) ─────────────────────────────────────────────────────────────────────────────
// Aceitar, desfazer e aprender com a confirmação. Tudo grava pelas instruções deste arquivo. A confirmação vira regra
// de estabelecimento (compra, estorno, débito, boleto) ou de destinatário (Pix e TED enviados), sem movimento e sem
// nome. Os iguais que esperavam recebem a categoria da regra no mesmo lote.

// Movimentos da fila que têm regra (SCOPE_MOVEMENTS de estabelecimento e destinatário).
const MOVIMENTOS_COM_REGRA = "('compra', 'estorno', 'debito', 'boleto', 'pix_enviado', 'ted_enviada')";
const ESCOPO_DA_LINHA =
  "(CASE WHEN t.movement IN ('pix_enviado', 'ted_enviada') THEN 'destinatario' ELSE 'estabelecimento' END)";
const CHAVE_DA_LINHA = `(CASE WHEN t.movement IN ('pix_enviado', 'ted_enviada') THEN ${COUNTERPARTY_KEY_SQL} ELSE ${ESTABLISHMENT_KEY_SQL} END)`;

// Aceitar: a sugestão da IA vira a categoria, com o tipo pela categoria (TASK-0802). Só se a linha ainda não tem
// categoria, a sugestão ainda está ativa e a linha não foi removida. Quem não voltou no RETURNING vai para skipped.
export function acceptSuggestionStmt(
  db: Db,
  entrada: { householdId: string; transactionId: string; memberId: string; now: string },
): D1PreparedStatement {
  const sets = [
    "category_id = t.ai_category_id",
    ...setDoTipoDaCategoria("t.ai_category_id", "t", true),
    "categorized_at = ?",
    "categorized_by = ?",
    "rule_id = NULL",
  ];
  return db.$client
    .prepare(
      `UPDATE transactions AS t SET ${sets.join(", ")}
        WHERE t.id = ? AND t.household_id = ? AND t.category_id IS NULL AND t.ai_category_id IS NOT NULL
        AND t.removed_at IS NULL
        AND EXISTS (SELECT 1 FROM categories AS c WHERE c.id = t.ai_category_id AND c.household_id = t.household_id AND c.archived_at IS NULL)
        RETURNING id, category_id`,
    )
    .bind(entrada.now, entrada.memberId, entrada.transactionId, entrada.householdId);
}

// Volta de uma categoria do casal. Histórico com categoria da IA ainda ativa volta à sugestão da IA (categorized_by =
// 'ia'); o resto volta à fila. O tipo acompanha: o escolhido fica, o do histórico volta ao da categoria da IA, e o que
// veio da categoria ou da regra volta ao padrão.
const VOLTA_PARA_IA = `(t.is_backfill = 1 AND EXISTS (SELECT 1 FROM categories AS ca
    WHERE ca.id = t.ai_category_id AND ca.household_id = t.household_id AND ca.archived_at IS NULL))`;
const TIPO_DA_VOLTA = tipoDaCategoriaSql("t.ai_category_id", "t");
const SET_DA_VOLTA = [
  `category_id = CASE WHEN ${VOLTA_PARA_IA} THEN t.ai_category_id ELSE NULL END`,
  `categorized_by = CASE WHEN ${VOLTA_PARA_IA} THEN 'ia' ELSE NULL END`,
  `categorized_at = CASE WHEN ${VOLTA_PARA_IA} THEN t.categorized_at ELSE NULL END`,
  "rule_id = NULL",
  `spend_type = CASE WHEN t.spend_type_source IN ('escolhido', 'regra') THEN t.spend_type
    WHEN ${VOLTA_PARA_IA} THEN ${TIPO_DA_VOLTA.tipo}
    WHEN t.spend_type_source = 'categoria' THEN 'prazeres' ELSE t.spend_type END`,
  `spend_type_source = CASE WHEN t.spend_type_source IN ('escolhido', 'regra') THEN t.spend_type_source
    WHEN ${VOLTA_PARA_IA} THEN ${TIPO_DA_VOLTA.origem}
    WHEN t.spend_type_source = 'categoria' THEN 'padrao' ELSE t.spend_type_source END`,
].join(", ");

// Desfazer uma linha: zera a categoria só se ninguém mexeu depois (a categoria ainda é a mesma e quem gravou foi esta
// pessoa). A sugestão (ai_*) fica. Tem que rodar depois de undoLearnedRuleStmts, que lê o rule_id da linha.
export function clearTransactionCategoryStmt(
  db: Db,
  entrada: { householdId: string; transactionId: string; categoryId: string; memberId: string },
): D1PreparedStatement {
  return db.$client
    .prepare(
      `UPDATE transactions AS t SET ${SET_DA_VOLTA}
        WHERE t.id = ? AND t.household_id = ? AND t.category_id = ? AND t.categorized_by = ?
        RETURNING id`,
    )
    .bind(entrada.transactionId, entrada.householdId, entrada.categoryId, entrada.memberId);
}

// CTE das linhas aceitas neste lote: as que a pessoa confirmou agora (categorized_by e categorized_at iguais aos do
// aceite). Escopo e chave saem do movimento, no servidor. Os ids vêm num único parâmetro (json_each), como na fila.
const cteAceitas = (): string => `aceitas AS (
    SELECT t.id AS id, t.local_date AS local_date, t.category_id AS categoria, ${ESCOPO_DA_LINHA} AS escopo, ${CHAVE_DA_LINHA} AS chave
    FROM json_each(?) AS j CROSS JOIN transactions AS t ON t.id = j.value
    WHERE t.household_id = ? AND t.categorized_by = ? AND t.categorized_at = ? AND t.category_id IS NOT NULL
      AND t.movement IN ${MOVIMENTOS_COM_REGRA} AND ${CHAVE_DA_LINHA} IS NOT NULL AND ${CHAVE_DA_LINHA} NOT IN ('', '|')
  ), mais_recente AS (
    SELECT escopo, chave, categoria, local_date AS data FROM (
      SELECT escopo, chave, categoria, local_date,
        ROW_NUMBER() OVER (PARTITION BY escopo, chave ORDER BY local_date DESC, id DESC) AS posicao
      FROM aceitas
    ) WHERE posicao = 1
  )`;

// A categoria e a regra de cada linha: a regra ativa da chave da linha (a subconsulta lê o escopo e a chave dela).
const CATEGORIA_DA_REGRA_DA_LINHA = `(SELECT r.set_category_id FROM rules AS r WHERE r.household_id = t.household_id
    AND r.disabled_at IS NULL AND r.scope = ${ESCOPO_DA_LINHA} AND r.match_value = ${CHAVE_DA_LINHA})`;
const ID_DA_REGRA_DA_LINHA = `(SELECT r.id FROM rules AS r WHERE r.household_id = t.household_id
    AND r.disabled_at IS NULL AND r.scope = ${ESCOPO_DA_LINHA} AND r.match_value = ${CHAVE_DA_LINHA})`;

// Candidatas dos iguais: o estabelecimento lê o índice de (household_id, establishment_key); o destinatário (Pix e TED)
// não tem índice, então só varre o lar quando há regra de destinatário no lote (o EXISTS é uncorrelated).
const CANDIDATAS_DOS_IGUAIS = `SELECT x.id FROM transactions AS x INDEXED BY transactions_household_establishment_idx
    WHERE x.household_id = ? AND x.establishment_key IN (SELECT chave FROM chaves WHERE escopo = 'estabelecimento')
    UNION ALL
    SELECT x.id FROM (SELECT 1 AS ok WHERE EXISTS (SELECT 1 FROM chaves WHERE escopo = 'destinatario')) AS gate
      CROSS JOIN transactions AS x ON x.household_id = ? AND x.movement IN ('pix_enviado', 'ted_enviada')`;

// Candidatas da volta: as chaves das regras de estabelecimento do alvo (índice) e, se houver regra de destinatário, as
// transferências do lar.
const CANDIDATAS_DA_VOLTA = `SELECT x.id FROM transactions AS x INDEXED BY transactions_household_establishment_idx
    WHERE x.household_id = ? AND x.establishment_key IN (SELECT r.match_value FROM rules AS r
      WHERE r.id IN (SELECT rule_id FROM regras_do_alvo) AND r.household_id = ? AND r.scope = 'estabelecimento')
    UNION ALL
    SELECT x.id FROM (SELECT 1 AS ok WHERE EXISTS (SELECT 1 FROM rules AS r WHERE r.id IN (SELECT rule_id FROM regras_do_alvo) AND r.scope = 'destinatario')) AS gate
      CROSS JOIN transactions AS x ON x.household_id = ? AND x.movement IN ('pix_enviado', 'ted_enviada')`;

// Campos da regra ativa da chave da linha (o nome e o tipo que a regra grava nos iguais).
const regraDaLinha = (
  coluna: string,
): string => `(SELECT r.${coluna} FROM rules AS r WHERE r.household_id = t.household_id
    AND r.disabled_at IS NULL AND r.scope = ${ESCOPO_DA_LINHA} AND r.match_value = ${CHAVE_DA_LINHA})`;
const NOME_DA_REGRA_DA_LINHA = regraDaLinha("set_custom_name");
const TIPO_DA_REGRA_DA_LINHA = regraDaLinha("set_spend_type");
const TIPO_DOS_IGUAIS_VALE = `(${TIPO_DA_REGRA_DA_LINHA} IS NOT NULL
    AND NOT (t.card_id IS NOT NULL AND ${TIPO_DA_REGRA_DA_LINHA} IN ('metas', 'investimentos')))`;
const HERDADO_DA_LINHA = tipoDaCategoriaSql(CATEGORIA_DA_REGRA_DA_LINHA, "t");
const TIPO_DOS_IGUAIS = `spend_type = CASE WHEN t.spend_type_source IN ('escolhido', 'regra') THEN t.spend_type
      WHEN ${TIPO_DOS_IGUAIS_VALE} THEN ${TIPO_DA_REGRA_DA_LINHA} ELSE ${HERDADO_DA_LINHA.tipo} END,
    spend_type_source = CASE WHEN t.spend_type_source IN ('escolhido', 'regra') THEN t.spend_type_source
      WHEN ${TIPO_DOS_IGUAIS_VALE} THEN 'regra' ELSE ${HERDADO_DA_LINHA.origem} END`;

// Aprender com a confirmação, no mesmo lote do aceite, depois das instruções de aceitar:
// (1) a regra ativa da chave sem categoria válida (só de nome, ou com categoria arquivada) recebe a categoria da
//     transação mais recente da chave; (2) uma regra por chave nova ("confirmacao", criada por esta pessoa), sem
//     substituir a ativa que já existe; (3) o rule_id das aceitas (RETURNING: vínculos); (4) os iguais que esperavam
//     (categoria nula ou da IA, mesma chave, não escolhidos por ninguém) recebem a regra (RETURNING: iguais).
// Sem chave, ou com movimento fora de regra, nada é criado. A lista de ids vai num único parâmetro (sem grupos de 90).
export function learnFromConfirmationStmts(
  db: Db,
  entrada: { householdId: string; transactionIds: readonly string[]; memberId: string; now: string },
): { comandos: D1PreparedStatement[]; indiceDosVinculos: number; indiceDosIguais: number } {
  const json = JSON.stringify(entrada.transactionIds);
  const { householdId, memberId, now } = entrada;
  const comandos: D1PreparedStatement[] = [
    // (1) regra ativa sem categoria válida ganha a categoria da chave.
    db.$client
      .prepare(
        `WITH ${cteAceitas()}
        UPDATE rules SET set_category_id = (SELECT m.categoria FROM mais_recente AS m WHERE m.escopo = rules.scope AND m.chave = rules.match_value),
          created_from = 'confirmacao', created_by = ?
        WHERE household_id = ? AND disabled_at IS NULL
          AND (set_category_id IS NULL OR NOT EXISTS (SELECT 1 FROM categories AS c WHERE c.id = rules.set_category_id
            AND c.household_id = rules.household_id AND c.archived_at IS NULL))
          AND EXISTS (SELECT 1 FROM mais_recente AS m WHERE m.escopo = rules.scope AND m.chave = rules.match_value)`,
      )
      .bind(json, householdId, memberId, now, memberId, householdId),
    // (2) uma regra por chave das aceitas; a ativa que já existe fica (índice único parcial).
    db.$client
      .prepare(
        `WITH ${cteAceitas()}
        INSERT OR IGNORE INTO rules (id, household_id, scope, match_value, set_category_id, created_from, created_by, created_at, disabled_at)
        SELECT lower(hex(randomblob(16))), ?, m.escopo, m.chave, m.categoria, 'confirmacao', ?, ?, NULL FROM mais_recente AS m`,
      )
      .bind(json, householdId, memberId, now, householdId, memberId, now),
  ];
  // (3) rule_id das aceitas (a regra ativa da chave, se houver).
  const indiceDosVinculos = comandos.length;
  comandos.push(
    db.$client
      .prepare(
        `WITH ${cteAceitas()}
        UPDATE transactions AS t SET rule_id = ${ID_DA_REGRA_DA_LINHA}
        WHERE t.id IN (SELECT id FROM aceitas)
        RETURNING id, rule_id`,
      )
      .bind(json, householdId, memberId, now),
  );
  // (4) os iguais que esperavam.
  const indiceDosIguais = comandos.length;
  comandos.push(
    db.$client
      .prepare(
        `WITH ${cteAceitas()}, chaves AS (SELECT DISTINCT escopo, chave FROM aceitas)
        UPDATE transactions AS t SET category_id = ${CATEGORIA_DA_REGRA_DA_LINHA},
          categorized_at = ?, categorized_by = 'regra', rule_id = ${ID_DA_REGRA_DA_LINHA},
          custom_name = CASE WHEN t.custom_name IS NULL AND ${NOME_DA_REGRA_DA_LINHA} IS NOT NULL
            THEN ${NOME_DA_REGRA_DA_LINHA} ELSE t.custom_name END,
          ${TIPO_DOS_IGUAIS}
        WHERE t.id IN (${CANDIDATAS_DOS_IGUAIS}) AND t.removed_at IS NULL
          AND t.movement IN ${MOVIMENTOS_COM_REGRA}
          AND (t.category_id IS NULL OR t.categorized_by = 'ia')
          AND (${ESCOPO_DA_LINHA}, ${CHAVE_DA_LINHA}) IN (SELECT escopo, chave FROM chaves)
          AND ${CATEGORIA_DA_REGRA_DA_LINHA} IS NOT NULL
        RETURNING id, category_id, rule_id, is_backfill`,
      )
      .bind(json, householdId, memberId, now, now, householdId, householdId),
  );
  return { comandos, indiceDosVinculos, indiceDosIguais };
}

// Desfazer o que a confirmação aprendeu, quando a linha desfeita tem regra "confirmacao" criada por esta pessoa: a
// regra sem nome é desativada (com nome, só perde a categoria), e as linhas que vieram dela voltam (SET_DA_VOLTA).
// Vem antes de clearTransactionCategoryStmt: lê o rule_id da linha desfeita.
export function undoLearnedRuleStmts(
  db: Db,
  entrada: {
    householdId: string;
    items: readonly { transactionId: string; categoryId: string }[];
    memberId: string;
    now: string;
  },
): { comandos: D1PreparedStatement[]; indiceDasVoltas: number } {
  const json = JSON.stringify(
    entrada.items.map((item) => ({ transactionId: item.transactionId, categoryId: item.categoryId })),
  );
  const { householdId, memberId, now } = entrada;
  const cteRegras = `WITH alvo AS (
      SELECT json_extract(j.value, '$.transactionId') AS id, json_extract(j.value, '$.categoryId') AS categoria
      FROM json_each(?) AS j
    ), regras_do_alvo AS (
      SELECT DISTINCT t.rule_id AS rule_id FROM alvo AS a CROSS JOIN transactions AS t ON t.id = a.id
      WHERE t.household_id = ? AND t.category_id = a.categoria AND t.categorized_by = ? AND t.rule_id IS NOT NULL
    )`;
  const desativa = db.$client
    .prepare(
      `${cteRegras}
      UPDATE rules SET disabled_at = CASE WHEN set_custom_name IS NULL THEN ? ELSE disabled_at END, set_category_id = NULL
      WHERE id IN (SELECT rule_id FROM regras_do_alvo) AND household_id = ? AND created_from = 'confirmacao'
        AND created_by = ? AND disabled_at IS NULL`,
    )
    .bind(json, householdId, memberId, now, householdId, memberId);
  const volta = db.$client
    .prepare(
      `${cteRegras}
      UPDATE transactions AS t SET ${SET_DA_VOLTA}
      WHERE t.id IN (${CANDIDATAS_DA_VOLTA}) AND t.categorized_by = 'regra' AND t.rule_id IN (
        SELECT r.id FROM rules AS r WHERE r.id IN (SELECT rule_id FROM regras_do_alvo) AND r.household_id = ?
          AND r.created_from = 'confirmacao' AND r.created_by = ?)
      RETURNING id, category_id`,
    )
    .bind(json, householdId, memberId, householdId, householdId, householdId, householdId, memberId);
  return { comandos: [desativa, volta], indiceDasVoltas: 1 };
}
