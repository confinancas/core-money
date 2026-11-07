import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Largura, useBreakpoint } from "@/app/useBreakpoint";
import { desinstalarMatchMedia, instalarMatchMedia, mudarLargura } from "./helpers/larguras";

function Teste() {
  const largura: Largura = useBreakpoint();
  return <span data-testid="largura">{largura}</span>;
}

function larguraNaTela(): string | null {
  return screen.getByTestId("largura").textContent;
}

beforeEach(() => instalarMatchMedia(1440));

afterEach(() => {
  cleanup();
  desinstalarMatchMedia();
});

describe("useBreakpoint", () => {
  it.each([
    [767, "celular"],
    [768, "tablet"],
    [1199, "tablet"],
    [1200, "desktop"],
  ])("na largura %i px dá %s", (largura, esperado) => {
    instalarMatchMedia(largura);
    render(<Teste />);

    expect(larguraNaTela()).toBe(esperado);
  });

  it("acompanha a janela quando ela cruza as fronteiras", () => {
    instalarMatchMedia(1440);
    render(<Teste />);

    act(() => mudarLargura(900));
    expect(larguraNaTela()).toBe("tablet");

    act(() => mudarLargura(390));
    expect(larguraNaTela()).toBe("celular");
  });
});
