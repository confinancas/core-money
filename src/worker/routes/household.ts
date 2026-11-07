import type { Context } from "hono";
import { Hono } from "hono";
import { todayInSaoPaulo } from "../../shared/cycle";
import {
  type HouseholdDto,
  type HouseholdResponse,
  householdPatchSchema,
  type MemberDto,
} from "../../shared/household";
import { rebuildFutureCalendar } from "../cycle/calendar";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { getHousehold, type MemberRow, updateHousehold } from "../household/repository";
import { apiError } from "../http/errors";

const dadosInvalidos = (c: Context<AppEnv>) => apiError(c, 400, "dados_invalidos", "Dados inválidos.");

// E-mail não sai: o membro devolve só id, nome, papel e se é a pessoa da sessão.
const paraResposta = (household: HouseholdDto, pessoas: MemberRow[], memberId: string): HouseholdResponse => {
  const members: MemberDto[] = pessoas.map((pessoa) => ({
    id: pessoa.id,
    name: pessoa.name,
    role: pessoa.role,
    isMe: pessoa.id === memberId,
  }));
  return { household, members };
};

export function householdRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  rotas.get("/", async (c) => {
    const { householdId, memberId } = getSession(c);
    const lar = await getHousehold(c.var.db, householdId);
    if (!lar) return apiError(c, 404, "lar_inexistente");
    return c.json(paraResposta(lar.household, lar.members, memberId), 200);
  });

  rotas.patch("/", async (c) => {
    const { householdId, memberId } = getSession(c);

    let corpo: unknown;
    try {
      corpo = await c.req.json();
    } catch {
      return dadosInvalidos(c);
    }
    if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) return dadosInvalidos(c);
    if (Object.keys(corpo).length === 0) return apiError(c, 400, "nada_para_salvar", "Nada para salvar.");

    // Validação antes de qualquer escrita: falhou, nada foi ao D1.
    const resultado = householdPatchSchema.safeParse(corpo);
    if (!resultado.success) {
      if (resultado.error.issues.some((issue) => issue.code === "unrecognized_keys"))
        return dadosInvalidos(c);
      const fields: Record<string, string> = {};
      for (const issue of resultado.error.issues) {
        fields[String(issue.path[0] ?? "")] ??= issue.message;
      }
      return apiError(c, 400, "validacao", undefined, { fields });
    }

    // Dia de início novo: o calendário futuro é refeito antes de gravar o lar (no mesmo pedido). Dia igual não refaz nada.
    if (resultado.data.cycleStartDay !== undefined) {
      await rebuildFutureCalendar(
        c.var.db,
        householdId,
        resultado.data.cycleStartDay,
        todayInSaoPaulo(agora()),
      );
    }
    const lar = await updateHousehold(c.var.db, householdId, resultado.data);
    if (!lar) return apiError(c, 404, "lar_inexistente");
    return c.json(paraResposta(lar.household, lar.members, memberId), 200);
  });

  return rotas;
}
