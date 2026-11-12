// Uma fatia da importação (TASK-0204): uma fase ou um trecho de página por execução da fila. Cada fatia respeita o
// orçamento do plano gratuito (até 4 chamadas ao Pluggy e 200 linhas gravadas) e grava o cursor com seq + 1.

import { todayInSaoPaulo } from "../../shared/sao-paulo-date";
import { resetsAt } from "../../shared/usage";
import { reconcileHousehold } from "../bank/classify";
import {
  type BillRow,
  type ContaDaTransacao,
  mapAccount,
  mapBill,
  mapCard,
  mapInvestmentAccount,
  mapTransaction,
  openBillFromCard,
} from "../bank/map";
import { processNewTransactions } from "../categorization/pipeline";
import type { Db } from "../db/client";
import type { Env } from "../env";
import {
  ChavesIlegiveisError,
  type ContextoDeConexao,
  clientForConnection,
  SemChavesError,
} from "../pluggy/connections";
import { PluggyError } from "../pluggy/errors";
import type { PluggyAccount, PluggyItem } from "../pluggy/types";
import { applySpendTypesOnImport } from "../spend-types/derive";
import { causaDoErro } from "../usage/d1-limit-errors";
import { atingiuOTeto, escritasDeHoje } from "./orcamento";
import {
  DIAS_DA_CONCILIACAO,
  dailyWindows,
  futureWindow,
  historyWindows,
  JANELAS_DE_CONCILIACAO,
  lerCursor,
  MESES,
  progressPct,
  type SyncAccount,
  type SyncCursor,
  type SyncMessage,
  somaDias,
  totalDeFatias,
} from "./plan";
import {
  finishRunStmts,
  type LinhaDaExecucao,
  lerExecucao,
  marcarRepeticaoStmt,
  saveCursorStmt,
} from "./runs";
import { marcarSumicos } from "./vanished";

// Gravação do banco carregada na hora de usar, e não na carga do módulo: o `main` do Worker chega aos testes antes dos
// mocks do afterIngest, e o repositório não pode ficar preso à versão real do módulo por essa ordem.
const gravacao = () => import("../bank/repository");

// Linhas gravadas por fatia de transações; a página grande entra em várias fatias.
export const LINHAS_POR_FATIA = 200;
// Cartões por fatia de faturas.
export const CARTOES_POR_FATIA = 3;
// Atrasos da repetição, em segundos, nas tentativas 1, 2 e 3. Na quarta falha, o banco fica instável.
export const ATRASOS_DA_REPETICAO = [300, 1800, 7200] as const;
export const TENTATIVAS_ANTES_DE_INSTAVEL = 4;
// Códigos do Pluggy que pedem nova autorização do usuário (sem repetir).
const ERROS_DE_AUTORIZACAO = new Set([
  "USER_AUTHORIZATION_EXPIRED",
  "USER_AUTHORIZATION_REVOKED",
  "USER_AUTHORIZATION_NOT_GRANTED",
]);

export type DependenciasDaFatia = { db: Db; fetch?: typeof fetch };
export type EntradaDaFatia = SyncMessage & { tentativa: number };

// O que a fila faz com a mensagem depois da fatia.
export type ResultadoDaFatia =
  | { tipo: "continua" }
  | { tipo: "repete"; atrasoSegundos: number }
  | { tipo: "encerrou"; status: "ok" | "repetiu" | "instavel" | "erro"; codigo: string | null }
  | { tipo: "pulou" };

// Parada sem repetir: o código vai para sync_runs.error_code e o banco recebe o status indicado.
class ParadaDaImportacao extends Error {
  constructor(
    readonly codigo: string,
    readonly statusDoBanco: "acao_necessaria" | "instavel" = "acao_necessaria",
  ) {
    super(codigo);
    this.name = "ParadaDaImportacao";
  }
}

const diasEntre = (inicio: string, fim: string): number =>
  Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000);

const contextoDaFatia = (
  db: Db,
  env: Env,
  householdId: string,
  fetchImpl: typeof fetch | undefined,
  agora: Date,
): ContextoDeConexao => ({ db, env, householdId, fetch: fetchImpl, agora: () => agora });

