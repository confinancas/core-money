// Regras de texto e de botão da tela Conectar Meu Pluggy (TASK-0203). Funções puras, sem React: o que a tela mostra
// nos quatro passos sai daqui, e o teste de unidade confere cada texto da spec.
import { brand } from "../../../../shared/brand";
import { type BankItemDto, type ConnectionDto, connectionLabelSchema } from "../../../../shared/pluggy-api";

export const TITULOS_DOS_PASSOS = ["Nome da conexão", "Chaves da API", "Escolher bancos", "Pronto"] as const;
export const TOTAL_DE_PASSOS = 4;
export type Passo = 1 | 2 | 3 | 4;

// "Passo N de 4 · <nome>", o rótulo do topo e da barra.
export function legendaDoPasso(passo: Passo): string {
  return `Passo ${passo} de ${TOTAL_DE_PASSOS} · ${TITULOS_DOS_PASSOS[passo - 1]}`;
}

// O nome sugerido: "Conta " + o primeiro nome de quem está logado, se ainda não existe uma conexão com esse nome.
export function nomeSugerido(nomeDeQuemEntrou: string, rotulosExistentes: readonly string[]): string {
  const primeiro = nomeDeQuemEntrou.trim().split(/\s+/)[0] ?? "";
  if (primeiro === "") return "";
  const sugerido = `Conta ${primeiro}`;
  const ocupado = rotulosExistentes.some((rotulo) => rotulo.toLowerCase() === sugerido.toLowerCase());
  return ocupado ? "" : sugerido;
}

// Mensagem do nome da conexão, pelo mesmo esquema do servidor (1 a 40 caracteres, sem "sua conta" e afins).
// Vazio quando o nome serve.
export function erroDoRotulo(texto: string): string | null {
  const resultado = connectionLabelSchema.safeParse(texto);
  return resultado.success ? null : (resultado.error.issues[0]?.message ?? "Confira o nome.");
}

// "Continuar" do passo 2 só habilita depois do teste; editar um campo desfaz o teste (quem chama zera `testado`).
export function podeContinuarDasChaves(testado: boolean, enviando: boolean): boolean {
  return testado && !enviando;
}

// Rótulo do botão de conectar no passo 3.
export function textoDoBotaoDeBancos(selecionados: number): string {
  if (selecionados === 0) return "Escolha um banco";
  if (selecionados === 1) return "Conectar 1 banco";
  return `Conectar ${selecionados} bancos`;
}

// Cada banco escolhido precisa de nome: o deduzido ou o digitado no cartão.
export function podeConectarBancos(
  escolhidos: { nomeDeduzido: string | null; nomeDigitado: string }[],
): boolean {
  return (
    escolhidos.length > 0 &&
    escolhidos.every((banco) => banco.nomeDeduzido !== null || banco.nomeDigitado.trim() !== "")
  );
}

// Texto do passo 4: "1 banco entrou…" ou "N bancos entraram…", com a frase do autoatendimento. O nome do app vem da marca.
export function textoDoPassoPronto(quantidade: number): string {
  const entrou =
    quantidade === 1 ? `1 banco entrou no ${brand.name}.` : `${quantidade} bancos entraram no ${brand.name}.`;
  return `${entrou} A partir de agora, tudo se atualiza sozinho uma vez por dia.`;
}

// A frase de banco repetido: a API traz o código banco_ja_conectado; a tela põe o nome do app.
export function textoDoBancoJaConectado(): string {
  return `Este banco já está no ${brand.name}.`;
}

// Sigla de dois caracteres do banco no cartão: a inicial das duas primeiras palavras (sem as de ligação), ou as duas
// primeiras letras.
export function siglaDoBanco(nome: string): string {
  // Palavras de ligação (do, da, de) não entram: "Banco do Brasil" é BB.
  const palavras = nome
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .split(/\s+/)
    .map((palavra) => palavra.replace(/[^A-Za-z0-9]/g, ""))
    .filter((palavra) => palavra.length > 2 || (palavra !== "" && palavra === palavra.toUpperCase()));
  if (palavras.length >= 2) return `${palavras[0]?.[0] ?? ""}${palavras[1]?.[0] ?? ""}`.toUpperCase();
  return (palavras[0] ?? "??").slice(0, 2).toUpperCase();
}

// "CPF ***.789": a tela mostra só os dígitos 7 a 9 do CPF mascarado pelo servidor ("***.456.789-**").
export function cpfParaTela(cpfMascarado: string | null): string | null {
  const grupo = cpfMascarado?.match(/\.(\d{3})-/)?.[1];
  return grupo === undefined ? null : `CPF ***.${grupo}`;
}

// "MM/AAAA" e "DD/MM" a partir da data ISO do Pluggy (que vem em UTC, à meia-noite).
export function mesEAno(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function diaEMesIso(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

// "autorizado até MM/AAAA" no cartão do passo 3 (sem data, nada).
export function autorizacaoDoBanco(consentExpiresAt: string | null): string {
  return consentExpiresAt === null ? "" : `autorizado até ${mesEAno(consentExpiresAt)}`;
}

const DIAS = 24 * 60 * 60 * 1000;
const DIAS_PARA_RENOVAR = 30;

// Subtítulo de um banco na seção Contas Meu Pluggy: desconectado, precisa de atenção, consentimento perto do fim,
// ou ativo com a data de validade.
export function subtituloDoBanco(banco: BankItemDto, agora: Date): string {
  if (banco.disconnectedAt !== null) return "Desconectado · histórico mantido";
  if (banco.status === "acao_necessaria") return "Precisa de atenção";
  if (banco.consentExpiresAt !== null) {
    const faltam = (Date.parse(banco.consentExpiresAt) - agora.getTime()) / DIAS;
    if (faltam <= DIAS_PARA_RENOVAR)
      return `Consentimento expira em ${diaEMesIso(banco.consentExpiresAt)} · renovar`;
    return `Ativo · expira em ${mesEAno(banco.consentExpiresAt)}`;
  }
  return "Ativo";
}

// Selo da conexão na seção: "Sem chaves" vale sobre os outros; depois "Precisa de atenção"; senão "Conectado".
export function estadoDaConexao(conexao: ConnectionDto): { texto: string; tom: "sucesso" | "aviso" } {
  if (!conexao.hasKeys) return { texto: "Sem chaves", tom: "aviso" };
  if (conexao.bankItems.some((banco) => banco.status === "acao_necessaria")) {
    return { texto: "Precisa de atenção", tom: "aviso" };
  }
  return { texto: "Conectado", tom: "sucesso" };
}

// Quantos bancos de uma conexão entram na tela de escolha (os não desconectados).
export function bancosAtivos(conexao: ConnectionDto): number {
  return conexao.bankItems.filter((banco) => banco.disconnectedAt === null).length;
}
