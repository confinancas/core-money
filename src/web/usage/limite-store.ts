// Limite do plano gratuito atingido (TASK-0109): o apiFetch avisa aqui quando a Cloudflare ou o D1 recusam, e a moldura
// troca o conteúdo pela tela LimitReached. Fica fora do React para o apiFetch poder avisar sem um provedor.
export type MotivoDoLimite = "requisicoes" | "banco";

let atual: MotivoDoLimite | null = null;
const ouvintes = new Set<() => void>();

// Ordem das chamadas: cada requisição pega um número ao começar, e o limite guarda o número de quando apareceu. Uma
// resposta boa só limpa o aviso se a requisição começou depois dele (TASK-0109, rodada 1): a leitura que já estava
// no ar quando o limite apareceu não desmente o limite que outra chamada acabou de mostrar.
let sequencia = 0;
let registradoEm = 0;

export function proximaSequencia(): number {
  sequencia += 1;
  return sequencia;
}

function avisa(): void {
  for (const ouvinte of ouvintes) ouvinte();
}

export function avisaLimiteAtingido(motivo: MotivoDoLimite): void {
  if (atual === motivo) return;
  atual = motivo;
  registradoEm = proximaSequencia();
  avisa();
}

// Sem `desde`: limpa sempre (o "Tentar de novo" da tela de limite, que também recarrega a página). Com `desde`, a
// resposta boa de uma chamada que começou em `desde` só limpa se começou depois de o limite aparecer.
export function limpaLimiteAtingido(desde?: number): void {
  if (atual === null) return;
  if (desde !== undefined && desde <= registradoEm) return;
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