// Reais já gravadas do cartão (sem as sintéticas): base do contexto de faturas das transações (TASK-0202).
export async function faturasReaisDoCartao(
  db: Db,
  cardId: string,
): Promise<{ id: string; closes_on: string }[]> {
  const linhas = await db.$client
    .prepare("SELECT id, closes_on FROM bills WHERE card_id = ? AND substr(id, 1, 5) <> 'sint:'")
    .bind(cardId)
    .all<{ id: string; closes_on: string }>();
  return linhas.results ?? [];
}

// Falhas passageiras do D1 (rede, banco ocupado, serviço fora): repetem a fatia, como um erro temporário do Pluggy. O
// limite diário não entra aqui (o teto de escritas do orcamento.ts cuida dele antes).
const FALHA_PASSAGEIRA_DO_D1 =
  /network connection lost|database is locked|sqlite_busy|d1[^\n]{0,40}(indispon|unavailable|overloaded)/i;

function ehFalhaPassageiraDoD1(erro: unknown): boolean {
  const causa = causaDoErro(erro);
  const mensagem = causa instanceof Error ? causa.message : typeof causa === "string" ? causa : "";
  return FALHA_PASSAGEIRA_DO_D1.test(mensagem);
}

// Pausa até a virada do dia: o heartbeat vai para lá e o cron só reenfileira depois (estaPausada, orcamento.ts).
function pausarStmt(db: Db, runId: string, ate: string): D1PreparedStatement {
  return db.$client
    .prepare("UPDATE sync_runs SET heartbeat_at = ? WHERE id = ? AND finished_at IS NULL")
    .bind(ate, runId);
}

// Completa as regras e o tipo de gasto das linhas da fatia que já existiam: é o caso da repetição de uma fatia cujo
// INSERT passou e cujo afterIngest falhou. A repetição vê as linhas como atualizadas, e o afterIngest não roda para elas.
// A gravação já põe o tipo padrão ("padrao") numa saída nova, então a pendência não é o tipo nulo: é a linha sem
// categoria e sem origem escolhida pelo casal, por regra ou pela categoria. Idempotente: a regra só pega linha sem
// categoria, o tipo padrão só pega origem nula ou padrão, e o que o casal escolheu não muda.
async function completarTipos(
  db: Db,
  householdId: string,
  ids: readonly string[],
  nowIso: string,
): Promise<void> {
  const pendentes = await db.$client
    .prepare(
      `SELECT t.id AS id FROM json_each(?) AS j
       CROSS JOIN transactions AS t ON t.id = j.value AND t.household_id = ?
       WHERE t.category_id IS NULL AND COALESCE(t.spend_type_source, '') NOT IN ('escolhido', 'regra', 'categoria')`,
    )
    .bind(JSON.stringify(ids), householdId)
    .all<{ id: string }>();
  const lista = (pendentes.results ?? []).map((linha) => linha.id);
  if (lista.length === 0) return;
  // Regras primeiro: a categoria que a regra põe define o tipo logo depois.
  await processNewTransactions(db, householdId, lista, nowIso);
  await applySpendTypesOnImport(db, householdId, lista);
}

type Dependencias = { fetch?: typeof fetch; agora: Date; nowIso: string; seq: number; tentativa: number };

// O que cada fase devolve: o cursor novo, o total de fatias e as feitas até aqui.
type ResultadoDaFase = { proximo: SyncCursor; total: number; feitas: number };

