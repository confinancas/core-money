import type { RespostaDoCardPayment } from "../../shared/api/transactions";
import { chaveVazia, type RuleScope, type RuleSet, ruleScopeForMovement } from "../../shared/rule-match";
import { todayInSaoPaulo } from "../../shared/sao-paulo-date";
import { reconcileHousehold } from "../bank/classify";
import { applyRuleToPendingStmt, type RegraParaAplicar } from "../categorization/apply";
import type { Db } from "../db/client";
import { getRuleContextForTransaction, type RegraLida, upsertRuleStmts } from "../rules/repo";
import { applyDefaultSpendTypeStmt } from "../spend-types/derive";
import { MOVIMENTOS_DE_SAIDA } from "./detail";

// "É pagamento de cartão" (TASK-0404, PUT /api/transactions/:id/card-payment). Ligar: o movimento vira
// pagamento_fatura (a base fica em movement_original), a regra do destinatario (ou do estabelecimento, no boleto) ganha
// set_movement e mantem a categoria que ja tinha, e os iguais que esperavam recebem o movimento. Desligar: o movimento
// volta, a regra perde set_movement (fica desativada se nao sobrar nada), e o tipo padrao volta pelo passo 4 (TASK-0802).
// Um db.batch(); depois reconcileHousehold (TASK-0207), que faz o par com a linha do cartao.

export type ResultadoDoCardPayment =
  | { tipo: "ok"; resposta: RespostaDoCardPayment }
  | { tipo: "nao_encontrada" }
  | { tipo: "recusada"; mensagem: string };

const SEM_EFEITO: RuleSet = {
  setCustomName: null,
  setCategoryId: null,
  setSpendType: null,
  setIncomeKind: null,
  setIncomeSubtype: null,
  setFixedIncomeId: null,
  setMovement: null,
};

type LinhaDoPagamento = {
  movement: string;
  movement_original: string | null;
  amount_cents: number;
  card_id: string | null;
  hidden: number;
};

