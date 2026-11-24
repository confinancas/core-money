import { INCOME_CANDIDATE_MOVEMENTS } from "../../shared/categorization";
import type { ClassificacaoDeEntrada } from "../../shared/income";
import { INCOME_OPTIONS } from "../../shared/income";
import { COUNTERPARTY_KEY_SQL, chaveVazia } from "../../shared/rule-match";
import type { Db } from "../db/client";
import {
  classifyIncomeStmts,
  iguaisDaRegraStmts,
  type LinhaDaEntrada,
  type RendaAtiva,
} from "./classification";

// Entradas do Pix recebido nas filas e no histórico (TASK-0903): o aceite e o desfazer da fila Para categorizar, e a
// sugestão aplicada direto no histórico (is_backfill = 1). Tudo em instruções do D1; cada lote conta como uma chamada.

const MOVIMENTOS_DE_ENTRADA = INCOME_CANDIDATE_MOVEMENTS.map((movimento) => `'${movimento}'`).join(", ");

// Histórico: a sugestão de uma entrada de ciclo antigo vira classificação direto, sem fila, com categorized_by = 'ia' e
// sem regra. Recebimento de parte do salário sai antes do tipo (o recebimento precisa de income_kind nulo).
export function historicoDaEntradaStmts(
  db: Db,
  householdId: string,
  transactionId: string,
  agora: string,
): D1PreparedStatement[] {
  const elegivel = `t.id = ? AND t.household_id = ? AND t.is_backfill = 1 AND t.income_kind IS NULL AND t.amount_cents > 0
    AND t.movement IN (${MOVIMENTOS_DE_ENTRADA}) AND t.ai_income_kind IS NOT NULL
    AND (t.ai_income_kind <> 'parte_salario' OR EXISTS (SELECT 1 FROM fixed_incomes AS f WHERE f.id = t.ai_fixed_income_id
      AND f.household_id = t.household_id AND f.archived_at IS NULL))`;
  return [
    db.$client
      .prepare(
        `INSERT INTO fixed_income_receipts (id, fixed_income_id, cycle_key, transaction_id, amount_cents, received_on,
          fx_rate, fx_date, confirmed_by)
        SELECT lower(hex(randomblob(16))), t.ai_fixed_income_id, t.cycle_key, t.id, t.amount_cents, t.local_date,
          (SELECT x.fx_rate FROM fixed_income_receipts AS x WHERE x.fixed_income_id = t.ai_fixed_income_id
            AND x.cycle_key = t.cycle_key AND x.fx_rate IS NOT NULL LIMIT 1),
          (SELECT x.fx_date FROM fixed_income_receipts AS x WHERE x.fixed_income_id = t.ai_fixed_income_id
            AND x.cycle_key = t.cycle_key AND x.fx_rate IS NOT NULL LIMIT 1),
          'ia'
        FROM transactions AS t
        WHERE ${elegivel} AND t.ai_income_kind = 'parte_salario' AND t.cycle_key IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM fixed_income_receipts AS x WHERE x.transaction_id = t.id)`,
      )
      .bind(transactionId, householdId),
    db.$client
      .prepare(
        `UPDATE transactions AS t SET income_kind = t.ai_income_kind,
          income_subtype = CASE WHEN t.ai_income_kind = 'variavel' THEN t.ai_income_subtype ELSE NULL END,
          fixed_income_id = CASE WHEN t.ai_income_kind = 'parte_salario' THEN t.ai_fixed_income_id ELSE NULL END,
          categorized_at = ?, categorized_by = 'ia', rule_id = NULL,
          hidden = CASE WHEN t.ai_income_kind = 'reembolso' THEN 1 ELSE t.hidden END,
          hidden_reason = CASE WHEN t.ai_income_kind = 'reembolso' THEN 'reembolso_terceiros' ELSE t.hidden_reason END
        WHERE ${elegivel}`,
      )
      .bind(agora, transactionId, householdId),
  ];
}

