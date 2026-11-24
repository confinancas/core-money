import { SPEND_TYPE_DEFS, type SpendType } from "../spend-types";

// Textos do tipo de gasto na compra (TASK-0403) e no Pix enviado (TASK-0404): o status à direita de "Tipo de gasto" e a
// ajuda abaixo dos chips. Puro. A origem vem de spend_type_source; o nome da categoria vem do detalhe (null quando a
// transação não tem categoria). kind 'pix' troca "nesta compra" por "neste Pix" e tem textos próprios para Metas e
// Investimentos (que só existem em Pix e TED).

export type OrigemDoTipoDaCompra = "escolhido" | "regra" | "categoria" | "padrao";

export type CopiaDoTipo = { status: string; help: string };

export function rotuloDoTipo(tipo: SpendType): string {
  const definicao = SPEND_TYPE_DEFS.find((item) => item.id === tipo);
  return definicao?.label ?? tipo;
}

export function spendTypeCopy(entrada: {
  type: SpendType;
  source: OrigemDoTipoDaCompra;
  kind: "compra" | "pix";
  categoryName: string | null;
}): CopiaDoTipo {
  const rotulo = rotuloDoTipo(entrada.type);
  const categoria = entrada.categoryName ?? "";
  const alvo = entrada.kind === "pix" ? "este Pix" : "esta compra";

  // Pix: Metas e Investimentos têm texto próprio, qualquer que seja a origem (a spec da 0404).
  if (entrada.kind === "pix" && entrada.type === "metas") {
    return {
      status: rotulo,
      help: "Vai para Metas: sai do limite de gasto do ciclo e soma no dinheiro guardado, como a reserva da viagem.",
    };
  }
  if (entrada.kind === "pix" && entrada.type === "investimentos") {
    return {
      status: rotulo,
      help: "Conta como dinheiro guardado. Pix para a corretora já entra aqui sozinho.",
    };
  }

  switch (entrada.source) {
    case "padrao":
      return {
        status: `${rotulo} · padrão`,
        help:
          entrada.categoryName !== null
            ? `${categoria} não tem tipo próprio, então entrou como ${rotulo}, o padrão. Toque em outro para trocar só ${alvo === "este Pix" ? "neste Pix" : "nesta compra"}.`
            : `Sem categoria ainda, então entrou como ${rotulo}, o padrão. Toque em outro para trocar.`,
      };
    case "categoria":
      return {
        status: `${rotulo} · da categoria`,
        help: `Veio da categoria ${categoria}. Toque em outro para trocar só ${alvo === "este Pix" ? "neste Pix" : "nesta compra"}.`,
      };
    case "regra":
      return {
        status: `${rotulo} · regra`,
        help: `Veio de uma regra automática. Toque em outro para trocar só ${alvo === "este Pix" ? "neste Pix" : "nesta compra"}.`,
      };
    case "escolhido":
      return {
        status: rotulo,
        help:
          entrada.kind === "pix"
            ? 'Vale para este Pix. Com "Lembrar" ligado, vale também para os próximos Pix para essa pessoa.'
            : "Vale só para esta compra. Para todas da categoria, defina o tipo padrão em Configurações › Tipos de gasto.",
      };
  }
}
