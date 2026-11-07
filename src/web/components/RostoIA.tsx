import { useId, useMemo } from "react";
import { cn } from "@/lib/utils";
import rostoSvg from "../assets/rosto-ia.svg?raw";

// Troca os ids do SVG pelo prefixo da instância (e os url(#…) que apontam para eles), tira o <style> (as animações estão no global.css).
export function transformarRosto(svg: string, prefixo: string): string {
  const semEstilo = svg.replace(/<style[\s\S]*?<\/style>/, "");
  const ids = [...semEstilo.matchAll(/\bid="([^"]+)"/g)].map((casa) => casa[1]);
  let saida = semEstilo;
  for (const id of new Set(ids)) {
    saida = saida
      .replaceAll(`id="${id}"`, `id="${prefixo}-${id}"`)
      .replaceAll(`url(#${id})`, `url(#${prefixo}-${id})`);
  }
  return saida;
}

// Rosto animado da IA. Decorativo (aria-hidden): o nome do botão que o contém é que fala.
export function RostoIA({ tamanho = 60, className }: { tamanho?: number; className?: string }) {
  // Sem caracteres que o useId possa devolver fora de um id válido (React usa «» e :).
  const prefixo = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const html = useMemo(() => transformarRosto(rostoSvg, prefixo), [prefixo]);

  return (
    <span
      aria-hidden="true"
      className={cn("mm-rosto", className)}
      style={{ width: tamanho, height: tamanho }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG estático do próprio repositório (rosto-ia.svg), sem entrada de usuário.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
