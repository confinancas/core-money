// Cache da apiKey do Pluggy, em memória do módulo. Chave = cacheKey (o id da conexão).
// O valor nunca vai para o D1 nem para log. Vale 110 minutos (a apiKey do Pluggy dura 2 horas).

export const TTL_API_KEY_MS = 110 * 60 * 1000;

type Entrada = { apiKey: string; expiraEm: number };

const cache = new Map<string, Entrada>();

export function lerApiKey(cacheKey: string, agora: number): string | null {
  const entrada = cache.get(cacheKey);
  if (entrada === undefined) return null;
  if (agora >= entrada.expiraEm) {
    cache.delete(cacheKey);
    return null;
  }
  return entrada.apiKey;
}

export function guardarApiKey(cacheKey: string, apiKey: string, agora: number): void {
  cache.set(cacheKey, { apiKey, expiraEm: agora + TTL_API_KEY_MS });
}

export function apagarApiKey(cacheKey: string): void {
  cache.delete(cacheKey);
}

// Só para os testes: esvazia o cache do módulo entre um teste e outro.
export function limparCacheApiKey(): void {
  cache.clear();
}
