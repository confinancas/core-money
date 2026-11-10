import type { Context } from "hono";
import { Hono } from "hono";
import {
  type FixedIncomeDto,
  type FixedIncomeValues,
  validateFixedIncomeInput,
} from "../../shared/fixed-incomes";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";
import {
  arquivarRendaFixa,
  atualizarRendaFixa,
  criarRendaFixa,
  type LinhaDaRendaFixa,
  lerRendasAtivas,
  montaResposta,
  paraExistentes,
} from "./fixed-incomes-repo";

// Rendas fixas (TASK-0901): GET, POST, PATCH e DELETE sob a sessão, no lar da sessão. Erro de validação é 422 com os
// campos; renda de outro lar, inexistente ou arquivada é 404 nao_encontrada.

const CAMPOS_DO_CORPO = [
  "name",
  "currency",
  "amountCents",
  "usualDay",
  "arrival",
  "statementText",
  "keptUsdIsInvestment",
];

const dadosInvalidos = (c: Context<AppEnv>) => apiError(c, 400, "dados_invalidos", "Dados inválidos.");

// Um objeto JSON só com os campos conhecidos. Chave a mais ou corpo que não é objeto: dados inválidos.
async function lerCorpo(c: Context<AppEnv>): Promise<Record<string, unknown> | undefined> {
  let corpo: unknown;
  try {
    corpo = await c.req.json();
  } catch {
    return undefined;
  }
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) return undefined;
  if (Object.keys(corpo).some((chave) => !CAMPOS_DO_CORPO.includes(chave))) return undefined;
  return corpo as Record<string, unknown>;
}

// A linha do banco na forma da validação. Em real o dólar que fica é falso; em dólar, sem gravação antes, vale verdadeiro.
const entradaDaLinha = (linha: LinhaDaRendaFixa): Record<string, unknown> => ({
  name: linha.name,
  currency: linha.currency,
  amountCents: linha.amount_cents,
  usualDay: linha.usual_day,
  arrival: linha.arrival,
  statementText: linha.statement_text,
  keptUsdIsInvestment: linha.currency === "USD" ? linha.kept_usd_is_investment === 1 : true,
});

const dtoDosValores = (id: string, valores: FixedIncomeValues): FixedIncomeDto => ({
  id,
  name: valores.name,
  currency: valores.currency,
  amountCents: valores.amountCents,
  usualDay: valores.usualDay,
  arrival: valores.arrival,
  statementText: valores.statementText,
  keptUsdIsInvestment: valores.keptUsdIsInvestment,
  lastFx: null,
});

export function fixedIncomesRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  rotas.get("/", async (c) => {
    const { householdId } = getSession(c);
    const linhas = await lerRendasAtivas(c.var.db, householdId);
    return c.json(montaResposta(linhas), 200);
  });

  rotas.post("/", async (c) => {
    const { householdId } = getSession(c);
    const corpo = await lerCorpo(c);
    if (corpo === undefined) return dadosInvalidos(c);

    // Uma leitura (as ativas, para o nome) e depois a validação: nada é gravado se algum campo falhar.
    const ativas = await lerRendasAtivas(c.var.db, householdId);
    const validacao = validateFixedIncomeInput(corpo, paraExistentes(ativas));
    if (!validacao.ok) return apiError(c, 422, "validacao", undefined, { fields: validacao.fields });

    const id = crypto.randomUUID();
    await criarRendaFixa(c.var.db, householdId, id, validacao.values);
    return c.json({ fixedIncome: dtoDosValores(id, validacao.values) }, 201);
  });

  rotas.patch("/:id", async (c) => {
    const { householdId } = getSession(c);
    const id = c.req.param("id");
    const corpo = await lerCorpo(c);
    if (corpo === undefined) return dadosInvalidos(c);

    // Uma leitura das ativas: a renda tem que estar ativa no lar, e o nome é checado contra as outras.
    const ativas = await lerRendasAtivas(c.var.db, householdId);
    const atual = ativas.find((linha) => linha.id === id);
    if (!atual) return apiError(c, 404, "nao_encontrada");

    // O que não veio no corpo fica como está; a validação roda sobre a renda inteira.
    const validacao = validateFixedIncomeInput(
      { ...entradaDaLinha(atual), ...corpo },
      paraExistentes(ativas),
      id,
    );
    if (!validacao.ok) return apiError(c, 422, "validacao", undefined, { fields: validacao.fields });

    // Se outra pessoa arquivou a renda entre a leitura e a escrita, a escrita não acha a linha: 404.
    const gravada = await atualizarRendaFixa(c.var.db, householdId, id, validacao.values);
    if (!gravada) return apiError(c, 404, "nao_encontrada");
    return c.json({ fixedIncome: dtoDosValores(id, validacao.values) }, 200);
  });

  // Excluir é arquivar (archived_at): o que já foi recebido continua no histórico, e a renda sai da lista e do previsto.
  rotas.delete("/:id", async (c) => {
    const { householdId } = getSession(c);
    const arquivada = await arquivarRendaFixa(c.var.db, householdId, c.req.param("id"), agora());
    if (!arquivada) return apiError(c, 404, "nao_encontrada");
    return c.body(null, 204);
  });

  return rotas;
}