// Lê as entradas de uma lista de ids (aceite e desfazer), em uma ida, com as rendas ativas para validar a sugestão.
// Duas leituras (as entradas da lista e as rendas ativas) para entrar no mesmo lote do aceite ou do desfazer: quando
// não há entrada, o lote continua sendo uma chamada.
export function leituraDasEntradasStmts(
  db: Db,
  householdId: string,
  ids: readonly string[],
): D1PreparedStatement[] {
  return [
    db.$client
      .prepare(
        `SELECT t.id AS id, t.movement AS movement, t.amount_cents AS amount_cents, t.occurred_at AS occurred_at,
          t.local_date AS local_date, t.cycle_key AS cycle_key, t.income_kind AS income_kind,
          t.income_subtype AS income_subtype, t.fixed_income_id AS fixed_income_id, t.hidden AS hidden,
          t.hidden_reason AS hidden_reason, t.removed_at AS removed_at, t.categorized_by AS categorized_by, t.categorized_at AS categorized_at, t.is_backfill AS is_backfill,
          t.original_description AS original_description, t.counterparty_name AS counterparty_name,
          t.counterparty_doc_masked AS counterparty_doc_masked, t.counterparty_bank AS counterparty_bank,
          t.pix_key_masked AS pix_key_masked, t.ai_income_kind AS ai_income_kind, t.ai_income_subtype AS ai_income_subtype,
          t.ai_fixed_income_id AS ai_fixed_income_id, t.ai_confidence AS ai_confidence, t.ai_reason AS ai_reason,
          ${COUNTERPARTY_KEY_SQL} AS contraparte_chave, NULL AS institution_name, NULL AS connection_label,
          NULL AS starts_on, NULL AS ends_on
        FROM json_each(?) AS j CROSS JOIN transactions AS t ON t.id = j.value
        WHERE t.household_id = ?`,
      )
      .bind(JSON.stringify(ids), householdId),
    db.$client
      .prepare(
        "SELECT id, name, currency, amount_cents, kept_usd_is_investment FROM fixed_incomes WHERE household_id = ? AND archived_at IS NULL ORDER BY name",
      )
      .bind(householdId),
  ];
}

// Interpreta as duas leituras de leituraDasEntradasStmts.
export function entradasDaLeitura(
  linhasLidas: D1Result | undefined,
  rendasLidas: D1Result | undefined,
): { linhas: Map<string, LinhaDaEntrada>; rendas: RendaAtiva[] } {
  const linhas = new Map(
    ((linhasLidas?.results ?? []) as LinhaDaEntrada[]).map((linha) => [linha.id, linha] as const),
  );
  return { linhas, rendas: (rendasLidas?.results ?? []) as RendaAtiva[] };
}

// Aceite de uma entrada com sugestão: classifica, aprende a regra remetente ('confirmacao', só se a chave não tem uma
// ativa) e aplica aos iguais que esperavam. Devolve o índice do RETURNING dos iguais no lote.
export function aceiteDeEntradaStmts(
  db: Db,
  householdId: string,
  entrada: { linha: LinhaDaEntrada; classificacao: ClassificacaoDeEntrada; memberId: string; agora: string },
): { comandos: D1PreparedStatement[]; indiceDosIguais: number; indiceDaRegra: number } {
  const { linha, classificacao, memberId, agora } = entrada;
  const comandos: D1PreparedStatement[] = classifyIncomeStmts(db, householdId, {
    linha,
    classificacao,
    by: memberId,
    confirmedBy: memberId,
    ruleId: null,
    agora,
    modo: "so_sem_classe",
  });
  const chave = linha.contraparte_chave;
  if (chaveVazia(chave)) return { comandos, indiceDosIguais: -1, indiceDaRegra: -1 };
  comandos.push(
    db.$client
      .prepare(
        `INSERT OR IGNORE INTO rules (id, household_id, scope, match_value, set_custom_name, set_category_id, set_spend_type,
          set_income_kind, set_income_subtype, set_fixed_income_id, set_movement, created_from, created_by, created_at, disabled_at)
        VALUES (?, ?, 'remetente', ?, NULL, NULL, NULL, ?, ?, ?, NULL, 'confirmacao', ?, ?, NULL)`,
      )
      .bind(
        crypto.randomUUID(),
        householdId,
        chave,
        INCOME_OPTIONS[classificacao.option].incomeKind,
        classificacao.option === "variavel" ? classificacao.incomeSubtype : null,
        classificacao.option === "salario" ? classificacao.fixedIncomeId : null,
        memberId,
        agora,
      ),
  );
  comandos.push(
    db.$client
      .prepare(
        `UPDATE transactions SET rule_id = (SELECT r.id FROM rules AS r WHERE r.household_id = ? AND r.scope = 'remetente'
          AND r.match_value = ? AND r.disabled_at IS NULL)
        WHERE id = ? AND household_id = ? AND categorized_by = ? AND categorized_at = ?
        RETURNING id, rule_id`,
      )
      .bind(householdId, chave, linha.id, householdId, memberId, agora),
  );
  const indiceDaRegra = comandos.length - 1;
  const iguais = iguaisDaRegraStmts(db, householdId, { excludeId: linha.id, chave, classificacao, agora });
  const indiceDosIguais = comandos.length + iguais.indiceDosIguais;
  comandos.push(...iguais.comandos);
  return { comandos, indiceDosIguais, indiceDaRegra };
}

