import { useEffect, useState } from "react";

// Mesmas larguras do manual: celular < 768 px, tablet 768 a 1199 px, desktop a partir de 1200 px.
export type Largura = "celular" | "tablet" | "desktop";

const CONSULTA_TABLET = "(min-width: 768px)";
const CONSULTA_DESKTOP = "(min-width: 1200px)";

export function larguraAtual(): Largura {
  if (window.matchMedia(CONSULTA_DESKTOP).matches) return "desktop";
  if (window.matchMedia(CONSULTA_TABLET).matches) return "tablet";
  return "celular";
}

// Renderiza só um menu por vez: a largura muda quando a janela cruza 768 ou 1200 px.
export function useBreakpoint(): Largura {
  const [largura, setLargura] = useState<Largura>(larguraAtual);

  useEffect(() => {
    const consultas = [window.matchMedia(CONSULTA_TABLET), window.matchMedia(CONSULTA_DESKTOP)];
    const aoMudar = () => setLargura(larguraAtual());
    for (const consulta of consultas) consulta.addEventListener("change", aoMudar);
    aoMudar();
    return () => {
      for (const consulta of consultas) consulta.removeEventListener("change", aoMudar);
    };
  }, []);

  return largura;
}