// Fase inicio: item, contas e investimentos; grava contas, cartões e a aberta; monta o cursor com as janelas.
async function faseInicio(db: Db, env: Env, run: LinhaDaExecucao, cursor: SyncCursor, dep: Dependencias) {
  const client = await clientForConnection(
    contextoDaFatia(db, env, run.household_id, dep.fetch, dep.agora),
    run.connection_id,
  );
  let item: PluggyItem;
  try {
    item = await client.getItem(run.bank_item_id);
  } catch (erro) {
    if (erro instanceof PluggyError && erro.kind === "not_found")
      throw new ParadaDaImportacao("item_inexistente");
    throw erro;
  }
  const codigoDoItem = item.error?.code ?? null;
  if (item.status === "LOGIN_ERROR" || (codigoDoItem !== null && ERROS_DE_AUTORIZACAO.has(codigoDoItem))) {
    throw new ParadaDaImportacao("autorizacao_vencida");
  }
  const consentimento = item.consentExpiresAt ?? null;
  await db.$client
    .prepare("UPDATE bank_items SET consent_expires_at = ? WHERE id = ?")
    .bind(consentimento, run.bank_item_id)
    .run();
  if (consentimento !== null && Date.parse(consentimento) < dep.agora.getTime()) {
    throw new ParadaDaImportacao("consentimento_vencido");
  }
  const instavelNoPluggy = item.status === "OUTDATED" || item.executionStatus === "PARTIAL_SUCCESS";

  const contas: PluggyAccount[] = await client.listAccounts(run.bank_item_id);
  const investimentos = await client.listInvestments(run.bank_item_id);
  const hoje = todayInSaoPaulo(dep.agora);

  const bancarias = contas.filter((conta) => conta.type === "BANK");
  const cartoes = contas.filter((conta) => conta.type === "CREDIT");
  const linhasDeContas = [...bancarias.map(mapAccount), ...investimentos.map(mapInvestmentAccount)].filter(
    (linha): linha is NonNullable<typeof linha> => linha !== null,
  );

  // Sincronização (diaria e manual): só a janela recente, a partir da última leitura com sucesso (TASK-0205). Importação:
  // o histórico de 12 meses (TASK-0204).
  const diaria = run.kind !== "historico";
  const ultimaSincronizacao = run.last_sync_at !== null ? todayInSaoPaulo(new Date(run.last_sync_at)) : null;
  const contasDoCursor: SyncAccount[] = contas.map((conta): SyncAccount => {
    if (conta.type === "BANK") {
      const janelas = diaria ? dailyWindows("BANK", ultimaSincronizacao, hoje) : historyWindows(hoje, MESES);
      return { id: conta.id, kind: "BANK", windows: janelas };
    }
    const aberta = openBillFromCard(conta);
    const vencimento = conta.creditData?.balanceDueDate;
    const gapDays = aberta && vencimento ? diasEntre(aberta.closes_on, vencimento.slice(0, 10)) : 7;
    return {
      id: conta.id,
      kind: "CREDIT",
      windows: diaria
        ? dailyWindows("CREDIT", ultimaSincronizacao, hoje)
        : [...historyWindows(hoje, MESES), futureWindow(hoje)],
      gapDays,
      aberta: aberta ? { ...aberta, status: "aberta", paid_on: null } : null,
    };
  });

  const { upsertAccountsStmts, upsertBillsStmts, upsertCardsStmts } = await gravacao();
  const comandos = [
    ...upsertAccountsStmts(db, run.bank_item_id, linhasDeContas, dep.nowIso),
    ...upsertCardsStmts(db, run.bank_item_id, cartoes.map(mapCard)),
    ...cartoes.flatMap((cartao) => upsertBillsStmts(db, { id: cartao.id }, [], openBillFromCard(cartao))),
  ];
  if (comandos.length > 0) await db.$client.batch(comandos);
  if (instavelNoPluggy) {
    await db.$client
      .prepare("UPDATE bank_items SET status = 'instavel' WHERE id = ?")
      .bind(run.bank_item_id)
      .run();
  }

  const janelas = contasDoCursor.reduce((soma, conta) => soma + conta.windows.length, 0);
  const proximo: SyncCursor = {
    ...cursor,
    seq: dep.seq + 1,
    phase: "faturas",
    accounts: contasDoCursor,
    a: 0,
    w: 0,
    pageCursor: null,
    offset: 0,
    lidas: 0,
    instavelNoPluggy,
  };
  return { proximo, total: totalDeFatias(cartoes.length, janelas), feitas: 1 };
}

