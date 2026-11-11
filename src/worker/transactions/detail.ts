import type { CorpoDoPatch, DetalheDaCompra } from "../../shared/api/transactions";
import { addDays, addMonthsClamped } from "../../shared/cycle";
import type { SpendType } from "../../shared/spend-types";
import { displayName } from "../../shared/transactions/display-name";
import type { Db } from "../db/client";
import { assertSpendTypeAllowed } from "../spend-types/resolve";

// Compra (TASK-0403): o detalhe e o PATCH de nome próprio, tipo e ocultar. Toda leitura e escrita filtra pelo lar da
// sessão (id de outro lar é "não encontrada"). A descrição original nunca é gravada aqui. A categoria não passa por
// aqui: é a rota PUT /api/transactions/:id/category (apply.ts).

// Movimentos que podem ser ocultados (gasto de terceiros). Entrada e pagamento de fatura não.
const MOVIMENTOS_OCULTAVEIS: readonly string[] = [
  "compra",
  "estorno",
  "pix_enviado",
  "ted_enviada",
  "debito",
  "boleto",
  "outro",
];

// Movimentos que têm tipo de gasto (TASK-0802): saídas de conta ou de cartão, e o estorno. Entrada, pagamento de
// fatura e transferência não têm tipo.
const MOVIMENTOS_COM_TIPO: readonly string[] = [
  "compra",
  "estorno",
  "pix_enviado",
  "ted_enviada",
  "debito",
  "boleto",
  "outro",
];

// Uma consulta só: a transação com categoria (e a mãe), sugestão da IA, cartão ou conta, fatura, ciclo e o dia de
// início do lar. O lar entra no WHERE e em cada junção, e a transação removida não aparece.
const SQL_DETALHE = `SELECT t.id AS id, t.movement AS movement, t.local_date AS local_date, t.occurred_at AS occurred_at,
    t.amount_cents AS amount_cents, t.original_description AS original_description, t.custom_name AS custom_name,
    t.counterparty_name AS counterparty_name, t.category_id AS category_id, cat.name AS category_name,
    pai.name AS category_parent_name, t.categorized_by AS categorized_by, t.ai_category_id AS ai_category_id,
    sug.name AS ai_category_name, t.ai_confidence AS ai_confidence, t.spend_type AS spend_type,
    t.spend_type_source AS spend_type_source, t.hidden AS hidden, t.hidden_reason AS hidden_reason,
    t.installment_number AS installment_number, t.installment_total AS installment_total,
    t.card_id AS card_id, c.last4 AS card_last4, cbi.institution_name AS card_bank,
    t.account_id AS account_id, abi.institution_name AS account_bank,
    b.closes_on AS bill_closes_on, b.due_on AS bill_due_on,
    t.cycle_key AS cycle_key, k.starts_on AS cycle_starts_on, k.ends_on AS cycle_ends_on,
    h.cycle_start_day AS dia_do_lar
  FROM transactions AS t
    JOIN households AS h ON h.id = t.household_id
    LEFT JOIN categories AS cat ON cat.id = t.category_id AND cat.household_id = t.household_id
    LEFT JOIN categories AS pai ON pai.id = cat.parent_id AND pai.household_id = t.household_id
    LEFT JOIN categories AS sug ON sug.id = t.ai_category_id AND sug.household_id = t.household_id
    LEFT JOIN cards AS c ON c.id = t.card_id
    LEFT JOIN bank_items AS cbi ON cbi.id = c.bank_item_id
    LEFT JOIN accounts AS a ON a.id = t.account_id
    LEFT JOIN bank_items AS abi ON abi.id = a.bank_item_id
    LEFT JOIN bills AS b ON b.id = t.bill_id
    LEFT JOIN cycles AS k ON k.household_id = t.household_id AND k.key = t.cycle_key
  WHERE t.id = ? AND t.household_id = ? AND t.removed_at IS NULL`;

