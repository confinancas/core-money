// Uso do plano gratuito (TASK-0109): GET /api/usage e PUT /api/settings/paid-plan. Com sessão (o requireSession das
// rotas de /api) e no lar da sessão. Vale para os dois parceiros: é um valor do lar.
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  bandaDoUso,
  recurso,
  resetsAt,
  type UsageResource,
  type UsageResponse,
  usageDay,
} from "../../shared/usage";
import { households } from "../db/schema";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";

// Uma consulta: o lar (plano pago), o dia de hoje e o último tamanho medido (o maior que zero, o mais recente).
const SQL_USO = `
SELECT h.paid_plan AS paid_plan,
  u.requests AS requests, u.rows_read AS rows_read, u.rows_written AS rows_written,
  (SELECT s.size_bytes FROM usage_daily s WHERE s.size_bytes > 0 ORDER BY s.day DESC LIMIT 1) AS size_bytes
FROM households h
LEFT JOIN usage_daily u ON u.day = ?1
WHERE h.id = ?2`;

type LinhaDeUso = {
  paid_plan: number;
  requests: number | null;
  rows_read: number | null;
  rows_written: number | null;
  size_bytes: number | null;
};

const planoPago = z.strictObject({ paidPlan: z.boolean() });

export function usageRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  rotas.get("/", async (c) => {
    const { householdId } = getSession(c);
    const agoraDaRequisicao = agora();
    const dia = usageDay(agoraDaRequisicao);
    const linha = await c.var.db.$client.prepare(SQL_USO).bind(dia, householdId).first<LinhaDeUso>();
    if (!linha) return apiError(c, 404, "lar_inexistente");

    const resources: UsageResource[] = [
      recurso("requests", Number(linha.requests ?? 0)),
      recurso("rows_read", Number(linha.rows_read ?? 0)),
      recurso("rows_written", Number(linha.rows_written ?? 0)),
      recurso("size_bytes", Number(linha.size_bytes ?? 0)),
    ];
    const paidPlan = Number(linha.paid_plan) === 1;
    const corpo: UsageResponse = {
      day: dia,
      paidPlan,
      band: bandaDoUso(resources, paidPlan),
      resetsAt: resetsAt(agoraDaRequisicao),
      resources,
    };
    return c.json(corpo, 200);
  });

  return rotas;
}

export function planoPagoRoutes(resolveSession: SessionResolver): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  rotas.put("/", async (c) => {
    const { householdId } = getSession(c);
    let corpo: unknown;
    try {
      corpo = await c.req.json();
    } catch {
      return apiError(c, 400, "dados_invalidos", "Dados inválidos.");
    }
    const resultado = planoPago.safeParse(corpo);
    if (!resultado.success) return apiError(c, 400, "dados_invalidos", "Dados inválidos.");

    await c.var.db
      .update(households)
      .set({ paidPlan: resultado.data.paidPlan })
      .where(eq(households.id, householdId));
    return c.json({ paidPlan: resultado.data.paidPlan }, 200);
  });

  return rotas;
}
