import { processNewTransactions } from "../categorization/pipeline";
import { assignCycleKeys, assignCycleKeysDoEscopo } from "../cycle/calendar";
import type { Db } from "../db/client";
import { applySpendTypesOnImport } from "../spend-types/derive";
import { classifyMovements } from "./classify";

export type AfterIngestContext = {
  householdId: string;
  bankItemId: string;
  insertedIds: string[];
  updatedIds: string[];
  now: string;
};

// Limite de ids por chamada do pipeline de regras (lotes de até 100, como manda a TASK-0302).
const LOTE_DO_PIPELINE = 100;

// Passos depois de cada gravação. Ordem fixa: cada task acrescenta o seu, nesta ordem, sem trocar a sequência.
//   1. classificação de movimentos (TASK-0207): as inseridas e as atualizadas
//   2. cycle_key (TASK-0801): calendário que cobre as datas, e ciclo dos ids e dos cartões tocados
//   3. processNewTransactions (TASK-0302): regras, só com as inseridas, em lotes de até 100. Entra depois da
//      classificação para que a regra enxergue o movimento já classificado (pagamento de fatura, transferência).
//      As TASK-0303, 0902 e 0903 acrescentam os seus passos depois deste.
//   4. tipo de gasto (TASK-0802): padrão e regras automáticas (corretora, caixinha), só nas inseridas, em lotes de 100.
//      Depois do pipeline, para que a categoria e a regra de categoria já tenham gravado o tipo delas.
export async function afterIngest(db: Db, ctx: AfterIngestContext): Promise<void> {
  const ids = [...ctx.insertedIds, ...ctx.updatedIds];
  await classifyMovements(db, ctx.householdId, ids, ctx.now);
  await assignCycleKeys(db, ctx.householdId, ids);
  for (let inicio = 0; inicio < ctx.insertedIds.length; inicio += LOTE_DO_PIPELINE) {
    const lote = ctx.insertedIds.slice(inicio, inicio + LOTE_DO_PIPELINE);
    await processNewTransactions(db, ctx.householdId, lote, ctx.now);
  }
  for (let inicio = 0; inicio < ctx.insertedIds.length; inicio += LOTE_DO_PIPELINE) {
    const lote = ctx.insertedIds.slice(inicio, inicio + LOTE_DO_PIPELINE);
    await applySpendTypesOnImport(db, ctx.householdId, lote);
  }
}

// Reavaliação do ciclo de todos os lançamentos e faturas de um cartão (TASK-0204, B1-2). A gravação só reavalia os
// ids que grava; quando uma fatura muda de data ou herda lançamentos (upsertBillsStmts, na fase de faturas), o ciclo
// dos lançamentos do cartão muda, e isso se refaz aqui. Chamar uma vez por execução, depois de upsertBillsStmts.
export async function reavaliarCartaoInteiro(db: Db, householdId: string, cardId: string): Promise<void> {
  await assignCycleKeysDoEscopo(db, householdId, { cardIds: [cardId] });
}
