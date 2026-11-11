import { addDays } from "../../shared/cycle";
import { fxReferenceDate } from "../../shared/income";
import { todayInSaoPaulo } from "../../shared/sao-paulo-date";
import { createDb, type Db } from "../db/client";
import { newMeter } from "../db/metered-d1";
import {
  buildPtaxUrl,
  type CotacaoDoDia,
  escolheCotacao,
  HORIZONTE_DE_DIAS,
  JANELA_DE_DIAS,
  LIMITE_DE_BUSCAS,
  parsePtaxResponse,
  TIMEOUT_MS,
} from "./fx-puro";

// Cotação de referência do dólar (TASK-0902): PTAX de venda do Banco Central, pela API pública Olinda (sem chave).
// Só o servidor fala com ela. Um pedido por par (renda, ciclo) que falta, no máximo 2 por execução.

type LinhaDeRecebimentoDolar = {
  fixed_income_id: string;
  cycle_key: string;
  received_on: string;
  confirmed_by: string;
  fx_rate: number | null;
  fx_date: string | null;
};

type ParPendente = { fixedIncomeId: string; cycleKey: string; referencia: string };

// db: o do embrulho de medição de uso, quando o despachante o tem; sem ele, a tarefa abre o seu.
export type FxDeps = { now: Date; fetch: typeof fetch; db?: Db };

export type ResultadoDoFx = { pendentes: number; buscas: number; preenchidos: number };

// Busca uma janela de cotações no Banco Central para um dia de referência. Devolve o que chegou ou null (nada a gravar).
async function buscarJanela(fetchFn: typeof fetch, referencia: string): Promise<CotacaoDoDia[] | null> {
  const url = buildPtaxUrl(addDays(referencia, -JANELA_DE_DIAS), referencia);
  let status = 0;
  try {
    const resposta = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    status = resposta.status;
    if (resposta.status !== 200) {
      console.warn(`fx: data=${referencia} status=${status} entradas=0`);
      return null;
    }
    const entradas = parsePtaxResponse(await resposta.json());
    if (entradas === null) {
      console.warn(`fx: data=${referencia} status=${status} entradas=0`);
      return null;
    }
    console.info(`fx: data=${referencia} status=${status} entradas=${entradas.length}`);
    return entradas;
  } catch {
    console.warn(`fx: data=${referencia} status=${status} entradas=0`);
    return null;
  }
}

// Cron leve (TASK-0902): preenche a cotação dos pares (renda em dólar, ciclo) que a têm faltando, ou com o dia de
// referência antigo. Uma leitura e uma escrita no D1; no máximo 2 chamadas ao Banco Central. Pares que não fecharam ficam
// para a próxima execução.
export async function fillPendingFxRates(env: { DB: D1Database }, deps: FxDeps): Promise<ResultadoDoFx> {
  const db = deps.db ?? createDb(env.DB, newMeter());
  const hoje = todayInSaoPaulo(deps.now);

  const [paresLidos, cotacoesLidas] = await db.$client.batch([
    db.$client
      .prepare(
        `SELECT r.fixed_income_id AS fixed_income_id, r.cycle_key AS cycle_key, r.received_on AS received_on,
           r.confirmed_by AS confirmed_by, r.fx_rate AS fx_rate, r.fx_date AS fx_date
         FROM fixed_income_receipts AS r
         JOIN fixed_incomes AS f ON f.id = r.fixed_income_id AND f.currency = 'USD'
         WHERE r.received_on >= date(?, '-${HORIZONTE_DE_DIAS} days')`,
      )
      .bind(hoje),
    db.$client
      .prepare(
        `SELECT date, rate FROM fx_rates WHERE currency = 'USD' AND date >= date(?, '-${HORIZONTE_DE_DIAS} days')`,
      )
      .bind(hoje),
  ]);

  const grupos = new Map<
    string,
    { fixedIncomeId: string; cycleKey: string; recebimentos: LinhaDeRecebimentoDolar[] }
  >();
  for (const linha of (paresLidos?.results ?? []) as LinhaDeRecebimentoDolar[]) {
    const chave = `${linha.fixed_income_id}|${linha.cycle_key}`;
    const grupo = grupos.get(chave) ?? {
      fixedIncomeId: linha.fixed_income_id,
      cycleKey: linha.cycle_key,
      recebimentos: [],
    };
    grupo.recebimentos.push(linha);
    grupos.set(chave, grupo);
  }

  const pendentes: ParPendente[] = [];
  for (const grupo of grupos.values()) {
    const referencia = fxReferenceDate(
      grupo.recebimentos.map((linha) => ({ receivedOn: linha.received_on, confirmedBy: linha.confirmed_by })),
    );
    if (referencia === null || referencia > hoje) continue;
    const emDia = grupo.recebimentos.every((linha) => linha.fx_rate !== null && linha.fx_date === referencia);
    if (emDia) continue;
    pendentes.push({ fixedIncomeId: grupo.fixedIncomeId, cycleKey: grupo.cycleKey, referencia });
  }

  const cotacoes = new Map<string, number>();
  for (const linha of (cotacoesLidas?.results ?? []) as { date: string; rate: number }[]) {
    cotacoes.set(linha.date, linha.rate);
  }

  const novasCotacoes = new Map<string, number>();
  const escritas: D1PreparedStatement[] = [];
  let buscas = 0;
  let preenchidos = 0;
  for (const par of pendentes) {
    // Primeiro, o que já está guardado: a cotação do próprio dia de referência, sem chamada.
    let cotacao = escolheCotacao(par.referencia, hoje, cotacoes, false);
    if (cotacao === null) {
      if (buscas >= LIMITE_DE_BUSCAS) continue;
      buscas++;
      const entradas = await buscarJanela(deps.fetch, par.referencia);
      if (entradas === null) continue;
      for (const entrada of entradas) {
        cotacoes.set(entrada.date, entrada.rateE4);
        novasCotacoes.set(entrada.date, entrada.rateE4);
      }
      cotacao = escolheCotacao(par.referencia, hoje, cotacoes, true);
    }
    if (cotacao === null) continue;

    escritas.push(
      db.$client
        .prepare(
          "UPDATE fixed_income_receipts SET fx_rate = ?, fx_date = ? WHERE fixed_income_id = ? AND cycle_key = ?",
        )
        .bind(cotacao.rateE4, par.referencia, par.fixedIncomeId, par.cycleKey),
    );
    preenchidos++;
  }

  const insercoes = [...novasCotacoes].map(([data, rateE4]) =>
    db.$client
      .prepare(
        "INSERT OR IGNORE INTO fx_rates (currency, date, rate, source) VALUES ('USD', ?, ?, 'bcb_ptax')",
      )
      .bind(data, rateE4),
  );
  const comandos = [...insercoes, ...escritas];
  if (comandos.length > 0) await db.$client.batch(comandos);
  return { pendentes: pendentes.length, buscas, preenchidos };
}
