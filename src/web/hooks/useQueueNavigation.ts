import { useCallback, useEffect, useState } from "react";
import { fetchQueue, type LinhaDaFila } from "../api/categorization";

// Modo fila (TASK-0404): "1 de 8 para categorizar" e "Salvar e ir para o próximo". A fila é a da TASK-0304 (filtro todos,
// local_date desc e id desc). nextInQueue e withQueueParam são puros e também servem à TASK-0401 e à TASK-0903.

export type ItemDaFila = { transactionId: string; localDate: string; detailPath: string };

// O próximo item da fila depois do atual: o primeiro que vem depois dele na ordem da lista (data menor, ou igual com id
// menor). Sem um depois, o primeiro diferente do atual. Lista vazia ou só o atual: null.
export function nextInQueue(
  items: readonly ItemDaFila[],
  atual: { id: string; localDate: string },
): ItemDaFila | null {
  const depois = items.find(
    (item) =>
      item.transactionId !== atual.id &&
      (item.localDate < atual.localDate || (item.localDate === atual.localDate && item.transactionId < atual.id)),
  );
  if (depois) return depois;
  return items.find((item) => item.transactionId !== atual.id) ?? null;
}

// Acrescenta ?fila=1 aos caminhos de detalhe que entram no modo fila (Pix, compra e Pix recebido). Outros ficam como estão.
export function withQueueParam(detailPath: string): string {
  const ehDetalhe =
    detailPath.startsWith("/pix/") || detailPath.startsWith("/compras/") || detailPath.startsWith("/pix-recebido/");
  if (!ehDetalhe) return detailPath;
  return detailPath.includes("?") ? `${detailPath}&fila=1` : `${detailPath}?fila=1`;
}

// Lê a fila (uma página de 50 por vez, até 4 páginas) e acha o item atual. position é null quando ele já não está na fila.
export type EstadoDaFila = {
  total: number;
  position: number | null;
  faltam: number;
  itens: ItemDaFila[];
};

const MAXIMO_DE_PAGINAS = 4;

export async function lerFila(transactionId: string): Promise<EstadoDaFila> {
  const todos: ItemDaFila[] = [];
  let total = 0;
  let cursor: string | undefined;
  let posicao: number | null = null;
  for (let pagina = 0; pagina < MAXIMO_DE_PAGINAS; pagina++) {
    const resposta = await fetchQueue("todos", cursor);
    total = resposta.counts.todos;
    for (const linha of resposta.items as LinhaDaFila[]) {
      todos.push({ transactionId: linha.transactionId, localDate: linha.localDate, detailPath: linha.detailPath });
    }
    const achado = todos.findIndex((item) => item.transactionId === transactionId);
    if (achado !== -1) {
      posicao = achado + 1;
      break;
    }
    if (resposta.nextCursor === null) break;
    cursor = resposta.nextCursor;
  }
  const faltam = posicao === null ? total : Math.max(total - 1, 0);
  return { total, position: posicao, faltam, itens: todos };
}

// Hook da tela: lê a fila quando ativo, e goNext releitura e leva ao próximo item (ou à fila vazia).
export function useQueueNavigation(transactionId: string, ativo: boolean) {
  const [estado, setEstado] = useState<EstadoDaFila | null>(null);

  const recarregar = useCallback(async () => {
    if (!ativo) return null;
    const lido = await lerFila(transactionId);
    setEstado(lido);
    return lido;
  }, [ativo, transactionId]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  // Devolve o caminho do próximo item. Quem chama navega; sem próximo, o caminho é a fila (estado vazio da 0304).
  const proximoCaminho = useCallback(async (): Promise<string> => {
    const lido = await lerFila(transactionId);
    setEstado(lido);
    const proximo = nextInQueue(lido.itens, { id: transactionId, localDate: lido.itens.find((i) => i.transactionId === transactionId)?.localDate ?? "" });
    return proximo ? withQueueParam(proximo.detailPath) : "/para-categorizar";
  }, [transactionId]);

  return { estado, recarregar, proximoCaminho };
}
