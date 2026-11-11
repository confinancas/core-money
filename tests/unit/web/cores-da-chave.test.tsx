import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// N9 (TASK-0305, rodada 1): as cores dos estados da chave têm contraste de 4,5:1 ou mais sobre branco, no texto de 12 a
// 13 px. A medida é a do navegador (rgb renderizado), e a cor antiga (#E5484D e #C27400) não pode voltar.

const buscarEstado = vi.fn();
vi.mock("@/api/settings-categorization", () => ({
  fetchCategorizationStatus: () => buscarEstado(),
}));

import { SectionCategoriasEIA } from "@/screens/configuracoes/SectionCategoriasEIA";

function luminancia(r: number, g: number, b: number): number {
  const canal = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function contrasteSobreBranco(rgb: string): number {
  const partes = rgb.match(/\d+/g)?.map(Number) ?? [];
  const l = luminancia(partes[0] ?? 0, partes[1] ?? 0, partes[2] ?? 0);
  return 1.05 / (l + 0.05);
}

const base = {
  categoriesCount: 15,
  activeRulesCount: 48,
  keyMasked: null,
  chaveNovaRecente: false,
  model: null,
};

beforeEach(() => {
  buscarEstado.mockReset();
});

afterEach(() => {
  cleanup();
});

async function linhaDoEstado(keyState: string, texto: string): Promise<HTMLElement> {
  buscarEstado.mockResolvedValue({ ...base, keyState });
  render(
    <MemoryRouter>
      <SectionCategoriasEIA />
    </MemoryRouter>,
  );
  return (await screen.findByText(texto)) as HTMLElement;
}

describe("N9: contraste dos estados da chave", () => {
  it("chave recusada: texto de falta com contraste de 4,5:1 ou mais", async () => {
    const el = await linhaDoEstado("problema_chave", "A chave foi recusada · toque para trocar");
    expect(el.style.color).not.toBe("");
    expect(contrasteSobreBranco(el.style.color)).toBeGreaterThanOrEqual(4.5);
  });

  it("Claude fora do ar: texto de aviso com contraste de 4,5:1 ou mais", async () => {
    const el = await linhaDoEstado("indisponivel", "Claude fora do ar agora · tentando de novo");
    expect(el.style.color).not.toBe("");
    expect(contrasteSobreBranco(el.style.color)).toBeGreaterThanOrEqual(4.5);
  });
});
