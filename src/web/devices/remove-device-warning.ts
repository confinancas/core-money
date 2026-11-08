// Confirmação de remover um aparelho (TASK-0106): qual dos textos da spec vale para o caso. Função pura, para o teste
// de unidade. A confirmação é pelo useConfirm da tela (nunca confirm()).
export type OpcoesDeRemocao = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: "danger";
};

export type CasoDeRemocao = {
  // Nome da pessoa dona do aparelho.
  nome: string;
  // Nome do aparelho, como a lista mostra.
  aparelho: string;
  // É o aparelho que esta tela está usando.
  ehAtual: boolean;
  // É o único aparelho da pessoa.
  ehUltimo: boolean;
};

// Três textos da spec: o comum, o do aparelho em uso e o do último aparelho de alguém. Quando o aparelho em uso também
// é o último da pessoa, o texto junta os dois (decisão de nível 1: as duas consequências importam).
export function textoDeRemocao(caso: CasoDeRemocao): OpcoesDeRemocao {
  const { nome, aparelho, ehAtual, ehUltimo } = caso;
  let description = `Remover ${aparelho}? Ele deixa de entrar, e a sessão aberta nele termina agora.`;
  if (ehAtual && ehUltimo) {
    description = `Este é o aparelho que você está usando e o único de ${nome}. Ao remover, você sai agora, e ${nome} só volta a entrar com um link de recuperação.`;
  } else if (ehAtual) {
    description = "Este é o aparelho que você está usando. Ao remover, você sai agora.";
  } else if (ehUltimo) {
    description = `É o único aparelho de ${nome}. Depois de remover, ${nome} só volta a entrar com um link de recuperação.`;
  }
  return {
    title: "Remover aparelho?",
    description,
    confirmLabel: "Remover",
    cancelLabel: "Manter",
    tone: "danger",
  };
}
