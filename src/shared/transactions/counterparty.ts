// Pix enviado (TASK-0404): textos e formatos da contraparte, puros. Compartilhado entre o detalhe da API e a tela.

// Tipo do documento pelas posições de dígito do mascarado (dígitos e •; pontuação não conta): 11 é CPF, 14 é CNPJ.
export function docKindDe(mascarado: string | null): "cpf" | "cnpj" | null {
  if (mascarado === null || mascarado.trim() === "") return null;
  const posicoes = mascarado.replace(/[^0-9•]/g, "").length;
  if (posicoes === 11) return "cpf";
  if (posicoes === 14) return "cnpj";
  return null;
}

// Iniciais do avatar: a primeira letra da primeira palavra e da última (uma palavra só dá uma letra). Sem nome, null.
export function iniciaisDe(nome: string | null): string | null {
  if (nome === null) return null;
  const palavras = nome.trim().split(/\s+/).filter((p) => p !== "");
  if (palavras.length === 0) return null;
  const primeira = palavras[0]?.charAt(0) ?? "";
  const ultima = palavras.length > 1 ? (palavras[palavras.length - 1]?.charAt(0) ?? "") : "";
  const iniciais = (primeira + ultima).toUpperCase();
  return iniciais === "" ? null : iniciais;
}