// Desfazer de uma entrada aceita por esta pessoa: tira o recebimento (de quem for: pela transação, sem olhar o
// confirmed_by) e devolve a entrada à fila. Tira também a classificação dos iguais que a mesma confirmação resolveu
// (regra desta confirmação e o mesmo categorized_at da entrada): o que a regra classificou depois, na importação, fica.
// A regra "confirmacao" criada por esta pessoa é desativada se nada mais a usa. Só mexe no que ainda é desta pessoa
// (categorized_by). O índice é o do UPDATE que devolve a entrada desfeita.
export function desfazerEntradaStmts(
  db: Db,
  householdId: string,
  entrada: { transactionId: string; memberId: string; agora: string },
): { comandos: D1PreparedStatement[]; indiceDaVolta: number } {
  const { transactionId, memberId, agora } = entrada;
  const regra = `(SELECT r.id FROM rules AS r WHERE r.household_id = ? AND r.scope = 'remetente'
    AND r.created_from = 'confirmacao' AND r.created_by = ? AND r.disabled_at IS NULL
    AND r.match_value = (SELECT ${COUNTERPARTY_KEY_SQL} FROM transactions AS t WHERE t.id = ? AND t.household_id = ?))`;
  // Regra ativa do remetente, de qualquer origem: os iguais da confirmação estão ligados a ela, tenha ela sido criada
  // agora ou antes ("lembrar", manual).
  const regraAtiva = `(SELECT r.id FROM rules AS r WHERE r.household_id = ? AND r.scope = 'remetente'
    AND r.disabled_at IS NULL
    AND r.match_value = (SELECT ${COUNTERPARTY_KEY_SQL} FROM transactions AS t WHERE t.id = ? AND t.household_id = ?))`;
  const aindaDaPessoa = `EXISTS (SELECT 1 FROM transactions AS a WHERE a.id = ? AND a.household_id = ? AND a.categorized_by = ?)`;
  const limpa = `income_kind = NULL, income_subtype = NULL, fixed_income_id = NULL, categorized_at = NULL,
    categorized_by = NULL, rule_id = NULL,
    hidden = CASE WHEN hidden_reason = 'reembolso_terceiros' THEN 0 ELSE hidden END,
    hidden_reason = CASE WHEN hidden_reason = 'reembolso_terceiros' THEN NULL ELSE hidden_reason END`;
  // Os iguais desta confirmação: classificados pela regra dela, no mesmo instante da entrada desfeita.
  const iguais = `SELECT t.id FROM transactions AS t WHERE t.household_id = ? AND t.rule_id = ${regraAtiva}
    AND t.categorized_by = 'regra'
    AND t.categorized_at = (SELECT e.categorized_at FROM transactions AS e WHERE e.id = ? AND e.household_id = ?)
    AND ${aindaDaPessoa}`;
  const paramsDosIguais = [
    householdId,
    householdId,
    transactionId,
    householdId,
    transactionId,
    householdId,
    transactionId,
    householdId,
    memberId,
  ];
  const comandos: D1PreparedStatement[] = [
    db.$client
      .prepare(`DELETE FROM fixed_income_receipts WHERE transaction_id = ? AND ${aindaDaPessoa}`)
      .bind(transactionId, transactionId, householdId, memberId),
    db.$client
      .prepare(`DELETE FROM fixed_income_receipts WHERE transaction_id IN (${iguais})`)
      .bind(...paramsDosIguais),
    db.$client.prepare(`UPDATE transactions SET ${limpa} WHERE id IN (${iguais})`).bind(...paramsDosIguais),
  ];
  const indiceDaVolta = comandos.length;
  comandos.push(
    db.$client
      .prepare(
        `UPDATE transactions SET ${limpa} WHERE id = ? AND household_id = ? AND categorized_by = ? AND income_kind IS NOT NULL
        RETURNING id`,
      )
      .bind(transactionId, householdId, memberId),
  );
  comandos.push(
    db.$client
      .prepare(
        `UPDATE rules SET disabled_at = ? WHERE id = ${regra} AND household_id = ?
          AND NOT EXISTS (SELECT 1 FROM transactions AS u WHERE u.household_id = ? AND u.rule_id = rules.id)`,
      )
      .bind(agora, householdId, memberId, transactionId, householdId, householdId, householdId),
  );
  return { comandos, indiceDaVolta };
}
