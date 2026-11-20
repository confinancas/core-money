import { INCOME_CANDIDATE_MOVEMENTS } from "../../shared/categorization";
import {
  applyClassificationDelta,
  type ClassificacaoDeEntrada,
  type EntradaDoCiclo,
  INCOME_OPTIONS,
  type IncomeOption,
  type RendaNoCiclo,
  summarizeCycleIncome,
} from "../../shared/income";
import { COUNTERPARTY_KEY_SQL, chaveVazia, type RuleSet } from "../../shared/rule-match";
import type { Db } from "../db/client";
import { computeCycleIncome } from "./cycle-income";
import { addTransactionReceiptStmts, removeTransactionReceiptStmt } from "./receipts";

// Classificação de uma entrada (TASK-0903): leitura, prévia e escrita. Cada rota faz 2 lotes ao D1 (db.$client.batch):
// o primeiro lê a transação, as rendas ativas e a regra; o segundo é o cálculo da renda do ciclo (prévia e GET) ou as
// escritas (PUT, aceite, histórico). Nenhuma rota tem laço sobre o lar: os iguais saem de uma escrita por chave.

const MOVIMENTOS_DE_ENTRADA = INCOME_CANDIDATE_MOVEMENTS.map((movimento) => `'${movimento}'`).join(", ");
// Movimentos que a regra de remetente casa (SCOPE_MOVEMENTS.remetente, em shared/rule-match.ts).
const MOVIMENTOS_DO_REMETENTE = "'pix_recebido', 'ted_recebida'";

export type LinhaDaEntrada = {
  id: string;
  movement: string;
  amount_cents: number;
  occurred_at: string;
  local_date: string;
  cycle_key: string | null;
  income_kind: string | null;
  income_subtype: string | null;
  fixed_income_id: string | null;
  hidden: number;
  hidden_reason: string | null;
  categorized_by: string | null;
  is_backfill: number;
  categorized_at: string | null;
  original_description: string;
  counterparty_name: string | null;
  counterparty_doc_masked: string | null;
  counterparty_bank: string | null;
  pix_key_masked: string | null;
  ai_income_kind: string | null;
  ai_income_subtype: string | null;
  ai_fixed_income_id: string | null;
  ai_confidence: string | null;
  ai_reason: string | null;
  contraparte_chave: string;
  institution_name: string | null;
  connection_label: string | null;
  starts_on: string | null;
  ends_on: string | null;
};

export type RendaAtiva = {
  id: string;
  name: string;
  currency: string;
  amount_cents: number;
  kept_usd_is_investment: number;
};
export type RegraDoRemetente = {
  id: string;
  set_income_kind: string | null;
  set_income_subtype: string | null;
  set_fixed_income_id: string | null;
};

export type Contexto = {
  linha: LinhaDaEntrada | null;
  rendas: RendaAtiva[];
  regra: RegraDoRemetente | null;
};

const SQL_ENTRADA = `SELECT t.id AS id, t.movement AS movement, t.amount_cents AS amount_cents, t.occurred_at AS occurred_at,
    t.local_date AS local_date,
    t.cycle_key AS cycle_key, t.income_kind AS income_kind, t.income_subtype AS income_subtype,
    t.fixed_income_id AS fixed_income_id, t.hidden AS hidden, t.hidden_reason AS hidden_reason,
    t.categorized_by AS categorized_by, t.is_backfill AS is_backfill, t.original_description AS original_description,
    t.counterparty_name AS counterparty_name, t.counterparty_doc_masked AS counterparty_doc_masked,
    t.counterparty_bank AS counterparty_bank, t.pix_key_masked AS pix_key_masked,
    t.ai_income_kind AS ai_income_kind, t.ai_income_subtype AS ai_income_subtype, t.ai_fixed_income_id AS ai_fixed_income_id,
    t.ai_confidence AS ai_confidence, t.ai_reason AS ai_reason, ${COUNTERPARTY_KEY_SQL} AS contraparte_chave,
    bi.institution_name AS institution_name, pc.label AS connection_label, cy.starts_on AS starts_on, cy.ends_on AS ends_on
  FROM transactions AS t
  LEFT JOIN bank_items AS bi ON bi.id = t.bank_item_id
  LEFT JOIN pluggy_connections AS pc ON pc.id = bi.connection_id AND pc.household_id = t.household_id
  LEFT JOIN cycles AS cy ON cy.household_id = t.household_id AND cy.key = t.cycle_key
  WHERE t.id = ? AND t.household_id = ?`;

