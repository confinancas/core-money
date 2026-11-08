// Cliente da passkey do cadastro (TASK-0103): opções do servidor, cerimônia do navegador, verificação do servidor.
import { type PublicKeyCredentialCreationOptionsJSON, startRegistration } from "@simplewebauthn/browser";
import { brand } from "../../shared/brand";
import { ApiError, apiEnviar } from "../lib/api";

export type EntradaDaPasskey = {
  optionsUrl: string;
  verifyUrl: string;
  body: Record<string, unknown>;
};

// O navegador não tem a API de passkeys: a cerimônia nem começa.
export class PasskeyIndisponivelError extends Error {
  constructor() {
    super("Este navegador não cria passkeys.");
    this.name = "PasskeyIndisponivelError";
  }
}

export function navegadorTemPasskey(): boolean {
  return typeof window !== "undefined" && "PublicKeyCredential" in window;
}

// Busca as opções, pede a passkey ao aparelho e envia a resposta. O corpo (nome, e-mail) vai nos dois pedidos.
export async function createPasskey<T>({ optionsUrl, verifyUrl, body }: EntradaDaPasskey): Promise<T> {
  if (!navegadorTemPasskey()) throw new PasskeyIndisponivelError();
  const optionsJSON = await apiEnviar<PublicKeyCredentialCreationOptionsJSON>(optionsUrl, "POST", body);
  const response = await startRegistration({ optionsJSON });
  return apiEnviar<T>(verifyUrl, "POST", { ...body, response });
}

export type MensagemDaPasskey = {
  mensagem: string;
  // Para onde levar a pessoa depois da mensagem, quando a mensagem sozinha não resolve.
  acao: "entrar" | "configuracao" | null;
};

// Causa do erro do navegador: o @simplewebauthn/browser embrulha o DOMException em `cause`.
// Lê por forma (não por instanceof): o DOMException nem sempre é instância de Error, conforme o ambiente.
function nomesDoErro(erro: unknown): { nome?: string; causa?: string; codigo?: string } {
  if (typeof erro !== "object" || erro === null) return {};
  const { name, code, cause } = erro as { name?: unknown; code?: unknown; cause?: unknown };
  const nomeDaCausa =
    typeof cause === "object" && cause !== null ? (cause as { name?: unknown }).name : undefined;
  return {
    nome: typeof name === "string" ? name : undefined,
    causa: typeof nomeDaCausa === "string" ? nomeDaCausa : undefined,
    codigo: typeof code === "string" ? code : undefined,
  };
}

// Tabela de mensagens do cadastro (TASK-0103). Cada situação tem uma única mensagem.
export function mensagemDaPasskey(erro: unknown): MensagemDaPasskey {
  if (erro instanceof PasskeyIndisponivelError) {
    return {
      mensagem:
        "Este navegador não cria passkeys. Use o Safari no iPhone, o Chrome no Android ou um navegador atualizado no computador.",
      acao: null,
    };
  }
  if (erro instanceof ApiError) {
    switch (erro.code) {
      case "desafio_expirado":
        return { mensagem: "Demorou demais. Toque em Criar passkey de novo.", acao: null };
      case "lar_ja_existe":
        return {
          mensagem:
            "A conta do casal acabou de ser criada em outro aparelho. Entre com a passkey de quem criou.",
          acao: "entrar",
        };
      case "codigo_necessario":
        return { mensagem: "Digite o código de primeiro acesso para continuar.", acao: "configuracao" };
      default:
        return { mensagem: "Não deu para criar a passkey agora. Tente de novo.", acao: null };
    }
  }

  const { nome, causa, codigo } = nomesDoErro(erro);
  if (nome === "NotAllowedError" || causa === "NotAllowedError" || codigo === "ERROR_CEREMONY_ABORTED") {
    return {
      mensagem:
        "A criação da passkey foi cancelada ou o tempo acabou. Toque em Criar passkey para tentar de novo.",
      acao: null,
    };
  }
  if (
    nome === "InvalidStateError" ||
    causa === "InvalidStateError" ||
    codigo === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"
  ) {
    return { mensagem: `Este aparelho já tem uma passkey sua neste ${brand.name}.`, acao: null };
  }
  return { mensagem: "Não deu para criar a passkey agora. Tente de novo.", acao: null };
}
