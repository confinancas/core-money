import { SPEND_TYPE_DEFS, type SpendType } from "../spend-types";

// Textos do tipo de gasto na tela Compra (TASK-0403): o status à direita de "Tipo de gasto" e a ajuda abaixo dos chips.
// Puro. A origem vem de spend_type_source; o nome da categoria vem do detalhe (null quando a compra não tem categoria).
// O tipo mostrado é o que a compra tem; a ajuda diz de onde ele veio e como trocar.

export type OrigemDoTipoDaCompra = "escolhido" | "regra" | "categoria" | "padrao";

export type CopiaDoTipo = { status: string; help: string };

export function rotuloDoTipo(tipo: SpendType): string {
  const definicao = SPEND_TYPE_DEFS.find((item) => item.id === tipo);
  return definicao?.label ?? tipo;
}

export function spendTypeCopy(entrada: {
  type: SpendType;
  source: OrigemDoTipoDaCompra;
  kind: "compra";
  categoryName: string | null;
}): CopiaDoTipo {
  const rotulo = rotuloDoTipo(entrada.type);
  const categoria = entrada.categoryName ?? "";

  switch (entrada.source) {
    case "padrao":
      return {
        status: `${rotulo} · padrão`,
        help:
          entrada.categoryName !== null
            ? `${categoria} não tem tipo próprio, então entrou como ${rotulo}, o padrão. Toque em outro para trocar só nesta compra.`
            : `Sem categoria ainda, então entrou como ${rotulo}, o padrão. Toque em outro para trocar.`,
      };
    case "categoria":
      return {
        status: `${rotulo} · da categoria`,
        help: `Veio da categoria ${categoria}. Toque em outro para trocar só nesta compra.`,
      };
    case "regra":
      return {
        status: `${rotulo} · regra`,
        help: "Veio de uma regra automática. Toque em outro para trocar só nesta compra.",
      };
    case "escolhido":
      return {
        status: rotulo,
        help: "Vale só para esta compra. Para todas da categoria, defina o tipo padrão em Configurações › Tipos de gasto.",
      };
  }
}