// Fase faturas: até três cartões por fatia; as faturas reais e a aberta entram no mesmo lote.
async function faseFaturas(db: Db, env: Env, run: LinhaDaExecucao, cursor: SyncCursor, dep: Dependencias) {
  const client = await clientForConnection(
    contextoDaFatia(db, env, run.household_id, dep.fetch, dep.agora),
    run.connection_id,
  );
  const contas = cursor.accounts;
  const daFatia: SyncAccount[] = [];
  let i = cursor.a;
  while (i < contas.length && daFatia.length < CARTOES_POR_FATIA) {
    const conta = contas[i];
    i += 1;
    if (conta?.kind === "CREDIT") daFatia.push(conta);
  }
  const { upsertBillsStmts } = await gravacao();
  const comandos: D1PreparedStatement[] = [];
  for (const cartao of daFatia) {
    const faturas = await client.listBills(cartao.id);
    const reais: BillRow[] = faturas.map((fatura) => mapBill(fatura, cartao.gapDays ?? 7));
    comandos.push(...upsertBillsStmts(db, { id: cartao.id }, reais, cartao.aberta ?? null));
  }
  if (comandos.length > 0) await db.$client.batch(comandos);
  // Depois das faturas: uma fatura real que absorve lançamentos muda a data deles, então o cartão inteiro é reavaliado
  // uma vez por execução (decisão do Opus, rodada 1). Sem isso, o ciclo desses lançamentos fica para trás.
  const { reavaliarCartaoInteiro } = await import("../bank/after-ingest");
  for (const cartao of daFatia) {
    await reavaliarCartaoInteiro(db, run.household_id, cartao.id);
  }
  const fim = i >= contas.length;
  const proximo: SyncCursor = {
    ...cursor,
    seq: dep.seq + 1,
    phase: fim ? "transacoes" : "faturas",
    a: fim ? 0 : i,
    w: 0,
    pageCursor: null,
    offset: 0,
  };
  return { proximo, total: run.slices_total, feitas: run.slices_done + 1 };
}

