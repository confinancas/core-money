// Consultas da fila Para categorizar (TASK-0304): o que é pendente, o tipo de cada linha, as contagens e a página.
// Uma ida ao D1 por rota (db.batch com a contagem e a página). Os textos usam o alias t da transactions, o c das
// categorias da sugestão, o r da renda fixa da sugestão e o b do banco. Sem sugestão, a linha continua na fila.
import {
  INCOME_CANDIDATE_MOVEMENTS,
  NEEDS_CATEGORY_SQL,
  NEEDS_INCOME_SQL,
} from "../../shared/categorization";
import type { FiltroDaFila, TipoDaLinha } from "../../shared/para-categorizar";
import type { Db } from "../db/client";

export const TAMANHO_DA_PAGINA = 50;

const lista = (valores: readonly string[]): string => valores.map((valor) => `'${valor}'`).join(", ");

// Pendente: do lar, visível, não removida, fora do histórico, sem categorização, e que pede categoria ou entrada.
// Usa o índice (household_id, categorized_at) da TASK-0202.
export const PENDING_SQL = `t.household_id = ? AND t.hidden = 0 AND t.removed_at IS NULL AND t.is_backfill = 0
  AND t.categorized_at IS NULL AND ((${NEEDS_CATEGORY_SQL} AND t.category_id IS NULL) OR ${NEEDS_INCOME_SQL})`;

// Tipo da linha: cartão (tem card_id), Pix e TED enviados, entrada (candidata com valor positivo), o resto.
export const TIPO_DA_LINHA_SQL = `(CASE WHEN t.card_id IS NOT NULL THEN 'cartao'
    WHEN t.movement IN ('pix_enviado', 'ted_enviada') THEN 'pix'
    WHEN t.movement IN (${lista(INCOME_CANDIDATE_MOVEMENTS)}) AND t.amount_cents > 0 THEN 'entrada'
    ELSE 'outro' END)`;

// A linha tem sugestão utilizável: categoria ativa (saída), ou renda ativa quando há renda fixa (entrada).
export const TEM_SUGESTAO_SQL = `(CASE WHEN ${TIPO_DA_LINHA_SQL} = 'entrada'
    THEN (t.ai_income_kind IS NOT NULL AND (t.ai_fixed_income_id IS NULL OR r.id IS NOT NULL))
    ELSE (c.id IS NOT NULL) END)`;

// Junções da fila. Categoria arquivada e renda excluída não contam como sugestão (LEFT JOIN com archived_at nulo).
const FROM_DA_FILA = `FROM transactions AS t INDEXED BY transactions_household_categorized_idx
  LEFT JOIN categories AS c ON c.id = t.ai_category_id AND c.household_id = t.household_id AND c.archived_at IS NULL
  LEFT JOIN fixed_incomes AS r ON r.id = t.ai_fixed_income_id AND r.household_id = t.household_id AND r.archived_at IS NULL
  LEFT JOIN bank_items AS b ON b.id = t.bank_item_id`;

const TIPO_DO_FILTRO: Record<Exclude<FiltroDaFila, "todos">, TipoDaLinha> = {
  pix: "pix",
  cartao: "cartao",
  entradas: "entrada",
};

// Contagem por filtro e sugestões por filtro, numa só linha (SUM sobre o pendente).
export function queueCountsStmt(db: Db, householdId: string): D1PreparedStatement {
  return db.$client
    .prepare(
      `SELECT COUNT(*) AS todos,
        IFNULL(SUM(q.tipo = 'pix'), 0) AS pix,
        IFNULL(SUM(q.tipo = 'cartao'), 0) AS cartao,
        IFNULL(SUM(q.tipo = 'entrada'), 0) AS entradas,
        IFNULL(SUM(q.tem), 0) AS sugeridas_todos,
        IFNULL(SUM(q.tipo = 'pix' AND q.tem = 1), 0) AS sugeridas_pix,
        IFNULL(SUM(q.tipo = 'cartao' AND q.tem = 1), 0) AS sugeridas_cartao,
        IFNULL(SUM(q.tipo = 'entrada' AND q.tem = 1), 0) AS sugeridas_entradas
      FROM (SELECT ${TIPO_DA_LINHA_SQL} AS tipo, ${TEM_SUGESTAO_SQL} AS tem ${FROM_DA_FILA} WHERE ${PENDING_SQL}) AS q`,
    )
    .bind(householdId);
}

// Página: 50 linhas (mais uma, para saber se há próxima), da mais recente para a mais antiga. O filtro e o cursor
// entram na consulta; o desempate é o id.
export function queuePageStmt(
  db: Db,
  entrada: { householdId: string; filtro: FiltroDaFila; cursor: { localDate: string; id: string } | null },
): D1PreparedStatement {
  const condicoes = [PENDING_SQL];
  const valores: unknown[] = [entrada.householdId];
  if (entrada.filtro !== "todos") {
    condicoes.push(`${TIPO_DA_LINHA_SQL} = ?`);
    valores.push(TIPO_DO_FILTRO[entrada.filtro]);
  }
  if (entrada.cursor) {
    condicoes.push("(t.local_date < ? OR (t.local_date = ? AND t.id < ?))");
    valores.push(entrada.cursor.localDate, entrada.cursor.localDate, entrada.cursor.id);
  }
  return db.$client
    .prepare(
      `SELECT t.id AS id, t.movement AS movement, t.amount_cents AS amount_cents, t.local_date AS local_date,
        t.original_description AS original_description, t.custom_name AS custom_name,
        t.counterparty_name AS counterparty_name, b.institution_name AS banco, t.card_id AS card_id,
        ${TIPO_DA_LINHA_SQL} AS tipo, ${TEM_SUGESTAO_SQL} AS tem,
        c.id AS categoria_id, c.name AS categoria_nome, c.color AS categoria_cor,
        t.ai_confidence AS confianca, t.ai_reason AS motivo,
        t.ai_income_kind AS renda_tipo, t.ai_income_subtype AS renda_subtipo, r.name AS renda_nome
      ${FROM_DA_FILA}
      WHERE ${condicoes.join(" AND ")}
      ORDER BY t.local_date DESC, t.id DESC LIMIT ${TAMANHO_DA_PAGINA + 1}`,
    )
    .bind(...valores);
}

// Cursor opaco: base64url de "AAAA-MM-DD|id". Devolve null quando o texto não é um cursor válido.
const BYTES_PARA_TEXTO = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => String.fromCharCode(b)).join("");

export function encodeCursor(localDate: string, id: string): string {
  const bytes = new TextEncoder().encode(`${localDate}|${id}`);
  return btoa(BYTES_PARA_TEXTO(bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(texto: string): { localDate: string; id: string } | null {
  if (!/^[A-Za-z0-9_-]+$/.test(texto)) return null;
  const base64 = texto
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(texto.length / 4) * 4, "=");
  let bruto: string;
  try {
    const binario = atob(base64);
    bruto = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      Uint8Array.from(binario, (c) => c.charCodeAt(0)),
    );
  } catch {
    return null;
  }
  const partes = bruto.split("|");
  if (partes.length !== 2) return null;
  const [localDate, id] = partes as [string, string];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || id === "") return null;
  return { localDate, id };
}
