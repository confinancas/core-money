import type { ListaDeNotificacoes, NotificacaoDaLista } from "../../../shared/notifications/api";
import { ehTipoDeNotificacao } from "../../../shared/notifications/kinds";

// Uma notificação que a tela consegue mostrar: tipo do catálogo e data de criação válida. O servidor e o CHECK da
// tabela já impedem os dois casos hoje; a tela não cai se um deles chegar mesmo assim (a TASK-0112 põe itens novos na
// lista). O item fora do esperado some, e o resto da lista aparece.
export function itemValido(item: NotificacaoDaLista): boolean {
  return ehTipoDeNotificacao(item.kind) && !Number.isNaN(Date.parse(item.createdAt));
}

export function soItensValidos(lista: ListaDeNotificacoes): ListaDeNotificacoes {
  return {
    unreadCount: lista.unreadCount,
    new: lista.new.filter(itemValido),
    previous: lista.previous.filter(itemValido),
  };
}
