import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryDTO } from "../../../../src/shared/categories";

// Editor de categoria (TASK-0305, rodada 1 da avaliação). O PATCH leva só os campos que o editor controla: o tipo
// padrão é da tela Tipos de gasto (TASK-0802), e mandá-lo como null apagaria o tipo e rederivaria as transações.

const atualizar = vi.fn(async () => ({}));
vi.mock("@/api/categories", () => ({
  updateCategory: (...args: unknown[]) => atualizar(...(args as [])),
}));

import { EditarCategoria } from "@/screens/configuracoes/categorias/EditarCategoria";

const servicos: CategoryDTO = {
  id: "cat-servicos",
  name: "Serviços",
  color: "#1B84F2",
  parentId: null,
  defaultSpendType: "fixos",
  aiHint: null,
  sort: 0,
  archived: false,
};

beforeEach(() => {
  atualizar.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("F1: salvar o editor não mexe no tipo padrão", () => {
  it("o PATCH leva só nome, cor, mãe e dica; sem defaultSpendType", async () => {
    render(<EditarCategoria categoria={servicos} todas={[servicos]} aoMudar={() => {}} />);

    fireEvent.change(screen.getByLabelText("Nome", { exact: true }), {
      target: { value: "[TEST] Serviços gerais" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(atualizar).toHaveBeenCalledTimes(1));
    const [id, corpo] = atualizar.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(id).toBe("cat-servicos");
    expect(Object.keys(corpo).sort()).toEqual(["aiHint", "color", "name", "parentId"]);
    expect(corpo).toMatchObject({ name: "[TEST] Serviços gerais", color: "#1B84F2", parentId: null });
  });
});

describe("F3: no editor ao lado da lista, o formulário fica em coluna no tablet", () => {
  it("a prévia e os campos não ficam lado a lado (sem tablet:flex-row no corpo do formulário)", () => {
    const { container } = render(<EditarCategoria categoria={servicos} todas={[servicos]} aoMudar={() => {}} />);
    const corpo = container.querySelector("form > div");
    expect(corpo).not.toBeNull();
    expect(corpo?.className).not.toContain("tablet:flex-row");
  });
});

describe("F5: 'Dentro de' não oferece principal arquivada", () => {
  const lazerArquivada: CategoryDTO = { ...servicos, id: "cat-lazer", name: "Lazer", color: "#13B5A6", archived: true };
  const mercado: CategoryDTO = { ...servicos, id: "cat-mercado", name: "Mercado", color: "#22B8E0" };

  it("uma principal arquivada não aparece nas opções; a ativa aparece", () => {
    render(<EditarCategoria categoria={servicos} todas={[servicos, mercado, lazerArquivada]} aoMudar={() => {}} />);
    expect(screen.queryByRole("option", { name: "Lazer", exact: true })).toBeNull();
    expect(screen.getByRole("option", { name: "Mercado", exact: true })).toBeTruthy();
  });

  it("a mãe atual, se estiver arquivada, continua como opção para não sumir do campo", () => {
    const subcategoria: CategoryDTO = { ...servicos, id: "cat-sub", name: "Cinema", parentId: "cat-lazer" };
    render(<EditarCategoria categoria={subcategoria} todas={[subcategoria, lazerArquivada]} aoMudar={() => {}} />);
    expect(screen.getByRole("option", { name: "Lazer", exact: true })).toBeTruthy();
  });
});