const SQL_RENDAS_ATIVAS = `SELECT id, name, currency, amount_cents, kept_usd_is_investment FROM fixed_incomes
  WHERE household_id = ? AND archived_at IS NULL ORDER BY name`;

// Regra remetente ativa da chave da própria transação (a chave sai do SQL, pelo id e pelo lar).
const SQL_REGRA_DO_REMETENTE = `SELECT r.id AS id, r.set_income_kind, r.set_income_subtype, r.set_fixed_income_id
  FROM rules AS r WHERE r.household_id = ? AND r.scope = 'remetente' AND r.disabled_at IS NULL
    AND r.match_value = (SELECT ${COUNTERPARTY_KEY_SQL} FROM transactions AS t WHERE t.id = ? AND t.household_id = ?)`;

// Lote de leitura: a entrada, as rendas ativas e a regra. Três comandos, uma ida.
export async function lerContexto(db: Db, householdId: string, transactionId: string): Promise<Contexto> {
  const [entrada, rendas, regra] = await db.$client.batch([
    db.$client.prepare(SQL_ENTRADA).bind(transactionId, householdId),
    db.$client.prepare(SQL_RENDAS_ATIVAS).bind(householdId),
    db.$client.prepare(SQL_REGRA_DO_REMETENTE).bind(householdId, transactionId, householdId),
  ]);
  return {
    linha: (entrada?.results?.[0] as LinhaDaEntrada | undefined) ?? null,
    rendas: (rendas?.results ?? []) as RendaAtiva[],
    regra: (regra?.results?.[0] as RegraDoRemetente | undefined) ?? null,
  };
}

export const ehEntrada = (linha: Pick<LinhaDaEntrada, "movement" | "amount_cents">): boolean =>
  (INCOME_CANDIDATE_MOVEMENTS as readonly string[]).includes(linha.movement) && linha.amount_cents > 0;

// A classificação que a linha já tem (nula quando ainda não foi classificada).
export function classificacaoDaLinha(linha: LinhaDaEntrada): ClassificacaoDeEntrada | null {
  const opcao = opcaoDoTipo(linha.income_kind);
  if (opcao === null) return null;
  return {
    option: opcao,
    fixedIncomeId: opcao === "salario" ? linha.fixed_income_id : null,
    incomeSubtype: opcao === "variavel" ? linha.income_subtype : null,
  };
}

export function opcaoDoTipo(incomeKind: string | null): IncomeOption | null {
  for (const opcao of Object.keys(INCOME_OPTIONS) as IncomeOption[]) {
    if (INCOME_OPTIONS[opcao].incomeKind === incomeKind) return opcao;
  }
  return null;
}

// Sugestão da IA como classificação, se ainda vale: renda ativa quando for parte do salário.
export function sugestaoDaLinha(
  linha: LinhaDaEntrada,
  rendas: readonly RendaAtiva[],
): ClassificacaoDeEntrada | null {
  const opcao = opcaoDoTipo(linha.ai_income_kind);
  if (opcao === null) return null;
  if (opcao === "salario") {
    const renda = rendas.find((r) => r.id === linha.ai_fixed_income_id);
    if (!renda) return null;
    return { option: "salario", fixedIncomeId: renda.id, incomeSubtype: null };
  }
  return {
    option: opcao,
    fixedIncomeId: null,
    incomeSubtype: opcao === "variavel" ? linha.ai_income_subtype : null,
  };
}

