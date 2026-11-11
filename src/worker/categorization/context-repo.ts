// Leitura do contexto da categorização no D1 (TASK-0303). Fica fora de context.ts para que o contexto (puro) rode nos
// testes de unidade, que não têm os tipos do D1.
import type { Db } from "../db/client";
import {
  type ContextoDeCategorizacao,
  LIMITE_DE_REGRAS,
  type LinhaCategoria,
  type LinhaRegra,
  type LinhaRenda,
  montaContexto,
} from "./context";

const SQL_CATEGORIAS = `SELECT id, name, color, parent_id, ai_hint, default_spend_type, sort FROM categories
  WHERE household_id = ? AND archived_at IS NULL`;
const SQL_RENDAS = `SELECT id, name, currency, usual_day, arrival FROM fixed_incomes
  WHERE household_id = ? AND archived_at IS NULL ORDER BY id`;
const SQL_REGRAS = `SELECT id, scope, match_value, set_category_id, set_income_kind, set_income_subtype, set_fixed_income_id,
    created_at FROM rules
  WHERE household_id = ? AND disabled_at IS NULL AND scope IN ('estabelecimento', 'destinatario', 'remetente')
  ORDER BY created_at DESC, id DESC LIMIT ${LIMITE_DE_REGRAS}`;
const SQL_DOCUMENTO = "SELECT text FROM ai_rules_document WHERE household_id = ?";

// Quatro leituras num único db.batch(): uma ida ao D1.
export async function loadCategorizationContext(
  db: Db,
  householdId: string,
): Promise<ContextoDeCategorizacao> {
  const [categorias, rendas, regras, documento] = await db.$client.batch([
    db.$client.prepare(SQL_CATEGORIAS).bind(householdId),
    db.$client.prepare(SQL_RENDAS).bind(householdId),
    db.$client.prepare(SQL_REGRAS).bind(householdId),
    db.$client.prepare(SQL_DOCUMENTO).bind(householdId),
  ]);
  const textoDoDocumento = (documento?.results?.[0] as { text?: string } | undefined)?.text ?? null;
  return montaContexto({
    categorias: (categorias?.results ?? []) as LinhaCategoria[],
    rendas: (rendas?.results ?? []) as LinhaRenda[],
    regras: (regras?.results ?? []) as LinhaRegra[],
    documento: textoDoDocumento,
  });
}
