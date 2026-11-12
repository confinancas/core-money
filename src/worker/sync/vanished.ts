// O que sumiu do banco (TASK-0205). Numa janela lida por inteira, uma transação da conta ou do cartão com a data na janela
// e que não voltou nesta execução (last_seen_at antes do início da execução) sai dos cálculos: ganha removed_at. O Pluggy
// às vezes apaga e recria um movimento com id novo (TASK-0202), e a leitura vazia (autorização vencida) não pode marcar
// nada. Duas guardas: janela que voltou com zero linhas não marca; sumiço grande (mais de 30% e pelo menos 5) não marca e
// pede conferência.
import type { Db } from "../db/client";
import { decidirSumicos } from "./regras";

export type EscopoDaJanela = { coluna: "account_id" | "card_id"; valor: string };
export type EntradaDaMarcacao = {
  escopo: EscopoDaJanela;
  from: string;
  to: string;
  // Início da execução: o que tem last_seen_at antes dele não voltou nesta leitura.
  inicioDaExecucao: string;
  now: string;
};

// Contagem (linhas locais da janela e candidatas) e atualização, com o mesmo filtro. A coluna vem de uma lista fixa
// (EscopoDaJanela), nunca do corpo da requisição.
export function markVanishedStmts(
  db: Db,
  entrada: EntradaDaMarcacao,
): { contagem: D1PreparedStatement; marcacao: D1PreparedStatement } {
  const { coluna, valor } = entrada.escopo;
  const contagem = db.$client
    .prepare(
      `SELECT COUNT(*) AS locais, COALESCE(SUM(CASE WHEN last_seen_at < ? THEN 1 ELSE 0 END), 0) AS candidatas
       FROM transactions WHERE ${coluna} = ? AND local_date >= ? AND local_date <= ? AND removed_at IS NULL`,
    )
    .bind(entrada.inicioDaExecucao, valor, entrada.from, entrada.to);
  const marcacao = db.$client
    .prepare(
      `UPDATE transactions SET removed_at = ?
       WHERE ${coluna} = ? AND local_date >= ? AND local_date <= ? AND removed_at IS NULL AND last_seen_at < ?`,
    )
    .bind(entrada.now, valor, entrada.from, entrada.to, entrada.inicioDaExecucao);
  return { contagem, marcacao };
}

// Roda a contagem e, se a decisão mandar, a atualização. Devolve quantas linhas saíram e se a execução pede conferência.
export async function marcarSumicos(
  db: Db,
  entrada: EntradaDaMarcacao,
  lidas: number,
): Promise<{ marcadas: number; conferir: boolean }> {
  if (lidas === 0) return { marcadas: 0, conferir: false };
  const { contagem, marcacao } = markVanishedStmts(db, entrada);
  const linha = await contagem.first<{ locais: number; candidatas: number }>();
  const decisao = decidirSumicos({ lidas, locais: linha?.locais ?? 0, candidatas: linha?.candidatas ?? 0 });
  if (!decisao.marcar) return { marcadas: 0, conferir: decisao.conferir };
  const resultado = await db.$client.batch([marcacao]);
  return { marcadas: resultado[0]?.meta.changes ?? 0, conferir: false };
}
