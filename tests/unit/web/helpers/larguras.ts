import { vi } from "vitest";

// Simula matchMedia para (min-width: N px). Cada mudança de largura dispara o evento "change", como o navegador.
type Ouvinte = () => void;

let largura = 1440;
const ouvintes = new Set<Ouvinte>();

function consultaCasa(consulta: string): boolean {
  const minimo = /min-width:\s*(\d+)px/.exec(consulta);
  return minimo ? largura >= Number(minimo[1]) : false;
}

export function instalarMatchMedia(larguraInicial: number): void {
  largura = larguraInicial;
  ouvintes.clear();
  vi.stubGlobal("matchMedia", (consulta: string) => {
    const lista = {
      media: consulta,
      get matches() {
        return consultaCasa(consulta);
      },
      addEventListener: (_tipo: string, ouvinte: Ouvinte) => ouvintes.add(ouvinte),
      removeEventListener: (_tipo: string, ouvinte: Ouvinte) => ouvintes.delete(ouvinte),
      addListener: (ouvinte: Ouvinte) => ouvintes.add(ouvinte),
      removeListener: (ouvinte: Ouvinte) => ouvintes.delete(ouvinte),
      onchange: null,
      dispatchEvent: () => false,
    };
    return lista;
  });
}

// Muda a largura da janela e avisa quem está ouvindo (como o navegador faz ao redimensionar).
export function mudarLargura(novaLargura: number): void {
  largura = novaLargura;
  for (const ouvinte of [...ouvintes]) ouvinte();
}

export function desinstalarMatchMedia(): void {
  ouvintes.clear();
  vi.unstubAllGlobals();
}
