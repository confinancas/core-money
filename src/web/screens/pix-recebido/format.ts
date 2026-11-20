import type { IncomeOption } from "../../../shared/income";
import { formatMoney } from "../../../shared/money";

// Textos e rótulos do Pix recebido (TASK-0903). Puros, para os testes de unidade.

// Duas letras da contraparte: a primeira de cada uma das duas primeiras palavras (ou as duas primeiras letras).
export function iniciais(nome: string | null | undefined): string {
  const limpo = (nome ?? "").trim();
  if (limpo === "") return "?";
  const palavras = limpo
    .split(/\s+/)
    .map((palavra) => palavra.replace(/^[^\p{L}]+/u, ""))
    .filter((palavra) => palavra.length > 0);
  if (palavras.length >= 2) return `${palavras[0]?.[0] ?? ""}${palavras[1]?.[0] ?? ""}`.toUpperCase();
  return limpo.slice(0, 2).toUpperCase();
}

// CNPJ quando o documento mascarado tem "/", senão CPF. Sem documento, não há rótulo.
export function rotuloDoDocumento(documento: string | null | undefined): "CPF" | "CNPJ" | null {
  if (!documento) return null;
  return documento.includes("/") ? "CNPJ" : "CPF";
}

const NOME_DO_SUBTIPO: Record<string, string> = {
  venda: "Venda",
  rendimento: "Rendimento",
  cashback: "Cashback",
  outro: "Outro",
};

// "Como conta": o estado da classificação atual, ou "Escolha uma opção" quando não há.
export function textoDeEstado(classificacao: { option: IncomeOption; incomeSubtype: string | null } | null): {
  texto: string;
  aviso: boolean;
} {
  if (classificacao === null) return { texto: "Escolha uma opção", aviso: true };
  switch (classificacao.option) {
    case "salario":
      return { texto: "Parte do salário", aviso: false };
    case "variavel":
      return {
        texto: `Renda variável · ${NOME_DO_SUBTIPO[classificacao.incomeSubtype ?? ""] ?? "Outro"}`,
        aviso: false,
      };
    case "reembolso":
      return { texto: "Fora dos cálculos", aviso: false };
    case "transferencia":
      return { texto: "Não é renda", aviso: false };
  }
}

// Impacto na renda do ciclo: "16.568,70 → 18.068,70". Sem mudança, nada a mostrar (a linha some).
export function textoDoImpacto(antesCents: number, depoisCents: number): string | null {
  if (antesCents === depoisCents) return null;
  return `${formatMoney(antesCents)} → ${formatMoney(depoisCents)}`;
}

// Hora de São Paulo do Pix ("10/10 às 18:05"), a partir da data local e do instante em ISO.
export function textoDaData(localDate: string, instanteIso: string): string {
  const [, mes, dia] = localDate.split("-");
  const hora = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(instanteIso));
  return `${dia}/${mes} às ${hora}`;
}
