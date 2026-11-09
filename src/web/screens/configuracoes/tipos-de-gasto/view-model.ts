import { cycleLabel } from "../../../../shared/cycle";
import {
  investmentsPct,
  limitPct,
  type PlannedPercentages,
  type PlannedSpendType,
  SPEND_TYPE_DEFS,
  type SpendType,
  sumPlanned,
} from "../../../../shared/spend-types";
import type { CategoriaDeTipo, RegraAutomatica, TiposDeGastoResposta } from "../../../api/spend-types";

// Textos e números da tela TiposGasto (TASK-0802), sem React: testáveis. Os textos são os da spec.

export const TIPOS_DO_LIMITE: SpendType[] = ["fixos", "conforto", "educacao", "extras", "prazeres"];
export const TIPOS_GUARDADOS: SpendType[] = ["metas"];
export const PASSO_PERCENTUAL = 1;

export const TEXTO_DO_TOTAL_ABAIXO = "100%";
export const AVISO_DE_SOMA = "Os outros tipos passam de 100%. Reduza algum para sobrar para Investimentos.";
export const TEXTO_BASE_SEM_RENDA =
  "Base: a renda do ciclo anterior, que entra no começo de cada ciclo. Investimentos é o que sobra: ajusta sozinho para fechar 100%.";
export const TEXTO_DO_LIMITE_SEM_VALOR = "O limite entra no começo do próximo ciclo.";
export const TEXTO_DO_LIMITE =
  "Calculada sozinha no início de cada ciclo e usada no anel da tela inicial. Metas e Investimentos ficam fora: é dinheiro guardado, não gasto.";
export const TEXTO_DA_CATEGORIA =
  "Toda compra herda o tipo da categoria. Você pode trocar numa compra específica.";
export const TEXTO_DO_PADRAO = "Todo gasto sem regra ou tipo de categoria entra como Prazeres";
export const TEXTO_DA_FOLHA_DA_REGRA =
  "O app procura este texto na descrição do banco ou no nome de quem recebeu.";

// Ordem da barra e das linhas: a da SPEND_TYPE_DEFS.
export function segmentosDaBarra(
  percentuais: PlannedPercentages,
): { id: SpendType; color: string; largura: number }[] {
  const invest = investmentsPct(percentuais);
  const total = Math.max(100, 100 - invest);
  return SPEND_TYPE_DEFS.map((tipo) => {
    const valor = tipo.pctKey === null ? Math.max(0, invest) : percentuais[tipo.pctKey as PlannedSpendType];
    return { id: tipo.id, color: tipo.color, largura: (Math.max(0, valor) / total) * 100 };
  });
}

// O total é sempre 100% quando os seis tipos cabem (Investimentos é a sobra e fecha a conta); acima de 100, mostra a
// soma dos seis, em vermelho.
export function totalDaDistribuicao(percentuais: PlannedPercentages): { texto: string; passou: boolean } {
  const soma = sumPlanned(percentuais);
  return { texto: `${Math.max(100, soma)}%`, passou: soma > 100 };
}

export function textoDaBase(base: TiposDeGastoResposta["base"], formatar: (cents: number) => string): string {
  if (base === null) return TEXTO_BASE_SEM_RENDA;
  return `Base: renda de ${base.label}, ${formatar(base.prevIncomeCents)}. Investimentos é o que sobra: ajusta sozinho para fechar 100%.`;
}

// Valor por ciclo de um tipo: a base × o percentual (sem base: nada).
export function valorPorCiclo(base: TiposDeGastoResposta["base"], pct: number): number | null {
  if (base === null) return null;
  return Math.round((base.prevIncomeCents * pct) / 100);
}

