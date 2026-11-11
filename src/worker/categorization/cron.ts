// Fatia da categorização no cron (TASK-0303). Cabe em 10 ms de CPU e em 50 chamadas externas: no máximo 5 ida e volta ao
// D1 (chave, lote da fila com a pausa, contexto e 2 gravações) e 2 chamadas ao Claude. Sem chave, a execução termina
// numa leitura, sem escrever nada. Com a pausa valendo (depois de um erro do provedor), termina com 2 leituras (chave e
// pausa), sem escrita e sem chamada. Quem grava category_id é só applyAiSuggestionStmt, pelo histórico.

import { createDb, type Db } from "../db/client";
import { type Meter, newMeter } from "../db/metered-d1";
import type { Env } from "../env";
import { type LeituraDoSegredo, readSecret } from "../security/secrets";
import { type ClienteDaIA, createClaudeClient, type ResultadoDaChamada, requestSuggestions } from "./claude";
import { buildSystemBlocks, type ContextoDeCategorizacao, itemParaIA } from "./context";
import { loadCategorizationContext } from "./context-repo";
import { type GravavelDaIA, temSugestao } from "./output-schema";
import {
  frescosStmt,
  gravarRespostaStmts,
  type LinhaDaFila,
  limparFilaStmt,
  MINUTOS_DE_PAUSA,
  pausaGravarStmt,
  pausaLeituraStmt,
  registrarFalhaStmts,
  retentativaStmt,
} from "./queue";

export const LOTE = 25;
export const CHAMADAS_POR_EXECUCAO = 2;
const LIMITE_DE_FRESCOS = LOTE * CHAMADAS_POR_EXECUCAO;

// db e meter: o despachante passa o db do embrulho de medição de uso (TASK-0109); sem ele, a fatia mede por conta própria.
export type DepsDaFatia = {
  now: () => Date;
  createClient: (apiKey: string) => ClienteDaIA;
  getApiKey: (db: Db, env: Env) => Promise<LeituraDoSegredo>;
  db?: Db;
  meter?: Meter;
};

export type ResultadoDaFatia = {
  situacao: "sem_chave" | "chave_ilegivel" | "pausada" | "fila_vazia" | "processada" | "parada";
  lotes: number;
  ok: number;
  semSugestao: number;
  semResposta: number;
};

