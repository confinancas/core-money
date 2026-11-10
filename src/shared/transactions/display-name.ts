// Nome que a interface mostra para um lançamento (TASK-0402; a fila de categorização, na TASK-0304, usa a mesma
// regra). Ordem: o nome corrigido pelo casal; senão, para Pix e TED, quem recebeu ou quem mandou; senão, a descrição
// original do extrato. Nome corrigido em branco não conta.

export type LancamentoParaNome = {
  customName: string | null;
  movement: string;
  counterpartyName: string | null;
  originalDescription: string;
};

export function displayName(lancamento: LancamentoParaNome): string {
  const nomeCorrigido = lancamento.customName?.trim();
  if (nomeCorrigido) return nomeCorrigido;

  const contraparte = lancamento.counterpartyName?.trim();
  if (contraparte) {
    switch (lancamento.movement) {
      case "pix_enviado":
        return `Pix para ${contraparte}`;
      case "ted_enviada":
        return `TED para ${contraparte}`;
      case "pix_recebido":
        return `Pix de ${contraparte}`;
      case "ted_recebida":
        return `TED de ${contraparte}`;
    }
  }

  return lancamento.originalDescription;
}
