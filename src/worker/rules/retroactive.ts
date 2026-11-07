import { applyRuleRetroactiveSliceStmts, statusDaRegraStmt } from "../categorization/apply";
import type { Db } from "../db/client";

// Uma fatia do "Aplicar a todas" (TASK-0302) numa ida ao D1: o status da regra e a fatia (4 UPDATE e o COUNT) vão no
// mesmo lote, e a regra é lida dentro da própria fatia. Devolve quantas mudaram e quantas faltam. Regra de outro lar
// ou inexistente: "nao_encontrada" (404). Regra desativada: "regra_inativa" (409).

export type FatiaRetroativa =
  | { ok: true; applied: number; remaining: number }
  | { ok: false; motivo: "nao_encontrada" | "regra_inativa" };

export async function runRetroactiveSlice(
  db: Db,
  householdId: string,
  ruleId: string,
  now: string,
): Promise<FatiaRetroativa> {
  const comandos = [
    statusDaRegraStmt(db, householdId, ruleId),
    ...applyRuleRetroactiveSliceStmts(db, { householdId, ruleId, excludeTransactionId: null, now }),
  ];
  const resultados = await db.$client.batch(comandos);
  const status = resultados[0]?.results?.[0] as { existe: number; ativa: number } | undefined;
  if (!status || status.existe === 0) return { ok: false, motivo: "nao_encontrada" };
  if (status.ativa === 0) return { ok: false, motivo: "regra_inativa" };

  const fatia = resultados.slice(1);
  const applied = fatia.slice(0, -1).reduce((total, resultado) => total + (resultado.meta?.changes ?? 0), 0);
  const contagem = fatia[fatia.length - 1]?.results?.[0] as { restantes: number } | undefined;
  return { ok: true, applied, remaining: contagem?.restantes ?? 0 };
}
