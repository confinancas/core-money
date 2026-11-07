import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TopIconButton } from "@/components/ui/top-icon-button";

afterEach(cleanup);

const icone = <svg aria-hidden="true" />;

describe("TopIconButton", () => {
  it("com badge 0, não mostra número", () => {
    const { container } = render(<TopIconButton label="Avisos" icon={icone} badge={0} />);

    expect(container.querySelector(".bg-badge")).toBeNull();
  });

  it("com badge 3, mostra o número", () => {
    render(<TopIconButton label="Avisos" icon={icone} badge={3} />);

    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("com badge 9, mostra 9 e não 9+", () => {
    render(<TopIconButton label="Avisos" icon={icone} badge={9} />);

    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.queryByText("9+")).toBeNull();
  });

  it("com badge 10, mostra 9+", () => {
    render(<TopIconButton label="Avisos" icon={icone} badge={10} />);

    expect(screen.getByText("9+")).toBeInTheDocument();
    expect(screen.queryByText("10")).toBeNull();
  });

  it("com badge 12, mostra 9+", () => {
    render(<TopIconButton label="Avisos" icon={icone} badge={12} />);

    expect(screen.getByText("9+")).toBeInTheDocument();
    expect(screen.queryByText("12")).toBeNull();
  });

  it("com to, vira um link com o rótulo", () => {
    render(<TopIconButton label="Voltar" icon={icone} to="#inicio" />);

    expect(screen.getByRole("link", { name: "Voltar" })).toHaveAttribute("href", "#inicio");
  });
});
