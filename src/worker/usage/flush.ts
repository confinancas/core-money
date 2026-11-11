// Grava o uso do dia (TASK-0109, ADR-008): uma escrita por requisição, em waitUntil, depois da resposta. O contador
// conta o próprio custo (+1 linha lida e +1 escrita), e uma falha dele é engolida: nunca derruba a resposta.
// Quando o D1 estoura o limite diário, o contador também falha, e o app segue sem ele até a virada do dia.
// Os tipos são estruturais (sem os globais do D1), para este arquivo entrar no teste de unidade (tsconfig sem D1).
import { usageDay } from "../../shared/usage";

// O que o contador precisa do D1 e do medidor (um D1 de verdade e um Meter satisfazem os dois).
export type ContadorD1 = {
  prepare(sql: string): {
    bind(...valores: unknown[]): { run(): Promise<unknown> };
  };
};
export type UsoMedido = { rowsRead: number; rowsWritten: number; sizeBytes: number };

export const SQL_CONTADOR = `
INSERT INTO usage_daily (day, requests, rows_read, rows_written, size_bytes) VALUES (?1, 1, ?2, ?3, ?4)
ON CONFLICT(day) DO UPDATE SET
  requests = requests + 1,
  rows_read = rows_read + excluded.rows_read,
  rows_written = rows_written + excluded.rows_written,
  size_bytes = CASE WHEN excluded.size_bytes > 0 THEN excluded.size_bytes ELSE size_bytes END`;

// `agora` é o relógio do dia: o padrão é o real; os testes passam uma hora para provar a virada.
export async function flushUsage(d1: ContadorD1, meter: UsoMedido, agora: Date = new Date()): Promise<void> {
  try {
    await d1
      .prepare(SQL_CONTADOR)
      // +1 linha lida e +1 escrita: o custo da própria gravação do contador (o D1 conta isso como uso).
      .bind(usageDay(agora), meter.rowsRead + 1, meter.rowsWritten + 1, meter.sizeBytes)
      .run();
  } catch {
    // Falha engolida de propósito: a resposta da requisição já saiu, e um contador parado não pode derrubá-la.
  }
}
