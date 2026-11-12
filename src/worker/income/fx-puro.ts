// Funções puras da cotação de referência (TASK-0902): URL da PTAX, leitura da resposta e escolha do dia. Sem tipos do
// Worker (o tsconfig de unidade não tem D1Database); o cron e o acesso ao D1 ficam em fx.ts.
import { addDays, isYmd } from "../../shared/cycle";

export const PTAX =
  "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)";
export const LIMITE_DE_BUSCAS = 2;
export const TIMEOUT_MS = 10_000;
export const JANELA_DE_DIAS = 7;
export const HORIZONTE_DE_DIAS = 100;

// AAAA-MM-DD vira MM-DD-AAAA, entre aspas simples, como a API pede.
function paraPtax(data: string): string {
  return `${data.slice(5, 7)}-${data.slice(8, 10)}-${data.slice(0, 4)}`;
}

export function buildPtaxUrl(inicio: string, fim: string): string {
  return `${PTAX}?@dataInicial='${paraPtax(inicio)}'&@dataFinalCotacao='${paraPtax(fim)}'&$format=json&$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao`;
}

export type CotacaoDoDia = { date: string; rateE4: number };

// A resposta da API, lida: uma cotação por dia útil. value vazio (fim de semana) é válido e não tem cotação. Qualquer
// coisa fora da forma, ou uma cotação que não é positiva, faz a resposta inteira ser recusada (nada é gravado).
export function parsePtaxResponse(json: unknown): CotacaoDoDia[] | null {
  if (typeof json !== "object" || json === null) return null;
  const valor = (json as { value?: unknown }).value;
  if (!Array.isArray(valor)) return null;
  const saida: CotacaoDoDia[] = [];
  for (const item of valor) {
    if (typeof item !== "object" || item === null) return null;
    const venda = (item as { cotacaoVenda?: unknown }).cotacaoVenda;
    const data = (item as { dataHoraCotacao?: unknown }).dataHoraCotacao;
    if (typeof venda !== "number" || !Number.isFinite(venda) || venda <= 0) return null;
    if (typeof data !== "string") return null;
    const dia = data.slice(0, 10);
    if (!isYmd(dia)) return null;
    const rateE4 = Math.round(venda * 10_000);
    if (!Number.isSafeInteger(rateE4) || rateE4 <= 0) return null;
    saida.push({ date: dia, rateE4 });
  }
  return saida;
}

// A cotação de um dia de referência D. Se o próprio D tem cotação, é ela. Se D já passou (fim de semana ou feriado), a
// última cotação até D, dentro dos 7 dias anteriores. D ainda não publicado (hoje, antes das 13h) não tem cotação.
export function escolheCotacao(
  referencia: string,
  hoje: string,
  cotacoes: ReadonlyMap<string, number>,
  depoisDaBusca: boolean,
): CotacaoDoDia | null {
  const exata = cotacoes.get(referencia);
  if (exata !== undefined) return { date: referencia, rateE4: exata };
  if (!depoisDaBusca || referencia >= hoje) return null;

  const inicio = addDays(referencia, -JANELA_DE_DIAS);
  let melhor: CotacaoDoDia | null = null;
  for (const [data, rateE4] of cotacoes) {
    if (data < inicio || data >= referencia) continue;
    if (melhor === null || data > melhor.date) melhor = { date: data, rateE4 };
  }
  return melhor;
}