// Renda do ciclo a partir do que computeCycleIncome devolve (a mesma soma que a tela da Renda usa).
export function entradaDoCiclo(resposta: {
  variableCents: number;
  fixedIncomes: {
    id: string;
    currency: string;
    amountCents: number;
    keptUsdIsInvestment: boolean;
    receipts: { amountCents: number }[];
    fx: { rateE4: number } | null;
  }[];
}): EntradaDoCiclo {
  return {
    variavelCents: resposta.variableCents,
    rendas: resposta.fixedIncomes.map(
      (renda): RendaNoCiclo => ({
        id: renda.id,
        currency: renda.currency === "USD" ? "USD" : "BRL",
        amountCents: renda.amountCents,
        keptUsdIsInvestment: renda.keptUsdIsInvestment,
        recebidoCents: renda.receipts.reduce((soma, recebimento) => soma + recebimento.amountCents, 0),
        recebimentos: renda.receipts.length,
        fxRate: renda.fx?.rateE4 ?? null,
      }),
    ),
  };
}

// Prévia (2 lotes): a renda do ciclo antes e depois da troca. Sem ciclo, o impacto é zero (decisão de nível 1).
export async function previewIncomeClassification(
  db: Db,
  householdId: string,
  linha: LinhaDaEntrada,
  nova: ClassificacaoDeEntrada,
): Promise<{ cycleKey: string | null; beforeCents: number; afterCents: number }> {
  if (linha.cycle_key === null) return { cycleKey: null, beforeCents: 0, afterCents: 0 };
  const ciclo = await computeCycleIncome(db, householdId, linha.cycle_key);
  if (ciclo === null) return { cycleKey: linha.cycle_key, beforeCents: 0, afterCents: 0 };
  const base = entradaDoCiclo(ciclo);
  const atual = classificacaoDaLinha(linha);
  const depois = applyClassificationDelta(base, atual, nova, linha.amount_cents);
  return {
    cycleKey: linha.cycle_key,
    beforeCents: summarizeCycleIncome(base.rendas, base.variavelCents).totalCents,
    afterCents: summarizeCycleIncome(depois.rendas, depois.variavelCents).totalCents,
  };
}

