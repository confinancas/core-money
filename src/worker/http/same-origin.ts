// Contra pedido de outro site (TASK-0104). Junto com o SameSite=Lax do cookie de sessão, fecha o CSRF.
// Em POST, PUT, PATCH e DELETE sob /api: Sec-Fetch-Site cross-site vira 403; POST, PUT e PATCH com corpo que não é
// application/json viram 415.
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { apiError } from "./errors";

const METODOS_QUE_ALTERAM = ["POST", "PUT", "PATCH", "DELETE"];
const METODOS_COM_CORPO = ["POST", "PUT", "PATCH"];

// Com corpo: há bytes no pedido. Um Content-Length de zero é um pedido sem corpo.
function temCorpo(req: Request): boolean {
  return req.body !== null && req.headers.get("content-length") !== "0";
}

export function sameOrigin(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const metodo = c.req.method;
    if (!METODOS_QUE_ALTERAM.includes(metodo)) return next();

    if (c.req.header("sec-fetch-site") === "cross-site") {
      return apiError(c, 403, "origem_invalida", "Este pedido veio de outro site.");
    }

    if (METODOS_COM_CORPO.includes(metodo) && temCorpo(c.req.raw)) {
      const tipo = (c.req.header("content-type") ?? "").toLowerCase();
      if (!tipo.startsWith("application/json")) {
        return apiError(c, 415, "json_obrigatorio", "Envie os dados em JSON.");
      }
    }

    return next();
  };
}
