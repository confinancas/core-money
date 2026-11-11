// Consumidor da fila de sincronização: uma fatia por mensagem, uma por vez (max_batch_size 1, max_concurrency 1).
import { createDb } from "../db/client";
import { newMeter } from "../db/metered-d1";
import type { Env } from "../env";
import { flushUsage } from "../usage/flush";
import { enqueueSlice } from "./enqueue";
import type { SyncMessage } from "./plan";
import { runSyncSlice } from "./slice";

// Forma mínima da mensagem e do lote que o handler usa (o tipo da Cloudflare tem mais campos).
export type MensagemDaFila = {
  body: SyncMessage;
  attempts: number;
  ack(): void;
  retry(opcoes?: { delaySeconds?: number }): void;
};
export type LoteDaFila = { messages: MensagemDaFila[] };

export type DependenciasDoLote = { agora?: () => Date; fetch?: typeof fetch };

// Uma mensagem por vez. Continua: enfileira a fatia seguinte e confirma. Repete: devolve à fila com o atraso.
// Encerrou ou pulou: confirma. Uma falha não prevista não deixa a mensagem em laço (já virou erro_inesperado na fatia).
// As escritas da fatia vão para o contador do dia (TASK-0109): é o que o teto de escritas da importação lê.
export async function handleSyncBatch(
  lote: LoteDaFila,
  env: Env,
  deps: DependenciasDoLote = {},
): Promise<void> {
  for (const mensagem of lote.messages) {
    const { runId, seq } = mensagem.body;
    const instante = (deps.agora ?? (() => new Date()))();
    const agora = instante.toISOString();
    const medidor = newMeter();
    let resultado: Awaited<ReturnType<typeof runSyncSlice>>;
    try {
      const db = createDb(env.DB, medidor);
      resultado = await runSyncSlice(
        env,
        { db, fetch: deps.fetch },
        { runId, seq, tentativa: mensagem.attempts },
        agora,
      );
    } catch (erro) {
      console.error(`sync lote: ${erro instanceof Error ? erro.name : "erro"}`);
      mensagem.ack();
      continue;
    } finally {
      await flushUsage(env.DB, medidor, instante);
    }

    if (resultado.tipo === "repete") {
      mensagem.retry({ delaySeconds: resultado.atrasoSegundos });
      continue;
    }
    if (resultado.tipo === "continua") {
      try {
        await enqueueSlice(env, { runId, seq: seq + 1 });
      } catch (erro) {
        // O cursor já anda: sem a próxima mensagem, o cron retoma a execução (retomar-importacoes).
        console.error(`sync enfileira: ${erro instanceof Error ? erro.name : "erro"}`);
      }
    }
    mensagem.ack();
  }
}