type LinhaDoDetalhe = {
  id: string;
  movement: string;
  local_date: string;
  occurred_at: string;
  amount_cents: number;
  original_description: string;
  custom_name: string | null;
  counterparty_name: string | null;
  category_id: string | null;
  category_name: string | null;
  category_parent_name: string | null;
  categorized_by: string | null;
  ai_category_id: string | null;
  ai_category_name: string | null;
  ai_confidence: string | null;
  spend_type: string | null;
  spend_type_source: string | null;
  hidden: number;
  hidden_reason: string | null;
  installment_number: number | null;
  installment_total: number | null;
  card_id: string | null;
  card_last4: string | null;
  card_bank: string | null;
  account_id: string | null;
  account_bank: string | null;
  bill_closes_on: string | null;
  bill_due_on: string | null;
  cycle_key: string | null;
  cycle_starts_on: string | null;
  cycle_ends_on: string | null;
  dia_do_lar: number | null;
};

const stmtDetalhe = (db: Db, householdId: string, id: string): D1PreparedStatement =>
  db.$client.prepare(SQL_DETALHE).bind(id, householdId);

// Quem categorizou sai como pessoa, regra ou IA. O id do membro não sai da API.
function quemCategorizou(valor: string | null): "pessoa" | "regra" | "ia" | null {
  if (valor === null) return null;
  if (valor === "regra") return "regra";
  if (valor === "ia") return "ia";
  return "pessoa";
}

// A confiança da IA vem como texto do pipeline (pouca, media ou alta); fora disso, sem grau.
function confiancaDaIa(valor: string | null): "pouca" | "média" | "alta" | null {
  if (valor === "pouca") return "pouca";
  if (valor === "media" || valor === "média") return "média";
  if (valor === "alta") return "alta";
  return null;
}

// Ciclo pelo calendário do lar quando a tabela cycles não tem a chave: começa no dia de início do mês da chave e
// termina um dia antes do mesmo dia do mês seguinte (a mesma regra do ciclo padrão da TASK-0801).
function cicloPelaChave(chave: string, dia: number): { key: string; startsOn: string; endsOn: string } {
  const inicio = `${chave}-${String(dia).padStart(2, "0")}`;
  return { key: chave, startsOn: inicio, endsOn: addDays(addMonthsClamped(inicio, 1), -1) };
}

function cicloDaLinha(linha: LinhaDoDetalhe): DetalheDaCompra["cycle"] {
  if (linha.cycle_key === null) return null;
  if (linha.cycle_starts_on !== null && linha.cycle_ends_on !== null) {
    return { key: linha.cycle_key, startsOn: linha.cycle_starts_on, endsOn: linha.cycle_ends_on };
  }
  if (linha.dia_do_lar === null) return null;
  return cicloPelaChave(linha.cycle_key, linha.dia_do_lar);
}

// Forma da resposta: as colunas viram o contrato, com a regra do nome de exibição e de quem categorizou.
export function paraDetalhe(linha: LinhaDoDetalhe): DetalheDaCompra {
  const categoria =
    linha.category_id !== null && linha.category_name !== null
      ? { id: linha.category_id, name: linha.category_name, parentName: linha.category_parent_name }
      : null;
  const sugestao =
    linha.ai_category_id !== null && linha.ai_category_name !== null
      ? {
          categoryId: linha.ai_category_id,
          name: linha.ai_category_name,
          confidence: confiancaDaIa(linha.ai_confidence),
        }
      : null;
  const parcela =
    linha.installment_number !== null && linha.installment_total !== null && linha.installment_total > 1
      ? { number: linha.installment_number, total: linha.installment_total }
      : null;
  const cartao =
    linha.card_id !== null && linha.card_last4 !== null
      ? { id: linha.card_id, label: linha.card_bank ?? "", last4: linha.card_last4 }
      : null;
  const conta = linha.account_id !== null ? { id: linha.account_id, label: linha.account_bank ?? "" } : null;
  const fatura =
    linha.bill_closes_on !== null ? { closesOn: linha.bill_closes_on, dueOn: linha.bill_due_on } : null;

  return {
    id: linha.id,
    movement: linha.movement,
    localDate: linha.local_date,
    occurredAt: linha.occurred_at,
    amountCents: linha.amount_cents,
    originalDescription: linha.original_description,
    customName: linha.custom_name,
    displayName: displayName({
      customName: linha.custom_name,
      movement: linha.movement,
      counterpartyName: linha.counterparty_name,
      originalDescription: linha.original_description,
    }),
    category: categoria,
    categorizedBy: quemCategorizou(linha.categorized_by),
    aiSuggestion: sugestao,
    spendType: (linha.spend_type as SpendType | null) ?? null,
    spendTypeSource: (linha.spend_type_source as DetalheDaCompra["spendTypeSource"]) ?? null,
    hidden: linha.hidden === 1,
    hiddenReason: linha.hidden_reason,
    installment: parcela,
    card: cartao,
    account: conta,
    bill: fatura,
    cycle: cicloDaLinha(linha),
  };
}

