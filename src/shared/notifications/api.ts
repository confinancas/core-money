// Formatos da API de notificações (TASK-0701), usados pelo Worker e pela tela.
import type { NotificationKind } from "./kinds";

export type NotificacaoDaLista = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
  createdAt: string;
};

// GET /api/notifications: as não lidas (até 50), e as lidas dos últimos 90 dias (até 30).
export type ListaDeNotificacoes = {
  unreadCount: number;
  new: NotificacaoDaLista[];
  previous: NotificacaoDaLista[];
};

export type ContagemDeNaoLidas = { count: number };

export type MarcadasDeNotificacoes = { marked: number };

// Preferências por tipo: os 11 tipos sempre presentes (ligado por padrão).
export type PreferenciasDeNotificacao = { kinds: Record<NotificationKind, boolean> };
