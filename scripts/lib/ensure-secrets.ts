import type { Wrangler } from "./wrangler";

// Passo 6 da instalação (TASK-0101), também usado pelo botão (TASK-0110). A chave mestra é gerada uma vez: se o
// secret já existe, nunca é sobrescrito, porque trocá-la torna ilegíveis as chaves cifradas (ADR-004).
export const NOME_DA_CHAVE_MESTRA = "MASTER_KEY";

export type ResultadoDosSegredos = "criada" | "ja-existia";

// 32 bytes aleatórios em base64. Só existe na memória do processo e no stdin do secret put.
export function geraChaveMestra(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

export async function ensureSecrets(
  wrangler: Wrangler,
  opcoes: { config: string; gerarChave?: () => string },
): Promise<ResultadoDosSegredos> {
  const nomes = await wrangler.listaSegredos(opcoes.config);
  if (nomes.includes(NOME_DA_CHAVE_MESTRA)) return "ja-existia";
  const chave = (opcoes.gerarChave ?? geraChaveMestra)();
  await wrangler.gravaSegredo(NOME_DA_CHAVE_MESTRA, chave, opcoes.config);
  return "criada";
}
