// Visita da fila Para categorizar (TASK-0304): as confirmações e o total do começo, guardados no sessionStorage para a
// visita sobreviver à remontagem da tela quando a largura cruza um breakpoint (o celular girando). A visita acaba quando
// a pessoa sai da fila: a moldura do app (que não desmonta) apaga a visita em todo caminho fora da fila, e a tela só
// grava no caminho da fila. Assim, nenhuma ordem de efeitos (limpeza do desmonte, resposta que chega depois da
// navegação) traz de volta a visita de antes.

export const CHAVE_DA_VISITA = "mm.para-categorizar.visita";
export const CAMINHO_DA_FILA = "/para-categorizar";

export type VisitaGuardada<T> = { confirmadas: T[]; total: number | null };

export function lerVisita<T>(): VisitaGuardada<T> {
  try {
    const bruto = sessionStorage.getItem(CHAVE_DA_VISITA);
    if (!bruto) return { confirmadas: [], total: null };
    const v = JSON.parse(bruto) as Partial<VisitaGuardada<T>>;
    return {
      confirmadas: Array.isArray(v.confirmadas) ? v.confirmadas : [],
      total: typeof v.total === "number" ? v.total : null,
    };
  } catch {
    return { confirmadas: [], total: null };
  }
}

export function apagarVisita(): void {
  try {
    sessionStorage.removeItem(CHAVE_DA_VISITA);
  } catch {
    // Sem armazenamento, não há o que apagar.
  }
}

// Grava só quando o caminho atual é o da fila: uma gravação que chega depois da navegação (a tela velha ainda montada,
// com uma resposta atrasada) não traz a visita de volta.
export function gravarVisita<T>(visita: VisitaGuardada<T>, caminhoAtual: string): void {
  if (caminhoAtual !== CAMINHO_DA_FILA) return;
  try {
    sessionStorage.setItem(CHAVE_DA_VISITA, JSON.stringify(visita));
  } catch {
    // Sem armazenamento: a visita vale só nesta montagem.
  }
}

// Chamada pela moldura a cada troca de caminho: fora da fila, a visita acaba.
export function encerrarVisitaForaDaFila(caminho: string): void {
  if (caminho !== CAMINHO_DA_FILA) apagarVisita();
}
