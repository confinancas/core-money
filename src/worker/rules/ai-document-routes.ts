import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";

// Documento de regras da IA (TASK-0305): o texto que o casal escreve e o Claude lê antes de categorizar (TASK-0303).
// Uma linha por lar. A gravação é uma instrução só: a checagem do baseUpdatedAt e o INSERT ... ON CONFLICT juntos.

export const LIMITE_DO_DOCUMENTO = 4000;

const corpoDoDocumento = z.object({
  text: z.string(),
  baseUpdatedAt: z.string().nullable(),
});

type Documento = { text: string; updatedAt: string | null };

async function lerDocumento(d1: D1Database, householdId: string): Promise<Documento> {
  const linha = await d1
    .prepare("SELECT text, updated_at FROM ai_rules_document WHERE household_id = ?")
    .bind(householdId)
    .first<{ text: string; updated_at: string | null }>();
  return linha ? { text: linha.text, updatedAt: linha.updated_at } : { text: "", updatedAt: null };
}

export function aiRulesDocumentRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  rotas.get("/", async (c) => {
    const { householdId } = getSession(c);
    return c.json(await lerDocumento(c.var.db.$client, householdId), 200);
  });

  rotas.put("/", async (c) => {
    const { householdId } = getSession(c);
    const corpo = await lerObjetoDoCorpo(c);
    if (corpo === undefined) return apiError(c, 400, "dados_invalidos", "Dados inválidos.");
    const lido = corpoDoDocumento.safeParse(corpo);
    if (!lido.success) return apiError(c, 400, "dados_invalidos", "Dados inválidos.");

    const texto = lido.data.text.trim();
    if (Array.from(texto).length > LIMITE_DO_DOCUMENTO) {
      return apiError(c, 422, "validacao", undefined, {
        fields: { text: `Use até ${LIMITE_DO_DOCUMENTO.toLocaleString("pt-BR")} caracteres.` },
      });
    }

    const d1 = c.var.db.$client;
    const agoraIso = agora().toISOString();
    const base = lido.data.baseUpdatedAt;
    // Uma instrução: insere se a base é nula (ou se já há linha, que cai no conflito); no conflito, atualiza só se o gravado
    // ainda é a base. Base não nula sem linha não grava nada (0 linhas: 409).
    const resultado = await d1
      .prepare(
        `INSERT INTO ai_rules_document (household_id, text, updated_at)
         SELECT ?, ?, ? WHERE ? IS NULL OR EXISTS (SELECT 1 FROM ai_rules_document WHERE household_id = ?)
         ON CONFLICT(household_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at
           WHERE ai_rules_document.updated_at IS ?`,
      )
      .bind(householdId, texto, agoraIso, base, householdId, base)
      .run();

    if ((resultado.meta?.changes ?? 0) === 0) {
      return c.json({ error: "conflito", current: await lerDocumento(d1, householdId) }, 409);
    }
    return c.json({ text: texto, updatedAt: agoraIso }, 200);
  });

  return rotas;
}

async function lerObjetoDoCorpo(c: Context<AppEnv>): Promise<Record<string, unknown> | undefined> {
  try {
    const corpo: unknown = await c.req.json();
    if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) return undefined;
    return corpo as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
