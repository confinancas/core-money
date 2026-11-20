// Ponto único para quem olha o lar inteiro depois de uma execução (TASK-0205). Chamado no fim de toda execução (as três
// espécies), antes de fechar a execução. A importação (historico) já concilia os 12 meses nas fatias da fase conciliar
// (TASK-0204, rodada 2): aqui ela não concilia de novo. A sincronização diária e a manual concilian a janela de hoje
// (15 dias, pelo reconcileHousehold da TASK-0207).

import { todayInSaoPaulo } from "../../shared/sao-paulo-date";
import { reconcileHousehold } from "../bank/classify";
import type { Db } from "../db/client";
import { conciliaAposExecucao } from "./regras";

export type EntradaDoAfterRun = {
  householdId: string;
  bankItemId: string;
  runId: string;
  now: string;
  kind: string;
};

export async function afterRun(db: Db, entrada: EntradaDoAfterRun): Promise<void> {
  if (!conciliaAposExecucao(entrada.kind)) return;
  await reconcileHousehold(db, entrada.householdId, todayInSaoPaulo(new Date(entrada.now)), entrada.now);
}
