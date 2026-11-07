import type { Db } from "../db/client";

export type AfterIngestContext = {
  householdId: string;
  bankItemId: string;
  insertedIds: string[];
  updatedIds: string[];
  now: string;
};

// Passos depois de cada gravação. Ordem fixa: cada task acrescenta o seu, nesta ordem, sem trocar a sequência.
//   1. classificação de movimentos (TASK-0207)
//   2. cycle_key (TASK-0801)
//   3. processNewTransactions(db, householdId, insertedIds, now) (TASK-0302): só com os inseridos, em lotes de até 100
// Nesta task nenhum passo existe ainda: a função fica vazia.
export async function afterIngest(_db: Db, _ctx: AfterIngestContext): Promise<void> {
  // Vazio: os passos acima entram nas tasks indicadas.
}
