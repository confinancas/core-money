import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { TopIconButton } from "@/components/ui/top-icon-button";

afterEach(cleanup);

const icone = <svg aria-hidden="true" />;

// Mostra a rota e o state atuais, para o teste ver a navegação sem recarregar a página.
function Localizacao() {
  const localizacao = useLocation();
  return (
    <p>
      <span data-testid="rota">{localizacao.pathname}</span>
      <span data-testid="estado">{JSON.stringify(localizacao.state)}</span>
    </p>
  );
}

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

  it("sem to, continua um botão", () => {
    render(<TopIconButton label="Avisos" icon={icone} />);

    expect(screen.getByRole("button", { name: "Avisos" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("com to, vira um link com o rótulo apontando para o destino", () => {
    render(
      <MemoryRouter initialEntries={["/compras/abc"]}>
        <TopIconButton label="Voltar" icon={icone} to="/cartoes" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Voltar" })).toHaveAttribute("href", "/cartoes");
  });

  it("com to, o clique é tratado pelo roteador (não recarrega a página) e muda a rota", async () => {
    const usuario = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/compras/abc"]}>
        <TopIconButton label="Voltar" icon={icone} to="/cartoes" />
        <Localizacao />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Voltar" });

    // O Link do react-router chama preventDefault: o clique não vira navegação completa do navegador.
    expect(fireEvent.click(link)).toBe(false);
    expect(screen.getByTestId("rota")).toHaveTextContent("/cartoes");

    await usuario.click(link);
    expect(screen.getByTestId("rota")).toHaveTextContent("/cartoes");
  });

  it("com to e state, o state vai junto com a navegação", async () => {
    const usuario = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/categorias/escolher"]}>
        <TopIconButton label="Fechar" icon={icone} to="/inicio" state={{ fromTab: "inicio" }} />
        <Localizacao />
      </MemoryRouter>,
    );

    await usuario.click(screen.getByRole("link", { name: "Fechar" }));

    expect(screen.getByTestId("rota")).toHaveTextContent("/inicio");
    expect(screen.getByTestId("estado")).toHaveTextContent('{"fromTab":"inicio"}');
  });
});