// GET: uma consulta num db.batch, sem soma sobre o lar. null quando a transação não é do lar (ou foi removida).
export async function getTransactionDetail(
  db: Db,
  householdId: string,
  id: string,
): Promise<DetalheDaCompra | null> {
  const [resultado] = await db.$client.batch([stmtDetalhe(db, householdId, id)]);
  const linha = resultado?.results[0] as LinhaDoDetalhe | undefined;
  return linha ? paraDetalhe(linha) : null;
}

export type ResultadoDoPatch =
  | { tipo: "ok"; detalhe: DetalheDaCompra }
  | { tipo: "nao_encontrada" }
  | {
      tipo: "recusada";
      codigo: "tipo_invalido_cartao" | "tipo_invalido" | "movimento_invalido";
      mensagem: string;
    };

// PATCH: valida com o detalhe atual; depois um UPDATE só com as colunas recebidas e a releitura, no mesmo db.batch().
// Campo que não veio não é tocado, então dois parceiros editando campos diferentes não se sobrescrevem.
export async function patchTransaction(
  db: Db,
  householdId: string,
  id: string,
  corpo: CorpoDoPatch,
): Promise<ResultadoDoPatch> {
  const atual = await getTransactionDetail(db, householdId, id);
  if (atual === null) return { tipo: "nao_encontrada" };

  const sets: string[] = [];
  const valores: unknown[] = [];

  if (corpo.customName !== undefined) {
    // Vazio ou igual à descrição original grava NULL: sem nome próprio, a tela mostra a original.
    const nome = (corpo.customName ?? "").trim();
    const valor = nome === "" || nome === atual.originalDescription.trim() ? null : nome;
    sets.push("custom_name = ?");
    valores.push(valor);
  }

  if (corpo.spendType !== undefined) {
    if (!MOVIMENTOS_COM_TIPO.includes(atual.movement)) {
      return {
        tipo: "recusada",
        codigo: "movimento_invalido",
        mensagem: "Esta transação não tem tipo de gasto.",
      };
    }
    try {
      assertSpendTypeAllowed({ cardId: atual.card?.id ?? null }, corpo.spendType);
    } catch (erro) {
      const codigo = atual.card !== null ? "tipo_invalido_cartao" : "tipo_invalido";
      return {
        tipo: "recusada",
        codigo,
        mensagem: erro instanceof Error ? erro.message : "Tipo de gasto inválido.",
      };
    }
    sets.push("spend_type = ?", "spend_type_source = 'escolhido'");
    valores.push(corpo.spendType);
  }

  if (corpo.hidden !== undefined) {
    if (!MOVIMENTOS_OCULTAVEIS.includes(atual.movement)) {
      return {
        tipo: "recusada",
        codigo: "movimento_invalido",
        mensagem: "Esta transação não pode ser ocultada aqui.",
      };
    }
    sets.push("hidden = ?", "hidden_reason = ?");
    valores.push(corpo.hidden ? 1 : 0, corpo.hidden ? "gasto_terceiros" : null);
  }

  // O schema exige ao menos um campo, então sets nunca fica vazio aqui. A descrição original não está entre as colunas.
  const update = db.$client
    .prepare(
      `UPDATE transactions SET ${sets.join(", ")} WHERE id = ? AND household_id = ? AND removed_at IS NULL`,
    )
    .bind(...valores, id, householdId);
  const [, releitura] = await db.$client.batch([update, stmtDetalhe(db, householdId, id)]);
  const linha = releitura?.results[0] as LinhaDoDetalhe | undefined;
  if (!linha) return { tipo: "nao_encontrada" };
  return { tipo: "ok", detalhe: paraDetalhe(linha) };
}
