// Uma fatia da importação (TASK-0204): uma fase ou um trecho de página por execução da fila. Cada fatia respeita o
// orçamento do plano gratuito (até 4 chamadas ao Pluggy e 200 linhas gravadas) e grava o cursor com seq + 1.

import { todayInSaoPaulo } from "../../shared/sao-paulo-date";
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
import {
  futureWindow,
  historyWindows,
  lerCursor,
  MESES,
  progressPct,
  type SyncAccount,
  type SyncCursor,
  type SyncMessage,
  totalDeFatias,
} from "./plan";
import {
  finishRunStmts,
  type LinhaDaExecucao,
  lerExecucao,
  marcarRepeticaoStmt,
  saveCursorStmt,
} from "./runs";

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

// Reais já gravadas do cartão (sem as sintéticas): base do contexto de faturas das transações.
async function faturasReaisDoCartao(db: Db, cardId: string): Promise<{ id: string; closes_on: string }[]> {
  const linhas = await db.$client
    .prepare("SELECT id, closes_on FROM bills WHERE card_id = ? AND substr(id, 1, 5) <> 'sint:'")
    .bind(cardId)
    .all<{ id: string; closes_on: string }>();
  return linhas.results ?? [];
}

type Dependencias = { fetch?: typeof fetch; agora: Date; nowIso: string; seq: number };

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

  const contasDoCursor: SyncAccount[] = contas.map((conta): SyncAccount => {
    if (conta.type === "BANK") return { id: conta.id, kind: "BANK", windows: historyWindows(hoje, MESES) };
    const aberta = openBillFromCard(conta);
    const vencimento = conta.creditData?.balanceDueDate;
    const gapDays = aberta && vencimento ? diasEntre(aberta.closes_on, vencimento.slice(0, 10)) : 7;
    return {
      id: conta.id,
      kind: "CREDIT",
      windows: [...historyWindows(hoje, MESES), futureWindow(hoje)],
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

// Fase transacoes: um trecho de até 200 linhas por fatia. Fim de janela conta como fatia feita.
async function faseTransacoes(db: Db, env: Env, run: LinhaDaExecucao, cursor: SyncCursor, dep: Dependencias) {
  const contas = cursor.accounts;
  const conta = contas[cursor.a];
  const janela = conta?.windows[cursor.w];
  if (!conta || !janela) {
    const proximo: SyncCursor = { ...cursor, seq: dep.seq + 1, phase: "fim" };
    return { proximo, total: run.slices_total, feitas: run.slices_done };
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
  const { insertedIds } = await ingestTransactions(db, {
    householdId: run.household_id,
    bankItemId: run.bank_item_id,
    rows: trecho.map((transacao) => mapTransaction(transacao, contaDaTransacao)),
    now: dep.nowIso,
  });

  const proximo: SyncCursor = {
    ...cursor,
    seq: dep.seq + 1,
    inserted: cursor.inserted + insertedIds.length,
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
  // Fim da janela: a próxima janela da conta, ou a próxima conta.
  proximo.pageCursor = null;
  proximo.offset = 0;
  if (cursor.w + 1 < conta.windows.length) {
    proximo.w = cursor.w + 1;
  } else {
    proximo.a = cursor.a + 1;
    proximo.w = 0;
    if (proximo.a >= contas.length) proximo.phase = "fim";
  }
  return { proximo, total: run.slices_total, feitas: run.slices_done + 1 };
}

// Fase fim: conciliação dos últimos 15 dias do lar e a execução encerra como ok ou repetiu.
async function faseFim(db: Db, run: LinhaDaExecucao, agora: Date, nowIso: string): Promise<ResultadoDaFatia> {
  await reconcileHousehold(db, run.household_id, todayInSaoPaulo(agora), nowIso);
  const status = run.retried === 1 ? "repetiu" : "ok";
  await db.$client.batch(
    finishRunStmts(db, {
      runId: run.id,
      bankItemId: run.bank_item_id,
      status,
      errorCode: null,
      newTransactions: run.new_transactions,
      now: nowIso,
      statusDoBanco: null,
      atualizaUltimaSincronizacao: true,
    }),
  );
  return { tipo: "encerrou", status, codigo: null };
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
      const tabela = ATRASOS_DA_REPETICAO[entrada.tentativa - 1];
      if (tabela === undefined || entrada.tentativa >= TENTATIVAS_ANTES_DE_INSTAVEL) {
        return encerrar(db, run, "instavel", "banco_instavel", "instavel", nowIso);
      }
      const atraso = Math.max(tabela, erro.retryAfterSec ?? 0);
      const quando = new Date(agora.getTime() + atraso * 1000).toISOString();
      await db.$client.batch([marcarRepeticaoStmt(db, run.id, quando)]);
      return { tipo: "repete", atrasoSegundos: atraso };
    }
    return encerrar(db, run, "erro", "erro_inesperado", "acao_necessaria", nowIso);
  }
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
    if (cursor.phase === "fim") return await faseFim(db, run, agora, nowIso);

    const dep: Dependencias = { fetch: deps.fetch, agora, nowIso, seq: entrada.seq };
    const resultado =
      cursor.phase === "inicio"
        ? await faseInicio(db, env, run, cursor, dep)
        : cursor.phase === "faturas"
          ? await faseFaturas(db, env, run, cursor, dep)
          : await faseTransacoes(db, env, run, cursor, dep);

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
