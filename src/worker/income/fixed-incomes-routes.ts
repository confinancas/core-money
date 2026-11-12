import type { Context } from "hono";
import { Hono } from "hono";
import {
  type FixedIncomeDto,
  type FixedIncomeValues,
  validateFixedIncomeInput,
} from "../../shared/fixed-incomes";
import type { UltimaCotacao } from "../../shared/income";
import type { AppEnv } from "../env";
import { getSession, requireHousehold, type SessionResolver } from "../household/context";
import { apiError } from "../http/errors";
import {
  arquivarRendaFixa,
  atualizarRendaFixa,
  criarRendaFixa,
  type LinhaDaRendaFixa,
  lerRendasAtivas,
  lerTelaDeRendas,
  lerUltimasCotacoes,
  montaResposta,
  paraExistentes,
} from "./fixed-incomes-repo";
import { rematchFixedIncome } from "./statement-match";

// Rendas fixas (TASK-0901): GET, POST, PATCH e DELETE sob a sessão, no lar da sessão. Erro de validação é 422 com os
// campos; renda de outro lar, inexistente ou arquivada é 404 nao_encontrada. Depois de criar, mudar o texto ou a forma e
// excluir, a renda é recasada com o extrato (TASK-0902).

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

// Um objeto JSON só com os campos conhecidos. Chave a mais, corpo que não é objeto e keptUsdIsInvestment que não é
// booleano (0, null, "false") são dados inválidos: não se grava um verdadeiro que não foi pedido (TASK-0901, avaliação).
async function lerCorpo(c: Context<AppEnv>): Promise<Record<string, unknown> | undefined> {
  let corpo: unknown;
  try {
    corpo = await c.req.json();
  } catch {
    return undefined;
  }
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) return undefined;
  if (Object.keys(corpo).some((chave) => !CAMPOS_DO_CORPO.includes(chave))) return undefined;
  const registro = corpo as Record<string, unknown>;
  if ("keptUsdIsInvestment" in registro && typeof registro.keptUsdIsInvestment !== "boolean")
    return undefined;
  return registro;
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

// A resposta de criar e de editar é a mesma forma que o GET mostra depois, com a cotação da renda.
const dtoDosValores = (
  id: string,
  valores: FixedIncomeValues,
  ultima: UltimaCotacao | null,
): FixedIncomeDto => ({
  id,
  name: valores.name,
  currency: valores.currency,
  amountCents: valores.amountCents,
  usualDay: valores.usualDay,
  arrival: valores.arrival,
  statementText: valores.statementText,
  keptUsdIsInvestment: valores.keptUsdIsInvestment,
  lastFx: ultima,
});

export function fixedIncomesRoutes(
  resolveSession: SessionResolver,
  agora: () => Date = () => new Date(),
): Hono<AppEnv> {
  const rotas = new Hono<AppEnv>();
  rotas.use(requireHousehold(resolveSession));

  rotas.get("/", async (c) => {
    const { householdId } = getSession(c);
    const { linhas, ultimas } = await lerTelaDeRendas(c.var.db, householdId);
    return c.json(montaResposta(linhas, ultimas), 200);
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
    await rematchFixedIncome(c.var.db, householdId, id, agora());
    const ultimas = await lerUltimasCotacoes(c.var.db, householdId);
    return c.json({ fixedIncome: dtoDosValores(id, validacao.values, ultimas.get(id) ?? null) }, 201);
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

    // Texto do extrato ou forma mudou: as entradas do ciclo atual e do anterior são recasadas.
    const mudouCasamento =
      validacao.values.statementText !== atual.statement_text || validacao.values.arrival !== atual.arrival;
    if (mudouCasamento) await rematchFixedIncome(c.var.db, householdId, id, agora());

    const ultimas = await lerUltimasCotacoes(c.var.db, householdId);
    return c.json({ fixedIncome: dtoDosValores(id, validacao.values, ultimas.get(id) ?? null) }, 200);
  });

  // Excluir é arquivar (archived_at): o que já foi recebido continua no histórico, e a renda sai da lista e do previsto.
  // As entradas do extrato que ela casava nos dois ciclos voltam à fila (TASK-0902).
  rotas.delete("/:id", async (c) => {
    const { householdId } = getSession(c);
    const id = c.req.param("id");
    const arquivada = await arquivarRendaFixa(c.var.db, householdId, id, agora());
    if (!arquivada) return apiError(c, 404, "nao_encontrada");
    await rematchFixedIncome(c.var.db, householdId, id, agora());
    return c.body(null, 204);
  });

  return rotas;
}
