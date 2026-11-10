import { Hono } from "hono";
import { todayInSaoPaulo } from "../../shared/sao-paulo-date";
import { lerCartao, lerCartoes } from "../cards/queries";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";

// Cartões (TASK-0402): GET /api/cards e GET /api/cards/:cardId. Sessão obrigatória (o middleware do app responde 401
// antes), e tudo do lar da sessão: um cartão de outro lar responde 404, como um cartão que não existe.
export function cartoesRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  rotas.get("/", async (c) => {
    const { householdId } = getSession(c);
    const hoje = todayInSaoPaulo(agora());
    return c.json(await lerCartoes(c.var.db, householdId, hoje));
  });

  rotas.get("/:cardId", async (c) => {
    const { householdId } = getSession(c);
    const resposta = await lerCartao(c.var.db, householdId, c.req.param("cardId"));
    if (resposta === null) return apiError(c, 404, "not_found", "Cartão não encontrado.");
    return c.json(resposta);
  });

  return rotas;
}
