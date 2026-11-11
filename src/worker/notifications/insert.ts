// Gravação de notificações (TASK-0701). Os geradores (TASK-0702 e 0703) chamam esta função e põem as instruções no
// db.batch() deles. Não checa preferências: quem gera checa. O INSERT é idempotente pela chave (lar, dedupe_key).
import type { NotificationKind } from "../../shared/notifications/kinds";
import type { Db } from "../db/client";

export type NovaNotificacao = {
  householdId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
  dedupeKey: string;
  createdAt: string;
};

// Sem reusar id: a chave primária fica fora do ON CONFLICT (CLAUDE.md). Cada linha ganha um id novo.
const SQL_INSERIR = `INSERT INTO notifications (id, household_id, kind, title, body, link, dedupe_key, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (household_id, dedupe_key) DO NOTHING`;

export function notificationInsertStatements(db: Db, linhas: NovaNotificacao[]): D1PreparedStatement[] {
  return linhas.map((linha) =>
    db.$client
      .prepare(SQL_INSERIR)
      .bind(
        crypto.randomUUID(),
        linha.householdId,
        linha.kind,
        linha.title,
        linha.body,
        linha.link,
        linha.dedupeKey,
        linha.createdAt,
      ),
  );
}
