import { formatMoney } from "./money";

// Valor digitado em reais (pt-BR) para centavos inteiros (TASK-0901). Aceita "2.000,00", "2000", "2000,5" (vira 200050)
// e "0,99". Recusa (devolve null) o vazio, o negativo, as letras, mais de 2 casas e separadores trocados ("2,000.00",
// "1,234"). Dinheiro não passa por parseFloat: a conta é só de inteiros.
const FORMATO = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

export function parseMoneyInput(texto: string): number | null {
  const casa = FORMATO.exec(texto.trim());
  if (casa === null) return null;
  const reais = Number((casa[1] ?? "").replace(/\./g, ""));
  const centavos = casa[2] === undefined ? 0 : Number(casa[2].padEnd(2, "0"));
  const total = reais * 100 + centavos;
  return Number.isSafeInteger(total) ? total : null;
}

// Texto do campo: "2.000,00" (sem o sinal; o campo só recebe valores positivos). Vai e volta com parseMoneyInput.
export function formatMoneyInput(centavos: number): string {
  return formatMoney(centavos, "none");
}