// Escrita da classificação de uma entrada, em comandos do D1 (sem ida). modo "trocar": limpa o que tinha (recebimento e
// tipo) e grava o novo; "so_sem_classe": só grava se a entrada ainda não tem tipo (aceite, regra da importação e
// histórico). Recebimento de parte do salário sai junto, com confirmed_by e categorized_by. Ordem: limpa, recebimento,
// marca final (o recebimento precisa de income_kind nulo).
export function classifyIncomeStmts(
  db: Db,
  householdId: string,
  entrada: {
    linha: Pick<
      LinhaDaEntrada,
      "id" | "amount_cents" | "local_date" | "cycle_key" | "income_kind" | "fixed_income_id" | "hidden_reason"
    >;
    classificacao: ClassificacaoDeEntrada | null;
    by: string;
    confirmedBy: string;
    ruleId: string | null;
    agora: string;
    modo: "trocar" | "so_sem_classe";
  },
): D1PreparedStatement[] {
  const { linha, classificacao, agora } = entrada;
  const comandos: D1PreparedStatement[] = [];
  if (entrada.modo === "trocar") {
    if (linha.fixed_income_id !== null && linha.income_kind === "parte_salario") {
      comandos.push(...removeTransactionReceiptStmt(db, householdId, linha.fixed_income_id, linha.id));
    }
    comandos.push(
      db.$client
        .prepare(
          `UPDATE transactions AS t SET income_kind = NULL, income_subtype = NULL, fixed_income_id = NULL,
            categorized_at = NULL, categorized_by = NULL, rule_id = NULL
          WHERE t.id = ? AND t.household_id = ?`,
        )
        .bind(linha.id, householdId),
    );
  }
  if (classificacao === null) return comandos;

  const kind = INCOME_OPTIONS[classificacao.option].incomeKind;
  const fixo = classificacao.option === "salario" ? classificacao.fixedIncomeId : null;
  const subtipo = classificacao.option === "variavel" ? classificacao.incomeSubtype : null;
  if (fixo !== null && linha.cycle_key !== null) {
    comandos.push(
      ...addTransactionReceiptStmts(db, householdId, {
        receiptId: crypto.randomUUID(),
        fixedIncomeId: fixo,
        cycleKey: linha.cycle_key,
        transactionId: linha.id,
        receivedOn: linha.local_date,
        amountCents: linha.amount_cents,
        confirmedBy: entrada.confirmedBy,
        categorizedBy: entrada.by,
        agora,
      }),
    );
  }
  const reembolso = classificacao.option === "reembolso" ? 1 : 0;
  const guarda = entrada.modo === "so_sem_classe" ? "AND (t.income_kind IS NULL OR t.income_kind = ?)" : "";
  comandos.push(
    db.$client
      .prepare(
        `UPDATE transactions AS t SET income_kind = ?, income_subtype = ?, fixed_income_id = ?, categorized_at = ?,
          categorized_by = ?, rule_id = ?,
          hidden = CASE WHEN ? = 1 THEN 1 WHEN t.hidden_reason = 'reembolso_terceiros' THEN 0 ELSE t.hidden END,
          hidden_reason = CASE WHEN ? = 1 THEN 'reembolso_terceiros' WHEN t.hidden_reason = 'reembolso_terceiros' THEN NULL ELSE t.hidden_reason END
        WHERE t.id = ? AND t.household_id = ? ${guarda}`,
      )
      .bind(
        kind,
        subtipo,
        fixo,
        agora,
        entrada.by,
        entrada.ruleId,
        reembolso,
        reembolso,
        linha.id,
        householdId,
        ...(entrada.modo === "so_sem_classe" ? [kind] : []),
      ),
  );
  return comandos;
}

// Iguais que esperavam (mesma chave de remetente, sem tipo, na fila): recebem a classificação da regra no mesmo lote.
// Recebimento de parte do salário sai antes do tipo (o recebimento precisa de income_kind nulo). Devolve o índice do
// UPDATE, para ler o RETURNING (os ids que mudaram). A regra vem pela chave, no SQL.
export function iguaisDaRegraStmts(
  db: Db,
  householdId: string,
  entrada: { excludeId: string; chave: string; classificacao: ClassificacaoDeEntrada; agora: string },
): { comandos: D1PreparedStatement[]; indiceDosIguais: number } {
  const { classificacao, agora } = entrada;
  const cand = `t.household_id = ? AND t.id <> ? AND t.movement IN (${MOVIMENTOS_DO_REMETENTE}) AND t.amount_cents > 0
    AND t.income_kind IS NULL AND t.categorized_at IS NULL AND t.is_backfill = 0 AND t.removed_at IS NULL
    AND ${COUNTERPARTY_KEY_SQL} = ?`;
  const regraDaChave = `(SELECT r.id FROM rules AS r WHERE r.household_id = ? AND r.scope = 'remetente'
    AND r.match_value = ? AND r.disabled_at IS NULL)`;
  const comandos: D1PreparedStatement[] = [];
  const fixo = classificacao.option === "salario" ? classificacao.fixedIncomeId : null;
  if (fixo !== null) {
    comandos.push(
      db.$client
        .prepare(
          `INSERT INTO fixed_income_receipts (id, fixed_income_id, cycle_key, transaction_id, amount_cents, received_on,
            fx_rate, fx_date, confirmed_by)
          SELECT lower(hex(randomblob(16))), ?, t.cycle_key, t.id, t.amount_cents, t.local_date,
            (SELECT x.fx_rate FROM fixed_income_receipts AS x WHERE x.fixed_income_id = ? AND x.cycle_key = t.cycle_key
              AND x.fx_rate IS NOT NULL LIMIT 1),
            (SELECT x.fx_date FROM fixed_income_receipts AS x WHERE x.fixed_income_id = ? AND x.cycle_key = t.cycle_key
              AND x.fx_rate IS NOT NULL LIMIT 1),
            'regra'
          FROM transactions AS t
          WHERE ${cand} AND t.cycle_key IS NOT NULL
            AND EXISTS (SELECT 1 FROM fixed_incomes AS f WHERE f.id = ? AND f.household_id = t.household_id AND f.archived_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM fixed_income_receipts AS y WHERE y.transaction_id = t.id)`,
        )
        .bind(fixo, fixo, fixo, householdId, entrada.excludeId, entrada.chave, fixo),
    );
  }
  const indiceDosIguais = comandos.length;
  const reembolso = classificacao.option === "reembolso" ? 1 : 0;
  comandos.push(
    db.$client
      .prepare(
        `UPDATE transactions AS t SET income_kind = ?, income_subtype = ?, fixed_income_id = ?, categorized_at = ?,
          categorized_by = 'regra', rule_id = ${regraDaChave},
          hidden = CASE WHEN ? = 1 THEN 1 ELSE t.hidden END,
          hidden_reason = CASE WHEN ? = 1 THEN 'reembolso_terceiros' ELSE t.hidden_reason END
        WHERE ${cand}
        RETURNING id`,
      )
      .bind(
        INCOME_OPTIONS[classificacao.option].incomeKind,
        classificacao.option === "variavel" ? classificacao.incomeSubtype : null,
        fixo,
        agora,
        householdId,
        entrada.chave,
        reembolso,
        reembolso,
        householdId,
        entrada.excludeId,
        entrada.chave,
      ),
  );
  return { comandos, indiceDosIguais };
}