// Fase transacoes: um trecho de até 200 linhas por fatia. Fim de janela conta como fatia feita. Na sincronização (diaria e
// manual), fim de janela também confere o que sumiu do banco (TASK-0205); e o fim das janelas vai para fim, sem conciliar
// os 12 meses (quem concilia a janela de hoje é o afterRun).
async function faseTransacoes(db: Db, env: Env, run: LinhaDaExecucao, cursor: SyncCursor, dep: Dependencias) {
  const contas = cursor.accounts;
  const conta = contas[cursor.a];
  const janela = conta?.windows[cursor.w];
  const fimDasTransacoes = (proximo: SyncCursor, total: number, feitas: number): ResultadoDaFase => {
    if (run.kind === "historico") {
      proximo.phase = "conciliar";
      proximo.w = 0;
      return { proximo, total: total + JANELAS_DE_CONCILIACAO, feitas };
    }
    proximo.phase = "fim";
    return { proximo, total, feitas };
  };
  if (!conta || !janela) {
    // Sem conta nem janela: não há transações; na importação, a conciliação entra no total e começa na janela 0.
    const proximo: SyncCursor = { ...cursor, seq: dep.seq + 1 };
    return fimDasTransacoes(proximo, run.slices_total, run.slices_done);
  }

  const client = await clientForConnection(
    contextoDaFatia(db, env, run.household_id, dep.fetch, dep.agora),
    run.connection_id,
  );
  const pagina = await client.listTransactions(
    cursor.pageCursor !== null
      ? { next: cursor.pageCursor }
      : { accountId: conta.id, dateFrom: janela.from, dateTo: janela.to },
  );

  const contaDaTransacao: ContaDaTransacao =
    conta.kind === "BANK"
      ? { kind: "BANK", accountId: conta.id }
      : {
          kind: "CREDIT",
          cardId: conta.id,
          faturas: {
            cardId: conta.id,
            openClosesOn: conta.aberta?.closes_on ?? null,
            knownBills: await faturasReaisDoCartao(db, conta.id),
          },
        };
  const trecho = pagina.results.slice(cursor.offset, cursor.offset + LINHAS_POR_FATIA);
  const { ingestTransactions } = await gravacao();
  const { insertedIds, atualizadasDaExecucao } = await ingestTransactions(db, {
    householdId: run.household_id,
    bankItemId: run.bank_item_id,
    rows: trecho.map((transacao) => mapTransaction(transacao, contaDaTransacao)),
    now: dep.nowIso,
    inicioDaExecucao: run.started_at,
  });
  // Só as linhas que nasceram nesta execução completam regras e tipo (a repetição de uma fatia que a tentativa anterior
  // deixou pela metade). A releitura diária de linhas de antes não volta à fila da IA nem tem o is_backfill regravado
  // (TASK-0205, N9 e A3).
  if (atualizadasDaExecucao.length > 0) {
    await completarTipos(db, run.household_id, atualizadasDaExecucao, dep.nowIso);
  }

  // Leituras da janela: só a primeira página de cada leitura conta (a fatia que relê a mesma página não soma de novo).
  const lidasAgora = cursor.lidas + (cursor.offset === 0 ? pagina.results.length : 0);
  const proximo: SyncCursor = {
    ...cursor,
    seq: dep.seq + 1,
    inserted: cursor.inserted + insertedIds.length,
    lidas: lidasAgora,
  };
  if (pagina.results.length > cursor.offset + LINHAS_POR_FATIA) {
    // Sobrou linha na página: a mesma página é relida na próxima fatia, a partir do offset.
    proximo.offset = cursor.offset + LINHAS_POR_FATIA;
    return { proximo, total: run.slices_total, feitas: run.slices_done };
  }
  if (pagina.next) {
    proximo.pageCursor = pagina.next;
    proximo.offset = 0;
    return { proximo, total: run.slices_total, feitas: run.slices_done };
  }
  // Fim da janela: na sincronização, o que não voltou sai dos cálculos (guardas em vanished.ts). Depois, a próxima janela
  // da conta, ou a próxima conta.
  if (run.kind !== "historico") {
    const escopo =
      conta.kind === "BANK"
        ? { coluna: "account_id" as const, valor: conta.id }
        : { coluna: "card_id" as const, valor: conta.id };
    const sumicos = await marcarSumicos(
      db,
      { escopo, from: janela.from, to: janela.to, inicioDaExecucao: run.started_at, now: dep.nowIso },
      lidasAgora,
    );
    proximo.conferir = cursor.conferir || sumicos.conferir;
  }
  proximo.lidas = 0;
  proximo.pageCursor = null;
  proximo.offset = 0;
  if (cursor.w + 1 < conta.windows.length) {
    proximo.w = cursor.w + 1;
    return { proximo, total: run.slices_total, feitas: run.slices_done + 1 };
  }
  proximo.a = cursor.a + 1;
  proximo.w = 0;
  if (proximo.a < contas.length) return { proximo, total: run.slices_total, feitas: run.slices_done + 1 };
  // Fim das transações.
  return fimDasTransacoes(proximo, run.slices_total, run.slices_done + 1);
}

// Fase conciliar: uma janela de 15 dias por fatia, da de hoje (w = 0) para a mais antiga (w = 24). Cada janela
// concilia as linhas que terminam em hoje menos 15 * w dias. Depois da última, a fase passa a fim.
async function faseConciliar(db: Db, run: LinhaDaExecucao, cursor: SyncCursor, dep: Dependencias) {
  // O hoje é o real (a regra dos 5 dias conta a partir dele); a janela escreve até hoje menos 15 vezes w (TASK-0204, R3).
  const hoje = todayInSaoPaulo(dep.agora);
  await reconcileHousehold(
    db,
    run.household_id,
    hoje,
    dep.nowIso,
    somaDias(hoje, -DIAS_DA_CONCILIACAO * cursor.w),
  );
  const proximoW = cursor.w + 1;
  const proximo: SyncCursor = {
    ...cursor,
    seq: dep.seq + 1,
    phase: proximoW < JANELAS_DE_CONCILIACAO ? "conciliar" : "fim",
    w: proximoW,
  };
  return { proximo, total: run.slices_total, feitas: run.slices_done + 1 };
}

