// Substitui o virtual:pwa-register nos testes: o registro do service worker não existe no jsdom.
export function registerSW(): () => Promise<void> {
  return async () => undefined;
}
