// Texto de extrato para comparar: maiúsculas, sem acento, espaços colapsados.
export function normalizeStatementText(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/\s+/g, " ").trim();
}
