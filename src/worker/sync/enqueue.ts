// Envio de uma fatia para a fila (Cloudflare Queues). Módulo sem dependências do pacote da importação, para que o
// fluxo de conectar (pluggy/connections.ts) o use sem ciclo de importação.
import type { Env } from "../env";
import type { SyncMessage } from "./plan";

// Sem a fila configurada, a conexão ainda é gravada: o cron retoma a execução (retomar-importacoes).
export async function enqueueSlice(env: Env, mensagem: SyncMessage, atrasoSegundos = 0): Promise<void> {
  if (!env.SYNC_QUEUE) throw new Error("fila de sincronização não configurada");
  await env.SYNC_QUEUE.send(mensagem, { delaySeconds: atrasoSegundos });
}
