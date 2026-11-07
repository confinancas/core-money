import type { Db } from "../db/client";
import { classifyMovements } from "./classify";

export type AfterIngestContext = {
  householdId: string;
  bankItemId: string;
  insertedIds: string[];
  updatedIds: string[];
  now: string;
};

// Passos depois de cada gravação. Ordem fixa: cada task acrescenta o seu, nesta ordem, sem trocar a sequência.
//   1. classificação de movimentos (TASK-0207): as inseridas e as atualizadas
//   2. cycle_key (TASK-0801)
//   3. processNewTransactions(db, householdId, insertedIds, now) (TASK-0302): só com os inseridos, em lotes de até 100
export async function afterIngest(db: Db, ctx: AfterIngestContext): Promise<void> {
  await classifyMovements(db, ctx.householdId, [...ctx.insertedIds, ...ctx.updatedIds], ctx.now);
}
