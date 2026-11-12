// Agendamento da sincronização diária (TASK-0205). Tarefa leve do despachante: uma leitura (bancos e execuções de hoje) e,
// só quando há o que agendar, uma escrita (startRun) e um envio à fila por banco. "Hoje" é o dia de São Paulo; o UTC do
// servidor não entra. Se o cron de meia-noite falhar, a execução seguinte do mesmo dia recupera (cenário 3).
import { todayInSaoPaulo } from "../../shared/sao-paulo-date";
import type { Db } from "../db/client";
import { createDb } from "../db/client";
import { newMeter } from "../db/metered-d1";
import type { Env } from "../env";
import { enqueueSlice } from "./enqueue";
import { INICIO_DO_DIA_EM_SAO_PAULO, shouldSchedule } from "./regras";
import { startRun } from "./runs";

// Um banco por linha. Desconectado não entra; sem chaves (client_id_enc nulo) não entra. Quem rodou hoje ou tem execução
// aberta vem marcado. Os dois subconjuntos usam os índices sync_runs_bank_item_started_idx e sync_runs_open_idx.
// Enquanto o banco não tem uma importação (historico) encerrada com sucesso, a execução agendada é a importação de novo
// (TASK-0205, A5): a sincronização diária sozinha só relê a janela recente e não recupera o histórico perdido. "Rodou hoje"
// vale para a diária e para a importação.
export const SQL_AGENDAR = `SELECT b.id AS bank_item_id,
    EXISTS (SELECT 1 FROM sync_runs r WHERE r.bank_item_id = b.id AND r.kind IN ('diaria', 'historico')
      AND r.started_at >= ?) AS rodou_hoje,
    EXISTS (SELECT 1 FROM sync_runs r WHERE r.bank_item_id = b.id AND r.finished_at IS NULL) AS aberta,
    EXISTS (SELECT 1 FROM sync_runs r WHERE r.bank_item_id = b.id AND r.kind = 'historico'
      AND r.finished_at IS NOT NULL AND r.status IN ('ok', 'repetiu')) AS importado
  FROM bank_items b
  JOIN pluggy_connections c ON c.id = b.connection_id
  WHERE b.disconnected_at IS NULL AND c.client_id_enc IS NOT NULL`;

export type ContextoDoAgendamento = { agora: Date; db?: Db };

// Devolve quantos bancos foram agendados nesta execução.
export async function scheduleDailySync(env: Env, ctx: ContextoDoAgendamento): Promise<number> {
  const db = ctx.db ?? createDb(env.DB, newMeter());
  const agoraIso = ctx.agora.toISOString();
  const hoje = todayInSaoPaulo(ctx.agora);
  const linhas = await db.$client
    .prepare(SQL_AGENDAR)
    .bind(INICIO_DO_DIA_EM_SAO_PAULO(hoje))
    .all<{ bank_item_id: string; rodou_hoje: number; aberta: number; importado: number }>();

  let agendados = 0;
  for (const linha of linhas.results ?? []) {
    if (!shouldSchedule(linha.rodou_hoje === 1, linha.aberta === 1)) continue;
    const tipo = linha.importado === 1 ? "diaria" : "historico";
    const runId = await startRun(db, linha.bank_item_id, tipo, agoraIso);
    if (runId === null) continue;
    await enqueueSlice(env, { runId, seq: 0 });
    agendados += 1;
  }
  return agendados;
}

// Tarefa do despachante (leve). Devolve se agendou algo; sem nada a agendar, a tarefa é só a leitura.
export const agendarSincronizacao = {
  nome: "agendar-sincronizacao",
  pesada: false,
  async executar(env: Env, agora: Date, dbMedido?: Db): Promise<boolean> {
    return (await scheduleDailySync(env, { agora, db: dbMedido })) > 0;
  },
};