// Ponto único depois da execução (TASK-0205): o afterRun roda antes de fechar, e um erro dele não impede o fechamento.
// Carregado sob demanda, como a gravação (o espião dos testes pega a chamada; ver o CLAUDE.md, vi.mock).
async function aposAExecucao(db: Db, run: LinhaDaExecucao, nowIso: string): Promise<void> {
  try {
    const { afterRun } = await import("./after-run");
    await afterRun(db, {
      householdId: run.household_id,
      bankItemId: run.bank_item_id,
      runId: run.id,
      now: nowIso,
      kind: run.kind,
    });
  } catch (erro) {
    console.error(`sync após a execução: ${erro instanceof Error ? erro.name : "erro"}`);
  }
}

// Fase fim: a execução encerra como ok ou repetiu. A conciliação da janela de hoje já foi feita (afterRun, ou as fatias
// de conciliar na importação). Na sincronização diária ou manual, um banco instável sem o item OUTDATED volta a ativo.
async function faseFim(
  db: Db,
  run: LinhaDaExecucao,
  cursor: SyncCursor,
  nowIso: string,
): Promise<ResultadoDaFatia> {
  const status = run.retried === 1 ? "repetiu" : "ok";
  await aposAExecucao(db, run, nowIso);
  await db.$client.batch(
    finishRunStmts(db, {
      runId: run.id,
      bankItemId: run.bank_item_id,
      status,
      errorCode: cursor.conferir ? "conferir_sumidas" : null,
      newTransactions: run.new_transactions,
      now: nowIso,
      statusDoBanco: null,
      atualizaUltimaSincronizacao: true,
      voltaAtivo: run.kind !== "historico" && !cursor.instavelNoPluggy,
    }),
  );
  return { tipo: "encerrou", status, codigo: cursor.conferir ? "conferir_sumidas" : null };
}

// Encerra a execução com erro ou instável, sem repetir.
async function encerrar(
  db: Db,
  run: LinhaDaExecucao,
  status: "erro" | "instavel",
  codigo: string,
  statusDoBanco: "acao_necessaria" | "instavel" | null,
  nowIso: string,
): Promise<ResultadoDaFatia> {
  await aposAExecucao(db, run, nowIso);
  await db.$client.batch(
    finishRunStmts(db, {
      runId: run.id,
      bankItemId: run.bank_item_id,
      status,
      errorCode: codigo,
      newTransactions: run.new_transactions,
      now: nowIso,
      statusDoBanco,
      atualizaUltimaSincronizacao: false,
    }),
  );
  return { tipo: "encerrou", status, codigo };
}

// Repete a fatia com a espera da tabela, ou com o Retry-After quando ele for maior. Na quarta falha (ou sem linha na
// tabela), o banco vai a instável e a execução encerra.
async function repetirOuParar(
  db: Db,
  run: LinhaDaExecucao,
  entrada: EntradaDaFatia,
  retryAfterSec: number | undefined,
  agora: Date,
  nowIso: string,
): Promise<ResultadoDaFatia> {
  const tabela = ATRASOS_DA_REPETICAO[entrada.tentativa - 1];
  if (tabela === undefined || entrada.tentativa >= TENTATIVAS_ANTES_DE_INSTAVEL) {
    return encerrar(db, run, "instavel", "banco_instavel", "instavel", nowIso);
  }
  const atraso = Math.max(tabela, retryAfterSec ?? 0);
  const quando = new Date(agora.getTime() + atraso * 1000).toISOString();
  await db.$client.batch([marcarRepeticaoStmt(db, run.id, quando)]);
  return { tipo: "repete", atrasoSegundos: atraso };
}

