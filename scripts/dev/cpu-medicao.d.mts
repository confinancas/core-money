// Tipos de scripts/dev/cpu-medicao.mjs, para os testes. A lógica fica no .mjs (TASK-0010).

export type Rota = {
  name: string;
  method: string;
  path: string;
  via?: string;
  headers?: Record<string, string>;
  body?: unknown;
  corpos?: unknown[];
};

export type Fluxo = { name: string; runs: number };

export type Tabela = { name: string; sql: string | null };

export type Migracao = { nome: string; conteudo: string };

export type Evento = { method: string; pathname: string; ts: number; cpu?: number };

export type Resultado = {
  name: string;
  method: string;
  path: string;
  n: number;
  faltou: boolean;
  medianaMs?: number;
  maximaMs?: number;
  cpuMs?: number[];
};

export const TABELA_DA_MEDICAO: string;
export const AQUECIMENTO: number;
export const MEDIDAS: number;
export const LIMITE_MS: number;

export function sha256(texto: string): string;

export function impressaoDoLar(entrada: {
  setupSql?: string[];
  migracoes?: Migracao[];
  esvaziarBanco?: boolean;
  codigoDoEsvaziamento?: string;
}): string;

export function sohLeitura(entrada: { requests: Rota[]; flows?: Fluxo[] }): boolean;

export function escolheLar(entrada: {
  impressaoDoBanco: string | null | undefined;
  impressaoDoArquivo: string;
  requests: Rota[];
  flows?: Fluxo[];
}): { modo: "reaproveitar" | "gravar"; motivo: string };

export function eventosDoTail(texto: string): unknown[];

export function eventosDaRequisicao(objetos: unknown[]): Evento[];

export function padraoDoCaminho(caminho: string): RegExp;

export function eventosDaRota(rota: Rota, eventos: Evento[]): Evento[];

export function mediana(valores: number[]): number;

export function medeRota(rota: Rota, eventos: Evento[]): Resultado;

export function mediaTail(rotas: Rota[], texto: string): Resultado[];

export function rotasParaRemedir(rotas: Rota[], resultados: Resultado[], jaRemedidas: Set<Rota>): Rota[];

export function avaliaResultados(resultados: Resultado[]): {
  ok: boolean;
  faltaram: string[];
  acima: string[];
};

export function ordemDeEsvaziamento(tabelas: Tabela[]): string[];
