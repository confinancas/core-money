import { Hono } from "hono";
import type { KeyState } from "../../shared/categorization";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { MODELO_DA_CATEGORIZACAO } from "../providers/anthropic";
import { secretStatus } from "../security/secrets";
import { NOME_CHAVE_CLAUDE } from "../setup/chaves";
import { MINUTOS_DE_PAUSA } from "./queue";

// Estado da categorização para a seção "Categorias e IA" de Configurações (TASK-0305). Nunca devolve a chave: só a
// máscara (keyMasked). keyState vem do segredo (N8, TASK-0303): chave ilegível vira problema_chave, mesmo sem
// last_error gravado. Um db.batch() para as contagens e os erros da fila; a leitura do segredo é uma consulta à parte.

export const statusRoutes = (
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> => {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  rotas.get("/status", async (c) => {
    const { householdId } = getSession(c);
    const db = c.var.db;
    const [categorias, regras, erros, chave] = await db.$client.batch([
      db.$client
        .prepare("SELECT COUNT(*) AS n FROM categories WHERE household_id = ? AND archived_at IS NULL")
        .bind(householdId),
      db.$client
        .prepare("SELECT COUNT(*) AS n FROM rules WHERE household_id = ? AND disabled_at IS NULL")
        .bind(householdId),
      db.$client
        .prepare(
          `SELECT q.last_error AS erro, COUNT(*) AS n FROM categorization_queue AS q
             JOIN transactions AS t ON t.id = q.transaction_id
           WHERE t.household_id = ? AND q.last_error IN ('chave', 'indisponivel') GROUP BY q.last_error`,
        )
        .bind(householdId),
      db.$client.prepare("SELECT updated_at FROM app_secrets WHERE name = ?").bind(NOME_CHAVE_CLAUDE),
    ]);

    const chaveAtual = await secretStatus(db, c.env, NOME_CHAVE_CLAUDE);
    const porErro = new Map(
      ((erros?.results ?? []) as Array<{ erro: string; n: number }>).map((linha) => [linha.erro, linha.n]),
    );
    const atualizadaEm = (chave?.results?.[0] as { updated_at: string } | undefined)?.updated_at ?? null;

    const keyState = estadoDaChave(chaveAtual.configured, chaveAtual.readable, porErro);
    // N17: uma chave nova gravada há pouco, com erros ainda na fila, pode levar alguns minutos para voltar.
    const chaveNovaRecente =
      keyState === "problema_chave" &&
      atualizadaEm !== null &&
      agora().getTime() - Date.parse(atualizadaEm) < MINUTOS_DE_PAUSA * 60 * 1000;

    return c.json(
      {
        categoriesCount: (categorias?.results?.[0] as { n: number } | undefined)?.n ?? 0,
        activeRulesCount: (regras?.results?.[0] as { n: number } | undefined)?.n ?? 0,
        keyMasked: chaveAtual.readable ? chaveAtual.masked : null,
        keyState,
        chaveNovaRecente,
        model: chaveAtual.configured ? MODELO_DA_CATEGORIZACAO : null,
      },
      200,
    );
  });

  return rotas;
};

// sem_chave sem segredo; chave ilegível ou "chave" na fila: problema_chave; "indisponivel" na fila: indisponivel.
export function estadoDaChave(
  configurada: boolean,
  legivel: boolean,
  porErro: ReadonlyMap<string, number>,
): KeyState {
  if (!configurada) return "sem_chave";
  if (!legivel || (porErro.get("chave") ?? 0) > 0) return "problema_chave";
  if ((porErro.get("indisponivel") ?? 0) > 0) return "indisponivel";
  return "ok";
}