// Traduz a falha: parada com motivo, repetição com espera, ou exceção não prevista (vira erro_inesperado).
async function tratarFalha(
  db: Db,
  run: LinhaDaExecucao,
  entrada: EntradaDaFatia,
  erro: unknown,
  nowIso: string,
  agora: Date,
): Promise<ResultadoDaFatia> {
  if (erro instanceof ParadaDaImportacao)
    return encerrar(db, run, "erro", erro.codigo, erro.statusDoBanco, nowIso);
  if (erro instanceof SemChavesError)
    return encerrar(db, run, "erro", "sem_chaves", "acao_necessaria", nowIso);
  if (erro instanceof ChavesIlegiveisError) {
    return encerrar(db, run, "erro", "chaves_ilegiveis", "acao_necessaria", nowIso);
  }
  if (erro instanceof PluggyError) {
    if (erro.kind === "auth") return encerrar(db, run, "erro", "chaves_invalidas", "acao_necessaria", nowIso);
    if (erro.kind === "not_found" && run.slices_done === 0) {
      return encerrar(db, run, "erro", "item_inexistente", "acao_necessaria", nowIso);
    }
    if (erro.kind === "temporary" || erro.kind === "rate_limited") {
      return repetirOuParar(db, run, entrada, erro.retryAfterSec, agora, nowIso);
    }
    return encerrar(db, run, "erro", "erro_inesperado", "acao_necessaria", nowIso);
  }
  // Falha passageira do D1 (TASK-0204, R6a): repete a fatia, como um erro temporário.
  if (ehFalhaPassageiraDoD1(erro)) return repetirOuParar(db, run, entrada, undefined, agora, nowIso);
  console.error(`sync fatia: ${erro instanceof Error ? erro.name : "erro"}`);
  return encerrar(db, run, "erro", "erro_inesperado", null, nowIso);
}

// Roda uma fatia. Mensagem repetida (seq diferente) ou execução encerrada: pulou, sem trabalho.
export async function runSyncSlice(
  env: Env,
  deps: DependenciasDaFatia,
  entrada: EntradaDaFatia,
  now: string,
): Promise<ResultadoDaFatia> {
  const { db } = deps;
  const lida = await lerExecucao(db, entrada.runId);
  if (!lida || lida.finished_at !== null) return { tipo: "pulou" };
  const cursor = lerCursor(lida.cursor_json);
  if (cursor.seq !== entrada.seq) return { tipo: "pulou" };
  // O total de novas linhas é o do cursor (o que já foi gravado nas fatias anteriores), não o da linha da execução.
  const run: LinhaDaExecucao = { ...lida, new_transactions: cursor.inserted };

  const agora = new Date(now);
  const nowIso = agora.toISOString();
  try {
    if (cursor.phase === "fim") return await faseFim(db, run, cursor, nowIso);
    // Teto diário de escritas (TASK-0204, R2): nas fases que trazem dados do banco, ao chegar a 60% do limite do dia, a
    // execução pausa até a virada e o cursor não anda; a mensagem é confirmada e o cron reenfileira esta fatia depois
    // do heartbeat. A conciliação só reclassifica 15 dias de linhas e fica no colchão dos 40%: não lê o contador.
    const trazDadosDoBanco =
      cursor.phase === "inicio" || cursor.phase === "faturas" || cursor.phase === "transacoes";
    if (trazDadosDoBanco && atingiuOTeto(await escritasDeHoje(db.$client, agora))) {
      await db.$client.batch([pausarStmt(db, run.id, resetsAt(agora))]);
      return { tipo: "pulou" };
    }

    const dep: Dependencias = {
      fetch: deps.fetch,
      agora,
      nowIso,
      seq: entrada.seq,
      tentativa: entrada.tentativa,
    };
    const resultado =
      cursor.phase === "inicio"
        ? await faseInicio(db, env, run, cursor, dep)
        : cursor.phase === "faturas"
          ? await faseFaturas(db, env, run, cursor, dep)
          : cursor.phase === "transacoes"
            ? await faseTransacoes(db, env, run, cursor, dep)
            : await faseConciliar(db, run, cursor, dep);

    const gravou = await saveCursorStmt(db, {
      runId: run.id,
      seqEsperado: entrada.seq,
      cursor: resultado.proximo,
      slicesTotal: resultado.total,
      slicesDone: resultado.feitas,
      progressPct: progressPct(resultado.feitas, resultado.total),
      heartbeatAt: nowIso,
    }).run();
    return gravou.meta.changes > 0 ? { tipo: "continua" } : { tipo: "pulou" };
  } catch (erro) {
    return tratarFalha(db, run, entrada, erro, nowIso, agora);
  }
}