export function textoDoLimite(
  limite: TiposDeGastoResposta["currentLimit"],
  percentuais: PlannedPercentages,
): { valorCents: number | null; linha: string | null; proximo: string | null; semValor: string | null } {
  if (limite === null) {
    return { valorCents: null, linha: null, proximo: null, semValor: TEXTO_DO_LIMITE_SEM_VALOR };
  }
  const agora = limitPct(percentuais);
  return {
    valorCents: limite.spendLimitCents,
    linha: `${limite.pct}% da renda do ciclo anterior · Fixos + Conforto + Educação + Extras + Prazeres`,
    proximo:
      agora !== limite.pct ? `Com os novos percentuais, o próximo ciclo terá ${agora}% da renda.` : null,
    semValor: null,
  };
}

// Só o mês e a regra da fotografia; a folha de cada tipo usa o nome e o texto da spec.
export function rotuloDaCategoria(categoria: CategoriaDeTipo): {
  titulo: string;
  etiqueta: string;
  sem: string | null;
} {
  if (categoria.parentId === null) {
    return {
      titulo: categoria.name,
      etiqueta: "Categoria",
      sem: categoria.defaultSpendType === null ? "Sem tipo próprio · usa o padrão" : null,
    };
  }
  return {
    titulo: categoria.name,
    etiqueta: `Subcategoria de ${categoria.parentName ?? ""}`.trim(),
    sem: categoria.defaultSpendType === null ? `Usa o tipo de ${categoria.parentName ?? ""}` : null,
  };
}

// Texto do aviso da regra automática na lista (o tipo que ela dá e a conta que a define).
export function textoDaRegra(
  regra: RegraAutomatica | undefined,
  kind: RegraAutomatica["kind"],
): {
  titulo: string;
  descricao: string;
  acao: "Definir" | "Editar";
} {
  if (kind === "corretora") {
    return {
      titulo: "Pix para a corretora",
      descricao: regra
        ? `${regra.matchValue} · vira Investimentos`
        : "Conta destino cadastrada · vira Investimentos",
      acao: regra ? "Editar" : "Definir",
    };
  }
  return {
    titulo: "Reserva de metas",
    descricao: regra ? `${regra.matchValue} · vira Metas` : "Transferência para a caixinha · vira Metas",
    acao: regra ? "Editar" : "Definir",
  };
}

export function textoDeRegrasSalvas(quantas: number, tipo: SpendType): string {
  const rotulo = SPEND_TYPE_DEFS.find((def) => def.id === tipo)?.label ?? tipo;
  if (quantas === 1) return `Regra salva. 1 transação virou ${rotulo}.`;
  return `Regra salva. ${quantas} transações viraram ${rotulo}.`;
}

// O número que o casal acompanha: quanto do percentual cabe no ciclo.
export function percentualDaLinha(percentuais: PlannedPercentages, tipo: SpendType): number {
  const def = SPEND_TYPE_DEFS.find((item) => item.id === tipo);
  if (!def || def.pctKey === null) return investmentsPct(percentuais);
  return percentuais[def.pctKey as PlannedSpendType];
}

// Muda um percentual (de 0 a 100, passo 1). Devolve o novo conjunto ou o mesmo quando já está no limite.
export function mudaPercentual(
  percentuais: PlannedPercentages,
  tipo: SpendType,
  delta: number,
): PlannedPercentages {
  const def = SPEND_TYPE_DEFS.find((item) => item.id === tipo);
  if (!def || def.pctKey === null) return percentuais;
  const atual = percentuais[def.pctKey as PlannedSpendType];
  const novo = Math.min(100, Math.max(0, atual + delta));
  return { ...percentuais, [def.pctKey]: novo };
}

// Tipos que aparecem na folha de escolha de uma categoria: os sete, na ordem da barra.
export const OPCOES_DE_TIPO: { valor: SpendType; rotulo: string }[] = SPEND_TYPE_DEFS.map((tipo) => ({
  valor: tipo.id,
  rotulo: tipo.label,
}));

// A fotografia "Ciclo": o mês do ciclo anterior em minúsculas, para o texto da base.
export function mesDoCiclo(chave: string): string {
  return cycleLabel(chave).toLowerCase();
}

export const textoDoSalvo = "Salvo";
