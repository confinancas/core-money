import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HouseholdFooter } from "@/app/frame/HouseholdFooter";

afterEach(cleanup);

describe("HouseholdFooter", () => {
  it("sem membros (null) não renderiza nada", () => {
    const { container } = render(<HouseholdFooter members={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("lista vazia não renderiza nada", () => {
    const { container } = render(<HouseholdFooter members={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("com Ana e Bia: um círculo por pessoa com a inicial, os nomes unidos por ' e ' e o rótulo da marca", () => {
    render(<HouseholdFooter members={[{ name: "Ana" }, { name: "Bia" }]} />);

    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("Ana e Bia")).toBeInTheDocument();
    expect(screen.getByText("Conta do casal")).toBeInTheDocument();
  });

  it("com um membro: um círculo e um nome", () => {
    const { container } = render(<HouseholdFooter members={[{ name: "ana" }]} />);

    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("ana")).toBeInTheDocument();
    expect(container.querySelectorAll(".rounded-full")).toHaveLength(1);
  });

  it("a inicial é a primeira letra, mesmo depois de um número ou espaço", () => {
    render(<HouseholdFooter members={[{ name: "  Ísis" }]} />);

    expect(screen.getByText("Í")).toBeInTheDocument();
  });
});
