// Chave do estabelecimento: é o que as regras (TASK-0302) reconhecem. Uma compra confirmada uma vez não volta para a
// fila nas parcelas seguintes, porque a marca de parcela sai da chave.

// Marca de parcela no fim do texto: "02/10", "PARC 03/10", "PARCELA 3 DE 10". Aplicada depois das maiúsculas.
export const INSTALLMENT_SUFFIX_RE = /\s*(?:PARC(?:ELA)?\.?\s*)?\d{1,2}\s*(?:\/|DE)\s*\d{1,2}$/;

// Maiúsculas, sem acento, espaços colapsados e sem a marca de parcela. Dígitos no meio do nome ficam.
// Texto vazio (ou só marca de parcela) devolve null.
export function establishmentKey(description: string): string | null {
  const chave = description
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(INSTALLMENT_SUFFIX_RE, "")
    .trim();
  return chave === "" ? null : chave;
}
