import { type ApiErrorBody, isApiErrorBody } from "../../shared/api";
import { avisaLimiteAtingido, limpaLimiteAtingido } from "../usage/limite-store";

const MENSAGEM_PADRAO = "Algo deu errado. Tente de novo.";

// Código da falha de limite do plano gratuito (TASK-0109): vale para a página 1027 da Cloudflare e para o 429 do D1.
export const CODIGO_DE_LIMITE = "limite_atingido";
const MENSAGEM_DE_LIMITE = "Limite do plano gratuito atingido.";

function lerJson(texto: string): unknown {
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return null;
  }
}

function ehJson(texto: string): boolean {
  try {
    JSON.parse(texto);
    return true;
  } catch {
    return false;
  }
}

// A resposta é a página de limite da Cloudflare (TASK-0109): não é JSON e tem status 429, ou o corpo (que não é JSON)
// traz o código 1027. Um JSON da própria API nunca conta, mesmo com 1027 num id: a API responde JSON.
export function isCloudflareLimitResponse(res: Pick<Response, "status">, body: string): boolean {
  if (ehJson(body)) return false;
  return res.status === 429 || body.includes("1027");
}

export const CAMINHO_DA_CONFIGURACAO = "/configuracao-inicial";

// Sem configuração pronta, a API responde 503 configuracao_pendente: o app vai para a configuração inicial.
// Não redireciona de dentro dela (a própria tela chama a API). Os testes trocam a ação.
let levaParaConfiguracao = (): void => {
  if (window.location.pathname !== CAMINHO_DA_CONFIGURACAO) window.location.replace(CAMINHO_DA_CONFIGURACAO);
};

// Devolve a ação anterior, para o teste restaurar.
export function definirAcaoDaConfiguracaoPendente(acao: () => void): () => void {
  const anterior = levaParaConfiguracao;
  levaParaConfiguracao = acao;
  return () => {
    levaParaConfiguracao = anterior;
  };
}

// Sessão vencida ou sem sessão (401 nao_autenticado) fora das telas de acesso: vai para /entrar (TASK-0104).
// A sonda da sessão não redireciona: quem trata o 401 dela é a partida e o RequireSession.
const TELAS_PUBLICAS = ["/", "/entrar", "/criar-conta", "/configuracao-inicial"];
const CAMINHO_DA_SONDA_DA_SESSAO = "/api/auth/session";
let levaParaEntrar = (): void => {
  const caminho = window.location.pathname;
  const publica =
    TELAS_PUBLICAS.includes(caminho) || caminho.startsWith("/convite/") || caminho.startsWith("/recuperar/");
  if (!publica) window.location.replace("/entrar");
};

// Devolve a ação anterior, para o teste restaurar.
export function definirAcaoDeSessaoExpirada(acao: () => void): () => void {
  const anterior = levaParaEntrar;
  levaParaEntrar = acao;
  return () => {
    levaParaEntrar = anterior;
  };
}

// Falha da API: status (0 quando não houve resposta), código da convenção e mensagem para a tela.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  // O corpo inteiro da resposta de erro (TASK-0105: o convite vencido traz quem convidou e o vencimento).
  readonly corpo?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Record<string, string>,
    corpo?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.corpo = corpo;
  }
}

// Mensagem para a tela: a da convenção quando é uma falha da API; a padrão para qualquer outra coisa.
export function mensagemDoErro(erro: unknown): string {
  return erro instanceof ApiError ? erro.message : MENSAGEM_PADRAO;
}

// Envio com corpo JSON (PUT e POST). O corpo nunca é gravado em estado: quem chama descarta o valor depois.
export function apiEnviar<T>(caminho: string, metodo: "POST" | "PUT", corpo: unknown): Promise<T> {
  return apiFetch<T>(caminho, {
    method: metodo,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

// Chamada à API do mesmo site: cookies da mesma origem, JSON. Não mostra detalhe técnico: a mensagem é da convenção.
// Opções de uma chamada. semRedirecionarNaSessao: a leitura de fundo (o uso do plano, na moldura) não leva a pessoa a
// /entrar no 401: quem decide a sessão é a sonda e o RequireSession (TASK-0109, rodada 1).
export type OpcoesDaChamada = { semRedirecionarNaSessao?: boolean };

export async function apiFetch<T>(
  caminho: string,
  init: RequestInit = {},
  opcoes: OpcoesDaChamada = {},
): Promise<T> {
  const cabecalhos = new Headers(init.headers);
  if (!cabecalhos.has("accept")) cabecalhos.set("accept", "application/json");

  let resposta: Response;
  try {
    resposta = await fetch(caminho, { ...init, credentials: "same-origin", headers: cabecalhos });
  } catch {
    throw new ApiError(0, "sem_conexao", "Sem conexão.");
  }

  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => "");
    // Limite do plano gratuito (TASK-0109): a página de erro da Cloudflare (1027, ou o 429 sem JSON) ou o 429 do D1.
    if (isCloudflareLimitResponse(resposta, texto)) {
      avisaLimiteAtingido("requisicoes");
      throw new ApiError(429, CODIGO_DE_LIMITE, MENSAGEM_DE_LIMITE);
    }
    const corpo: unknown = lerJson(texto);
    if (isApiErrorBody(corpo)) {
      const erro: ApiErrorBody = corpo;
      if (resposta.status === 429 && erro.error === "limite_d1") {
        avisaLimiteAtingido("banco");
        throw new ApiError(
          429,
          CODIGO_DE_LIMITE,
          MENSAGEM_DE_LIMITE,
          undefined,
          corpo as Record<string, unknown>,
        );
      }
      if (resposta.status === 503 && erro.error === "configuracao_pendente") levaParaConfiguracao();
      if (
        resposta.status === 401 &&
        erro.error === "nao_autenticado" &&
        caminho !== CAMINHO_DA_SONDA_DA_SESSAO &&
        !opcoes.semRedirecionarNaSessao
      ) {
        levaParaEntrar();
      }
      throw new ApiError(
        resposta.status,
        erro.error,
        erro.message ?? MENSAGEM_PADRAO,
        erro.fields,
        corpo as Record<string, unknown>,
      );
    }
    throw new ApiError(resposta.status, "erro_http", MENSAGEM_PADRAO);
  }

  // Uma resposta boa da API mostra que o limite passou: o aviso guardado sai (TASK-0109, rodada 1).
  limpaLimiteAtingido();

  // 204 não tem corpo: o resultado é undefined, e não um erro de JSON (correção herdada da TASK-0005).
  if (resposta.status === 204) return undefined as T;

  return (await resposta.json()) as T;
}