// Cada lote: a chamada ao Claude e, depois, uma gravação. Recusa, corte e saída inválida contam tentativa; API fora e
// chave inválida param a execução sem contar, e deixam uma pausa de 30 minutos.
export async function runCategorizationSlice(
  env: Env,
  deps: Partial<DepsDaFatia> = {},
): Promise<ResultadoDaFatia> {
  const agora = (deps.now ?? (() => new Date()))();
  const nowIso = agora.toISOString();
  const db = deps.db ?? createDb(env.DB, deps.meter ?? newMeter());
  const vazio: ResultadoDaFatia = { situacao: "processada", lotes: 0, ok: 0, semSugestao: 0, semResposta: 0 };

  const chave = await (deps.getApiKey ?? ((d: Db, e: Env) => readSecret(d, e, "claude_api_key")))(db, env);
  if (chave.status === "ausente") return { ...vazio, situacao: "sem_chave" };
  if (chave.status === "ilegivel") {
    console.warn("categorization: chave ilegivel, a fatia para");
    return { ...vazio, situacao: "chave_ilegivel" };
  }
  const cliente = (
    deps.createClient ?? ((apiKey: string) => createClaudeClient(apiKey, env.ANTHROPIC_BASE_URL))
  )(chave.value);

  // Um lote só: a pausa, a limpeza da fila (com a reconferência) e as leituras. Com a pausa valendo, a limpeza e as
  // leituras não rodam (cláusulas NOT EXISTS), e a fatia para aqui.
  const [pausaLida, , frescosLidos, retentativaLida] = await db.$client.batch([
    pausaLeituraStmt(db),
    limparFilaStmt(db, nowIso),
    frescosStmt(db, LIMITE_DE_FRESCOS, nowIso),
    retentativaStmt(db, nowIso),
  ]);
  const pausaAte = (pausaLida?.results?.[0] as { pausar_ate?: string } | undefined)?.pausar_ate ?? null;
  if (pausaAte !== null && pausaAte > nowIso) return { ...vazio, situacao: "pausada" };

  const frescos = (frescosLidos?.results ?? []) as LinhaDaFila[];
  const retentativa = (retentativaLida?.results ?? []) as LinhaDaFila[];
  if (frescos.length === 0 && retentativa.length === 0) return { ...vazio, situacao: "fila_vazia" };

  const lar = (frescos[0] ?? retentativa[0]).household_id;
  const frescosDoLar = frescos.filter((linha) => linha.household_id === lar);
  const retentativaDoLar = retentativa.filter((linha) => linha.household_id === lar);

  const contexto: ContextoDeCategorizacao = await loadCategorizationContext(db, lar);
  const sistema = buildSystemBlocks(contexto);

  const lotes: LinhaDaFila[][] = [];
  for (let inicio = 0; inicio < frescosDoLar.length; inicio += LOTE) {
    lotes.push(frescosDoLar.slice(inicio, inicio + LOTE));
  }
  if (retentativaDoLar.length > 0 && lotes.length < CHAMADAS_POR_EXECUCAO) lotes.push(retentativaDoLar);

  const resumo: ResultadoDaFatia = { ...vazio };
  for (const lote of lotes.slice(0, CHAMADAS_POR_EXECUCAO)) {
    const itens = lote.map((linha, indice) => itemParaIA(`t${indice + 1}`, linha));
    const ids = lote.map((linha) => linha.id);
    const resultado: ResultadoDaChamada = await requestSuggestions(cliente, sistema, itens, contexto.codigos);
    resumo.lotes++;

    if (resultado.ok) {
      const respondidos: { id: string; gravavel: GravavelDaIA }[] = [];
      const semResposta: string[] = [];
      let ok = 0;
      let semSugestao = 0;
      lote.forEach((linha, indice) => {
        const gravavel = resultado.porRef.get(`t${indice + 1}`);
        if (gravavel === undefined) {
          semResposta.push(linha.id);
          return;
        }
        respondidos.push({ id: linha.id, gravavel });
        if (temSugestao(gravavel)) ok++;
        else semSugestao++;
      });
      await db.$client.batch(
        gravarRespostaStmts(db, { householdId: lar, now: nowIso, respondidos, semResposta, idsDoLote: ids }),
      );
      resumo.ok += ok;
      resumo.semSugestao += semSugestao;
      resumo.semResposta += semResposta.length;
      console.info(
        `categorization: lote=${lote.length} ok=${ok} sem_sugestao=${semSugestao} sem_resposta=${semResposta.length} erro=nenhum codigo_invalido=${resultado.codigoInvalido} cache_read=${resultado.uso.cacheRead} cache_write=${resultado.uso.cacheWrite} input=${resultado.uso.input} output=${resultado.uso.output}`,
      );
      continue;
    }

    // API fora e chave recusada: nenhuma tentativa conta, a pausa de 30 minutos segura as próximas execuções (que não
    // leem a fila). Recusa, corte, saída inválida e requisição inválida contam uma tentativa e seguem.
    const parar = resultado.erro === "indisponivel" || resultado.erro === "chave";
    const contaTentativa = !parar;
    const pausarAte = new Date(agora.getTime() + MINUTOS_DE_PAUSA * 60_000).toISOString();
    await db.$client.batch([
      ...registrarFalhaStmts(db, { ids, erro: resultado.erro, contaTentativa }),
      ...(parar ? [pausaGravarStmt(db, pausarAte)] : []),
    ]);
    const uso = resultado.uso;
    console.info(
      `categorization: lote=${lote.length} ok=0 sem_sugestao=0 erro=${resultado.erro} status=${resultado.status ?? "-"} cache_read=${uso?.cacheRead ?? 0} cache_write=${uso?.cacheWrite ?? 0} input=${uso?.input ?? 0} output=${uso?.output ?? 0}`,
    );
    if (parar) return { ...resumo, situacao: "parada" };
  }
  return resumo;
}
