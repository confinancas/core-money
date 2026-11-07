import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RostoIA, transformarRosto } from "@/components/RostoIA";

afterEach(cleanup);

// Ids de um trecho de SVG e as referências url(#…) que ele faz.
function idsEReferencias(html: string) {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((casa) => casa[1]);
  const referencias = [...html.matchAll(/url\(#([^)]+)\)/g)].map((casa) => casa[1]);
  return { ids, referencias };
}

describe("RostoIA", () => {
  it("duas instâncias na mesma tela não repetem id", () => {
    const { container } = render(
      <>
        <RostoIA tamanho={60} />
        <RostoIA tamanho={46} />
      </>,
    );
    const todosOsIds = [...container.querySelectorAll("[id]")].map((elemento) => elemento.id);

    expect(todosOsIds.length).toBeGreaterThan(0);
    expect(new Set(todosOsIds).size).toBe(todosOsIds.length);
  });

  it("cada url(#…) aponta para um id da própria instância", () => {
    const { container } = render(
      <>
        <RostoIA />
        <RostoIA />
      </>,
    );
    const instancias = [...container.querySelectorAll(".mm-rosto")];

    expect(instancias).toHaveLength(2);
    for (const instancia of instancias) {
      const { ids, referencias } = idsEReferencias(instancia.innerHTML);
      expect(referencias.length).toBeGreaterThan(0);
      for (const referencia of referencias) {
        expect(ids).toContain(referencia);
      }
    }
  });

  it("é decorativo e tem o tamanho pedido, sem <style> do arquivo", () => {
    const { container } = render(<RostoIA tamanho={60} />);
    const rosto = container.querySelector(".mm-rosto");

    expect(rosto).toHaveAttribute("aria-hidden", "true");
    expect(rosto).toHaveStyle({ width: "60px", height: "60px" });
    expect(rosto?.querySelector("style")).toBeNull();
  });
});

describe("transformarRosto", () => {
  it("tira o <style> e troca ids e referências pelo prefixo", () => {
    const svg = '<svg><style>.x{}</style><defs><filter id="rfglow"/></defs><g filter="url(#rfglow)"/></svg>';

    const saida = transformarRosto(svg, "abc");

    expect(saida).not.toContain("<style>");
    expect(saida).toContain('id="abc-rfglow"');
    expect(saida).toContain("url(#abc-rfglow)");
    expect(saida).not.toContain('"rfglow"');
  });
});
