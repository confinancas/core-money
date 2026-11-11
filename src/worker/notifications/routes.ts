// Central de notificações (TASK-0701): GET /api/notifications, o contador do sino, a leitura (uma e todas) e as
// preferências por tipo. Sessão obrigatória (o requireSession global) e lar da sessão: nada de outro lar. "Lida" vale
// para o lar inteiro (decisão do dono do produto, 2026-11-04): a primeira leitura guarda read_at.
import { Hono } from "hono";
import type {
  ContagemDeNaoLidas,
  ListaDeNotificacoes,
  MarcadasDeNotificacoes,
  NotificacaoDaLista,
  PreferenciasDeNotificacao,
} from "../../shared/notifications/api";
import {
  ehTipoDeNotificacao,
  NOTIFICATION_KINDS,
  type NotificationKind,
} from "../../shared/notifications/kinds";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";

export const LIMITE_DAS_NOVAS = 50;
export const LIMITE_DAS_ANTERIORES = 30;
export const JANELA_DAS_ANTERIORES_DIAS = 90;

// As não lidas do lar: o índice parcial (household_id) WHERE read_at IS NULL responde a contagem.
const SQL_NAO_LIDAS = "SELECT COUNT(*) AS n FROM notifications WHERE household_id = ? AND read_at IS NULL";
const SQL_NOVAS = `SELECT id, kind, title, body, link, created_at FROM notifications
WHERE household_id = ? AND read_at IS NULL
ORDER BY created_at DESC, id DESC LIMIT ?`;
const SQL_ANTERIORES = `SELECT id, kind, title, body, link, created_at FROM notifications
WHERE household_id = ? AND read_at IS NOT NULL AND created_at >= ?
ORDER BY created_at DESC, id DESC LIMIT ?`;
const SQL_LER_UMA = `UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND household_id = ?`;
const SQL_LER_TODAS = "UPDATE notifications SET read_at = ? WHERE household_id = ? AND read_at IS NULL";
const SQL_PREFERENCIAS = "SELECT kind, enabled FROM notification_prefs WHERE household_id = ?";
const SQL_GRAVAR_PREFERENCIA = `INSERT INTO notification_prefs (household_id, kind, enabled) VALUES (?, ?, ?)
ON CONFLICT (household_id, kind) DO UPDATE SET enabled = excluded.enabled`;

type LinhaDeNotificacao = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
  created_at: string;
};

const paraLista = (linha: LinhaDeNotificacao): NotificacaoDaLista => ({
  id: linha.id,
  kind: linha.kind,
  title: linha.title,
  body: linha.body,
  link: linha.link,
  createdAt: linha.created_at,
});

const ehObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

// Só {"kinds": {tipo: boolean}}, com tipos do catálogo e valores booleanos. Qualquer outra coisa é inválida.
function lerPreferencias(corpo: unknown): Partial<Record<NotificationKind, boolean>> | null {
  if (!ehObjeto(corpo)) return null;
  if (Object.keys(corpo).some((chave) => chave !== "kinds")) return null;
  const kinds = corpo.kinds;
  if (!ehObjeto(kinds)) return null;
  const lidas: Partial<Record<NotificationKind, boolean>> = {};
  for (const [chave, valor] of Object.entries(kinds)) {
    if (!ehTipoDeNotificacao(chave) || typeof valor !== "boolean") return null;
    lidas[chave] = valor;
  }
  return lidas;
}

// Os 11 tipos: o que está gravado, e ligado nos que não têm linha.
function preferenciasDoLar(linhas: { kind: string; enabled: number | boolean }[]): PreferenciasDeNotificacao {
  const kinds = Object.fromEntries(NOTIFICATION_KINDS.map((tipo) => [tipo, true])) as Record<
    NotificationKind,
    boolean
  >;
  for (const linha of linhas) {
    if (ehTipoDeNotificacao(linha.kind)) kinds[linha.kind] = Boolean(linha.enabled);
  }
  return { kinds };
}

