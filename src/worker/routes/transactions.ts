import type { Context } from "hono";
import { Hono } from "hono";
import { CorpoDoPatchSchema, NOME_PROPRIO_MAXIMO } from "../../shared/api/transactions";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";
import { getTransactionDetail, patchTransaction } from "../transactions/detail";

// Compra (TASK-0403): GET /api/transactions/:id e PATCH /api/transactions/:id. Sessão obrigatória, e tudo do lar da
// sessão: transação de outro lar responde 404, como uma que não existe. Montada em /api/transactions, junto das rotas
// de categorização (TASK-0302), que não têm id em comum com estas.

const dadosInvalidos = (c: Context<AppEnv>) => apiError(c, 400, "dados_invalidos", "Dados inválidos.");

export function transacoesDetalheRoutes(resolveSession: SessionResolver): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  rotas.get("/:id", async (c) => {
    const { householdId } = getSession(c);
    const detalhe = await getTransactionDetail(c.var.db, householdId, c.req.param("id"));
    if (detalhe === null) return apiError(c, 404, "not_found", "Transação não encontrada.");
    return c.json(detalhe, 200);
  });

  rotas.patch("/:id", async (c) => {
    const { householdId } = getSession(c);
    let bruto: unknown;
    try {
      bruto = await c.req.json();
    } catch {
      return dadosInvalidos(c);
    }
    // Nome com mais de 80 caracteres depois do trim: 422 com a mensagem da spec (o schema também recusa).
    const nome = (bruto as { customName?: unknown } | null)?.customName;
    if (typeof nome === "string" && nome.trim().length > NOME_PROPRIO_MAXIMO) {
      return apiError(c, 422, "nome_longo", `Use até ${NOME_PROPRIO_MAXIMO} caracteres.`);
    }
    const corpo = CorpoDoPatchSchema.safeParse(bruto);
    if (!corpo.success) return dadosInvalidos(c);

    const resultado = await patchTransaction(c.var.db, householdId, c.req.param("id"), corpo.data);
    if (resultado.tipo === "nao_encontrada")
      return apiError(c, 404, "not_found", "Transação não encontrada.");
    if (resultado.tipo === "recusada") return apiError(c, 422, resultado.codigo, resultado.mensagem);
    return c.json(resultado.detalhe, 200);
  });

  return rotas;
}
