import type { Context } from "hono";
import { Hono } from "hono";
import { addDays, cycleForDate, isYmd } from "../../shared/cycle";
import { todayInSaoPaulo } from "../../shared/sao-paulo-date";
import { ensureCalendar, loadCalendar } from "../cycle/calendar";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";
import { computeCycleIncome, type ReciboDaRenda } from "./cycle-income";
import { addManualReceipt, removeManualReceipt } from "./receipts";

// Renda do ciclo e recebimentos lançados à mão (TASK-0902). Sob a sessão, no lar da sessão. Renda de outro lar, arquivada
// ou inexistente é 404. Recebimento do extrato não se apaga por aqui (409 recebimento_do_extrato).

const CICLO_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/;
// Um recebimento vale no ciclo de hoje ou no anterior; o calendário é garantido até 120 dias para trás.
const DIAS_PARA_TRAS = 120;
const CAMPOS_DO_RECEBIMENTO = ["receivedOn", "amountCents"];

const MENSAGEM_DO_DIA = "Escolha um dia deste ciclo ou do anterior.";
const MENSAGEM_DO_VALOR = "Informe quanto entrou.";

const dadosInvalidos = (c: Context<AppEnv>) => apiError(c, 400, "dados_invalidos", "Dados inválidos.");

async function lerCorpo(c: Context<AppEnv>): Promise<Record<string, unknown> | undefined> {
  let corpo: unknown;
  try {
    corpo = await c.req.json();
  } catch {
    return undefined;
  }
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) return undefined;
  if (Object.keys(corpo).some((chave) => !CAMPOS_DO_RECEBIMENTO.includes(chave))) return undefined;
  return corpo as Record<string, unknown>;
}

export function receiptsRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();

  rotas.get("/cycle/income", requireHousehold(resolveSession), async (c) => {
    const { householdId } = getSession(c);
    const db = c.var.db;
    const pedido = c.req.query("cycleKey");
    // O calendário cobre os 120 dias para trás: um ciclo recente existe mesmo num lar que ainda não importou nada.
    const hoje = todayInSaoPaulo(agora());
    await ensureCalendar(db, householdId, addDays(hoje, -DIAS_PARA_TRAS), hoje);
    let chave: string;
    if (pedido === undefined) {
      // Sem ciclo pedido, é o de hoje.
      const atual = cycleForDate(hoje, await loadCalendar(db, householdId));
      if (!atual) return apiError(c, 404, "nao_encontrada");
      chave = atual.key;
    } else {
      if (!CICLO_VALIDO.test(pedido)) {
        return apiError(c, 422, "validacao", undefined, { fields: { cycleKey: "Escolha um ciclo válido." } });
      }
      chave = pedido;
    }
    const renda = await computeCycleIncome(db, householdId, chave);
    if (!renda) return apiError(c, 404, "nao_encontrada");
    return c.json(renda, 200);
  });

  rotas.post("/fixed-incomes/:id/receipts", requireHousehold(resolveSession), async (c) => {
    const { householdId, memberId } = getSession(c);
    const db = c.var.db;
    const rendaId = c.req.param("id");
    const corpo = await lerCorpo(c);
    if (corpo === undefined) return dadosInvalidos(c);

    const renda = await db.$client
      .prepare("SELECT currency FROM fixed_incomes WHERE id = ? AND household_id = ? AND archived_at IS NULL")
      .bind(rendaId, householdId)
      .first<{ currency: string }>();
    if (!renda) return apiError(c, 404, "nao_encontrada");

    const hoje = todayInSaoPaulo(agora());
    const campos: Record<string, string> = {};
    const dia = corpo.receivedOn;
    if (!isYmd(dia) || dia > hoje) campos.receivedOn = MENSAGEM_DO_DIA;

    const valor = corpo.amountCents;
    const valorValido =
      typeof valor === "number" &&
      Number.isSafeInteger(valor) &&
      valor >= 0 &&
      (renda.currency !== "BRL" || valor > 0);
    if (!valorValido) campos.amountCents = MENSAGEM_DO_VALOR;
    if (Object.keys(campos).length > 0) return apiError(c, 422, "validacao", undefined, { fields: campos });
    if (typeof dia !== "string" || typeof valor !== "number") return dadosInvalidos(c);

    // O ciclo do dia tem que ser o de hoje ou o anterior. O calendário cobre os 120 dias para trás.
    await ensureCalendar(db, householdId, addDays(hoje, -DIAS_PARA_TRAS), hoje);
    const calendario = await loadCalendar(db, householdId);
    const atual = cycleForDate(hoje, calendario);
    const anterior = atual ? cycleForDate(addDays(atual.startsOn, -1), calendario) : null;
    const doDia = cycleForDate(dia, calendario);
    const aceitos = new Set([atual?.key, anterior?.key]);
    if (!doDia || !aceitos.has(doDia.key)) {
      return apiError(c, 422, "validacao", undefined, { fields: { receivedOn: MENSAGEM_DO_DIA } });
    }

    const id = crypto.randomUUID();
    const resultado = await addManualReceipt(db, householdId, {
      id,
      fixedIncomeId: rendaId,
      cycleKey: doDia.key,
      receivedOn: dia,
      amountCents: valor,
      confirmedBy: memberId,
    });
    if (resultado === "ja_confirmada") return apiError(c, 409, "ja_confirmada");
    if (resultado === "nao_encontrada") return apiError(c, 404, "nao_encontrada");

    const recibo: ReciboDaRenda = {
      id,
      receivedOn: dia,
      amountCents: valor,
      confirmedBy: "pessoa",
      manual: true,
      transactionId: null,
      movement: null,
      customName: null,
      counterpartyName: null,
      cardInstitution: null,
    };
    return c.json({ receipt: recibo }, 201);
  });

  rotas.delete("/fixed-incomes/:id/receipts/:receiptId", requireHousehold(resolveSession), async (c) => {
    const { householdId } = getSession(c);
    const resultado = await removeManualReceipt(
      c.var.db,
      householdId,
      c.req.param("id"),
      c.req.param("receiptId"),
    );
    if (resultado === "nao_encontrada") return apiError(c, 404, "nao_encontrada");
    if (resultado === "extrato") return apiError(c, 409, "recebimento_do_extrato");
    return c.body(null, 204);
  });

  return rotas;
}
