// Tipos de scripts/dev/e2e-portas.mjs, para o TypeScript do E2E e os testes. A lógica fica no .mjs.
export type PortasDoE2E = {
  base: number;
  instalacaoPronta: number;
  stub: number;
  configuracao: number;
  inspecaoInstalacaoPronta: number;
  inspecaoConfiguracao: number;
};

export function portasDoE2E(entrada: string | undefined): PortasDoE2E;
