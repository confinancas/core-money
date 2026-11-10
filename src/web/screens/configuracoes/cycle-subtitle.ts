// Subtítulo de "Início do ciclo" (TASK-0107): do dia D ao dia D−1 do mês seguinte. Com D = 1, o ciclo vai do dia 1 ao
// último dia do mês (não existe "dia 0").
export function subtituloDoCiclo(dia: number): string {
  if (dia === 1) return "Do dia 1 ao último dia do mês";
  return `Do dia ${dia} ao dia ${dia - 1} do mês seguinte`;
}

// Os dias que o seletor oferece: de 1 a 28, o mesmo intervalo do servidor (householdPatchSchema).
export const DIAS_DO_CICLO: number[] = Array.from({ length: 28 }, (_, indice) => indice + 1);