// Regra remetente de "Lembrar" (PUT): desativa a ativa da chave e cria a nova, sem mesclar (cada opção grava o seu).
export function regraDoRemetenteStmts(
  db: Db,
  householdId: string,
  entrada: {
    chave: string;
    classificacao: ClassificacaoDeEntrada;
    lembrar: boolean;
    regraAtiva: RegraDoRemetente | null;
    memberId: string;
    agora: string;
    id: string;
  },
): D1PreparedStatement[] {
  const { classificacao } = entrada;
  if (!entrada.lembrar) {
    if (entrada.regraAtiva === null) return [];
    return [
      db.$client
        .prepare("UPDATE rules SET disabled_at = ? WHERE id = ? AND household_id = ? AND disabled_at IS NULL")
        .bind(entrada.agora, entrada.regraAtiva.id, householdId),
    ];
  }
  if (chaveVazia(entrada.chave)) throw new RangeError("Regra sem chave de casamento.");
  const nova: RuleSet = {
    setCustomName: null,
    setCategoryId: null,
    setSpendType: null,
    setIncomeKind: INCOME_OPTIONS[classificacao.option].incomeKind,
    setIncomeSubtype: classificacao.option === "variavel" ? classificacao.incomeSubtype : null,
    setFixedIncomeId: classificacao.option === "salario" ? classificacao.fixedIncomeId : null,
    setMovement: null,
  };
  return [
    db.$client
      .prepare(
        "UPDATE rules SET disabled_at = ? WHERE household_id = ? AND scope = 'remetente' AND match_value = ? AND disabled_at IS NULL",
      )
      .bind(entrada.agora, householdId, entrada.chave),
    db.$client
      .prepare(
        `INSERT INTO rules (id, household_id, scope, match_value, set_custom_name, set_category_id, set_spend_type,
          set_income_kind, set_income_subtype, set_fixed_income_id, set_movement, created_from, created_by, created_at, disabled_at)
        VALUES (?, ?, 'remetente', ?, NULL, NULL, NULL, ?, ?, ?, NULL, 'lembrar', ?, ?, NULL)`,
      )
      .bind(
        entrada.id,
        householdId,
        entrada.chave,
        nova.setIncomeKind,
        nova.setIncomeSubtype,
        nova.setFixedIncomeId,
        entrada.memberId,
        entrada.agora,
      ),
  ];
}
