// Fila Para categorizar (TASK-0304): textos e caminhos puros, compartilhados entre o servidor (que monta o item da
// API) e a tela. Nada aqui lê o banco. Os textos seguem o protótipo ParaCategorizar.dc.html e a spec da task.

export const FILTROS_DA_FILA = ["todos", "pix", "cartao", "entradas"] as const;
export type FiltroDaFila = (typeof FILTROS_DA_FILA)[number];

export const TIPOS_DA_LINHA = ["cartao", "pix", "entrada", "outro"] as const;
export type TipoDaLinha = (typeof TIPOS_DA_LINHA)[number];

// Título: o nome próprio da transação, senão "Pix para <NOME>" etc. conforme o movimento, senão a descrição original.
export function tituloDaLinha(linha: {
  movement: string;
  customName: string | null;
  counterpartyName: string | null;
  originalDescription: string;
}): string {
  const nomeProprio = linha.customName?.trim();
  if (nomeProprio) return nomeProprio;
  const contraparte = linha.counterpartyName?.trim();
  const prefixo: Record<string, string> = {
    pix_enviado: "Pix para",
    ted_enviada: "TED para",
    pix_recebido: "Pix de",
    ted_recebida: "TED de",
  };
  const p = prefixo[linha.movement];
  if (p !== undefined && contraparte) return `${p} ${contraparte}`;
  return linha.originalDescription.trim();
}

// "Hoje", "Ontem" ou dd/mm, pela data de calendário de São Paulo (AAAA-MM-DD) de hoje.
export function rotuloDaData(dataLocal: string, hoje: string): string {
  if (dataLocal === hoje) return "Hoje";
  const ontem = new Date(`${hoje}T12:00:00Z`);
  ontem.setUTCDate(ontem.getUTCDate() - 1);
  if (dataLocal === ontem.toISOString().slice(0, 10)) return "Ontem";
  const [, mes, dia] = dataLocal.split("-");
  return `${dia}/${mes}`;
}

const ROTULO_DO_MOVIMENTO: Record<string, string> = {
  pix_enviado: "Pix",
  ted_enviada: "TED",
  pix_recebido: "Pix recebido",
  ted_recebida: "TED recebida",
  debito: "Débito",
  boleto: "Boleto",
  outro: "Outra saída",
};

// Linha de detalhe: data · tipo · banco. Cartão: "06/10 · cartão Itaú". Sem banco, sem o último pedaço.
export function linhaDeDetalhe(entrada: {
  dataLocal: string;
  hoje: string;
  movement: string;
  cartao: boolean;
  banco: string | null;
}): string {
  const data = rotuloDaData(entrada.dataLocal, entrada.hoje);
  const banco = entrada.banco?.trim() ? entrada.banco.trim() : null;
  if (entrada.cartao) {
    return banco ? `${data} · cartão ${banco}` : `${data} · cartão`;
  }
  const tipo = ROTULO_DO_MOVIMENTO[entrada.movement] ?? "Outra saída";
  return banco ? `${data} · ${tipo} · ${banco}` : `${data} · ${tipo}`;
}

// Caminho do detalhe (TASK-0403, 0404 e 0903). Cartão, débito, boleto e outra saída vão a /compras; Pix e TED
// enviados a /pix; entradas a /pix-recebido.
export function caminhoDoDetalhe(entrada: { id: string; tipo: TipoDaLinha; movement: string }): string {
  const id = encodeURIComponent(entrada.id);
  if (entrada.tipo === "entrada") return `/pix-recebido/${id}`;
  if (entrada.movement === "pix_enviado" || entrada.movement === "ted_enviada") return `/pix/${id}`;
  return `/compras/${id}`;
}

// Entradas: a opção da IA vira o texto da sugestão. "salario" é a parte do salário (com a renda fixa).
const ROTULO_DA_OPCAO: Record<string, string> = {
  salario: "Parte do salário",
  variavel: "Renda variável",
  reembolso: "Reembolso de terceiros",
  transferencia: "Transferência entre vocês",
};
export const OPCAO_DA_RENDA: Record<string, string> = {
  parte_salario: "salario",
  variavel: "variavel",
  reembolso: "reembolso",
  transferencia: "transferencia",
};

export function rotuloDaOpcaoDeRenda(opcao: string): string | null {
  return ROTULO_DA_OPCAO[opcao] ?? null;
}
