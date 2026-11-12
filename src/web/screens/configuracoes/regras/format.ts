import type { RegraDaLista } from "../../../../shared/rule-match";
import { SPEND_TYPES } from "../../../../shared/spend-types";

// Textos da lista de regras (TASK-0305). Puro: a tela e os testes de unidade usam as mesmas funções.

export type PedacoDaAcao =
  | { tipo: "categoria"; nome: string; cor: string | null }
  | { tipo: "texto"; texto: string };

const ORIGEM: Record<string, string> = {
  lembrar: "Lembrar",
  aplicar_todas: "Aplicar a todas",
  confirmacao: "Confirmação",
  manual: "Manual",
};

// Rótulo de como a regra nasceu (createdFrom).
export function rotuloDeCriadaPor(createdFrom: string): string {
  return ORIGEM[createdFrom] ?? "Confirmação";
}

// Renda que a regra marca: a mesma nomenclatura do contexto da IA (parte_salario, variavel com subtipo, reembolso,
// transferencia).
export function rotuloDaRenda(kind: string | null, subtipo: string | null): string | null {
  if (kind === null) return null;
  if (kind === "parte_salario") return "Parte do salário";
  if (kind === "variavel") {
    const subtipoTexto = subtipo === null ? "" : ` · ${capitaliza(subtipo)}`;
    return `Renda variável${subtipoTexto}`;
  }
  if (kind === "reembolso") return "Reembolso de terceiros";
  if (kind === "transferencia") return "Transferência entre vocês";
  return null;
}

function capitaliza(texto: string): string {
  return texto.length === 0 ? texto : texto[0]?.toUpperCase() + texto.slice(1);
}

// Tudo o que a regra faz, na ordem da tela: a categoria (com a bolinha), o nome, o tipo de gasto e a renda.
// Uma regra que não faz nada sai como "Sem efeito".
export function acoesDaRegra(regra: RegraDaLista): PedacoDaAcao[] {
  const acoes: PedacoDaAcao[] = [];
  if (regra.set.categoryId !== null) {
    acoes.push(
      regra.set.categoryName !== null
        ? { tipo: "categoria", nome: regra.set.categoryName, cor: regra.set.categoryColor }
        : { tipo: "texto", texto: "Categoria removida" },
    );
  }
  if (regra.set.customName !== null)
    acoes.push({ tipo: "texto", texto: `Renomeia para "${regra.set.customName}"` });
  if (regra.set.spendType !== null) {
    const tipo = SPEND_TYPES.find((spend) => spend.id === regra.set.spendType);
    acoes.push({ tipo: "texto", texto: tipo?.label ?? "Tipo de gasto" });
  }
  const renda = rotuloDaRenda(regra.set.incomeKind, regra.set.incomeSubtype);
  if (renda !== null) acoes.push({ tipo: "texto", texto: renda });
  return acoes.length > 0 ? acoes : [{ tipo: "texto", texto: "Sem efeito" }];
}

// "dd/mm" da criação, pela data local do aparelho.
export function dataCurta(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  return `${String(data.getDate()).padStart(2, "0")}/${String(data.getMonth() + 1).padStart(2, "0")}`;
}

// Linha de criação: "dd/mm · Nome · Origem" (sem o nome quando não há).
export function linhaDeCriacao(regra: RegraDaLista): string {
  const partes = [dataCurta(regra.createdAt)];
  if (regra.createdByName !== null) partes.push(regra.createdByName);
  partes.push(rotuloDeCriadaPor(regra.createdFrom));
  return partes.filter((parte) => parte !== "").join(" · ");
}

// Texto do aviso de desfazer, com o que a regra casa.
export function textoDeDesfazer(matchLabel: string): string {
  return `Desfazer a regra de ${matchLabel}? As próximas transações voltam para a fila Para categorizar. As que já foram continuam como estão.`;
}