export function notificationsRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  // Um db.batch(): contagem das não lidas, as novas e as anteriores.
  rotas.get("/", async (c) => {
    const { householdId } = getSession(c);
    const desde = new Date(
      agora().getTime() - JANELA_DAS_ANTERIORES_DIAS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const [contagem, novas, anteriores] = await c.var.db.$client.batch([
      c.var.db.$client.prepare(SQL_NAO_LIDAS).bind(householdId),
      c.var.db.$client.prepare(SQL_NOVAS).bind(householdId, LIMITE_DAS_NOVAS),
      c.var.db.$client.prepare(SQL_ANTERIORES).bind(householdId, desde, LIMITE_DAS_ANTERIORES),
    ]);

    const corpo: ListaDeNotificacoes = {
      unreadCount: Number((contagem?.results[0] as { n?: number } | undefined)?.n ?? 0),
      new: (novas?.results ?? []).map((linha) => paraLista(linha as LinhaDeNotificacao)),
      previous: (anteriores?.results ?? []).map((linha) => paraLista(linha as LinhaDeNotificacao)),
    };
    return c.json(corpo, 200);
  });

  rotas.get("/unread-count", async (c) => {
    const { householdId } = getSession(c);
    const linha = await c.var.db.$client.prepare(SQL_NAO_LIDAS).bind(householdId).first<{ n: number }>();
    const corpo: ContagemDeNaoLidas = { count: Number(linha?.n ?? 0) };
    return c.json(corpo, 200);
  });

  // Idempotente: a primeira leitura fica (COALESCE). Só um id que não é do lar, ou que não existe, dá 404.
  rotas.post("/:id/read", async (c) => {
    const { householdId } = getSession(c);
    const resultado = await c.var.db.$client
      .prepare(SQL_LER_UMA)
      .bind(agora().toISOString(), c.req.param("id"), householdId)
      .run();
    if ((resultado.meta?.changes ?? 0) === 0) {
      return apiError(c, 404, "notificacao_nao_encontrada", "Notificação não encontrada.");
    }
    return c.body(null, 204);
  });

  rotas.post("/read-all", async (c) => {
    const { householdId } = getSession(c);
    const resultado = await c.var.db.$client
      .prepare(SQL_LER_TODAS)
      .bind(agora().toISOString(), householdId)
      .run();
    const corpo: MarcadasDeNotificacoes = { marked: Number(resultado.meta?.changes ?? 0) };
    return c.json(corpo, 200);
  });

  return rotas;
}

export function notificationPrefsRoutes(resolveSession: SessionResolver): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  rotas.get("/", async (c) => {
    const { householdId } = getSession(c);
    const { results } = await c.var.db.$client.prepare(SQL_PREFERENCIAS).bind(householdId).all<{
      kind: string;
      enabled: number;
    }>();
    const corpo: PreferenciasDeNotificacao = preferenciasDoLar(results);
    return c.json(corpo, 200);
  });

  // Parcial: grava só os tipos enviados, e devolve o estado completo no mesmo lote (uma ida ao D1).
  rotas.put("/", async (c) => {
    const { householdId } = getSession(c);
    const corpo: unknown = await c.req.json().catch(() => undefined);
    const alteracoes = lerPreferencias(corpo);
    if (alteracoes === null) {
      return apiError(c, 400, "preferencia_invalida");
    }

    const instrucoes = Object.entries(alteracoes).map(([tipo, ligado]) =>
      c.var.db.$client.prepare(SQL_GRAVAR_PREFERENCIA).bind(householdId, tipo, ligado ? 1 : 0),
    );
    const resultados = await c.var.db.$client.batch([
      ...instrucoes,
      c.var.db.$client.prepare(SQL_PREFERENCIAS).bind(householdId),
    ]);
    const atual = resultados[resultados.length - 1];
    const linhas = (atual?.results ?? []) as { kind: string; enabled: number }[];
    const resposta: PreferenciasDeNotificacao = preferenciasDoLar(linhas);
    return c.json(resposta, 200);
  });

  return rotas;
}
