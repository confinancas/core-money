// Limite do plano gratuito atingido (TASK-0109): o apiFetch avisa aqui quando a Cloudflare ou o D1 recusam, e a moldura
// troca o conteúdo pela tela LimitReached. Fica fora do React para o apiFetch poder avisar sem um provedor.
export type MotivoDoLimite = "requisicoes" | "banco";

let atual: MotivoDoLimite | null = null;
const ouvintes = new Set<() => void>();

function avisa(): void {
  for (const ouvinte of ouvintes) ouvinte();
}

export function avisaLimiteAtingido(motivo: MotivoDoLimite): void {
  if (atual === motivo) return;
  atual = motivo;
  avisa();
}

// Chamado por "Tentar de novo": a tela volta ao conteúdo, e a próxima chamada decide de novo.
export function limpaLimiteAtingido(): void {
  if (atual === null) return;
  atual = null;
  avisa();
}

export function lerLimiteAtingido(): MotivoDoLimite | null {
  return atual;
}

// Para useSyncExternalStore: devolve a função que para de ouvir.
export function ouvirLimiteAtingido(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}
