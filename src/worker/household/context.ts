import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { apiError } from "../http/errors";

// Quem está pedindo: a TASK-0104 preenche isto com a sessão real (o requireSession grava mais campos).
export type SessionIdentity = { memberId: string; householdId: string };

export type SessionResolver = (c: Context<AppEnv>) => Promise<SessionIdentity | null>;

// Padrão até a TASK-0104: ninguém está logado, então as rotas do lar respondem 401.
export const noSession: SessionResolver = async () => null;

// Exige o lar da sessão. Não consulta o D1: a identidade vem do resolvedor (ou de um middleware anterior).
export function requireHousehold(resolve: SessionResolver): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.var.session) {
      const identidade = await resolve(c);
      if (!identidade) return apiError(c, 401, "nao_autenticado", "Entre de novo para continuar.");
      c.set("session", identidade);
    }
    await next();
  };
}

// Erro de programação se a rota não estiver atrás de requireHousehold.
export function getSession(c: Context<AppEnv>): SessionIdentity {
  const sessao = c.var.session;
  if (!sessao) throw new Error("getSession sem sessão: a rota precisa de requireHousehold.");
  return sessao;
}