export async function marcarPagamentoDeCartao(
  db: Db,
  entrada: {
    householdId: string;
    memberId: string;
    transactionId: string;
    isCardPayment: boolean;
    now: Date;
  },
): Promise<ResultadoDoCardPayment> {
  const { householdId, memberId, transactionId, isCardPayment } = entrada;
  const nowIso = entrada.now.toISOString();

  const linha = await db.$client
    .prepare(
      `SELECT movement, movement_original, amount_cents, card_id, hidden FROM transactions
       WHERE id = ? AND household_id = ? AND removed_at IS NULL`,
    )
    .bind(transactionId, householdId)
    .first<LinhaDoPagamento>();
  if (!linha) return { tipo: "nao_encontrada" };

  const base = linha.movement_original ?? linha.movement;
  const emPagamento = linha.movement === "pagamento_fatura";
  // So saida de conta, nao ocultada e sem cartao (cenarios 16 a 18).
  if (
    linha.card_id !== null ||
    linha.hidden === 1 ||
    linha.amount_cents >= 0 ||
    !MOVIMENTOS_DE_SAIDA.includes(base)
  ) {
    return { tipo: "recusada", mensagem: "Só uma saída de conta pode ser pagamento de cartão." };
  }
  // Ja no estado pedido: nada a gravar.
  if (isCardPayment === emPagamento) return { tipo: "ok", resposta: { isCardPayment, alsoMarked: 0 } };

  const escopo: RuleScope | null = ruleScopeForMovement(base);
  if (escopo === null) return { tipo: "recusada", mensagem: "Esta transação não pode virar regra." };

  const contexto = await getRuleContextForTransaction(db, householdId, transactionId, null);
  const transacao = contexto.transacao;
  if (!transacao) return { tipo: "nao_encontrada" };
  const chave = (escopo === "destinatario" ? transacao.counterpartyKey : transacao.establishmentKey) ?? "";
  const ativa: RegraLida | null =
    escopo === "destinatario" ? contexto.regraDestinatario : contexto.regraEstabelecimento;

  const comandos: D1PreparedStatement[] = [];
  let indiceDaAplicacao: number | null = null;

  if (isCardPayment) {
    if (chaveVazia(chave)) {
      return {
        tipo: "recusada",
        mensagem: "Esta transação não tem estabelecimento nem contraparte para lembrar.",
      };
    }
    // Sai do tipo padrao (origem "padrao"); escolhido e regra ficam como estao.
    comandos.push(
      db.$client
        .prepare(
          `UPDATE transactions AS t SET movement_original = COALESCE(movement_original, movement), movement = 'pagamento_fatura',
             movement_locked = 1, fixed_bill_id = NULL, categorized_at = ?, categorized_by = ?,
             spend_type = CASE WHEN spend_type_source = 'padrao' THEN NULL ELSE spend_type END,
             spend_type_source = CASE WHEN spend_type_source = 'padrao' THEN NULL ELSE spend_type_source END
           WHERE t.id = ? AND t.household_id = ? AND t.removed_at IS NULL`,
        )
        .bind(nowIso, memberId, transactionId, householdId),
    );
    // Lembrar: a regra ganha set_movement (mescla: mantem a categoria que ja tinha).
    const up = upsertRuleStmts(db, {
      householdId,
      scope: escopo,
      matchValue: chave,
      ativa,
      nova: { ...SEM_EFEITO, setMovement: "pagamento_fatura" },
      createdFrom: "lembrar",
      createdBy: memberId,
      now: nowIso,
    });
    comandos.push(...up.comandos);
    const regra: RegraParaAplicar = {
      id: up.id,
      scope: escopo,
      matchValue: chave,
      setCustomName: null,
      // A categoria que a regra já tinha segue na regra; a escrita (escritaDaRegra) ignora a categoria com movimento.
      setCategoryId: ativa !== null && ativa.categoriaAtiva ? up.mesclada.setCategoryId : null,
      setSpendType: null,
      setMovement: "pagamento_fatura",
    };
    const aplicacao = applyRuleToPendingStmt(db, {
      householdId,
      rule: regra,
      excludeTransactionId: transactionId,
      now: nowIso,
    });
    if (aplicacao !== null) {
      indiceDaAplicacao = comandos.length;
      comandos.push(aplicacao);
    }
  } else {
    // Desligar: a regra perde set_movement; sem mais nada (categoria, tipo, nome), fica desativada.
    if (ativa !== null && ativa.setMovement !== null) {
      comandos.push(
        db.$client
          .prepare(
            `UPDATE rules SET set_movement = NULL,
               disabled_at = CASE WHEN set_category_id IS NULL AND set_spend_type IS NULL AND set_custom_name IS NULL
                 AND set_income_kind IS NULL AND set_income_subtype IS NULL AND set_fixed_income_id IS NULL
                 THEN ? ELSE disabled_at END
             WHERE id = ? AND household_id = ? AND disabled_at IS NULL`,
          )
          .bind(nowIso, ativa.id, householdId),
      );
    }
    // Volta a base; sem categoria, sai da fila (categorized_* nulos).
    comandos.push(
      db.$client
        .prepare(
          `UPDATE transactions AS t SET movement = movement_original,
             categorized_at = CASE WHEN category_id IS NULL THEN NULL ELSE categorized_at END,
             categorized_by = CASE WHEN category_id IS NULL THEN NULL ELSE categorized_by END
           WHERE t.id = ? AND t.household_id = ? AND t.removed_at IS NULL AND t.movement_original IS NOT NULL`,
        )
        .bind(transactionId, householdId),
    );
    // Passo 4 (TASK-0802): a saida que volta recebe o tipo da categoria, ou o padrao, com a origem certa.
    comandos.push(applyDefaultSpendTypeStmt(db, householdId, [transactionId]));
  }

  const resultados = await db.$client.batch(comandos);
  const alsoMarked = indiceDaAplicacao === null ? 0 : (resultados[indiceDaAplicacao]?.results?.length ?? 0);

  await reconcileHousehold(db, householdId, todayInSaoPaulo(entrada.now), nowIso);
  return { tipo: "ok", resposta: { isCardPayment, alsoMarked } };
}
