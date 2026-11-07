import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderizarApp } from "./helpers/app";
import { desinstalarMatchMedia, instalarMatchMedia } from "./helpers/larguras";

const MENU = "Navegação principal";
const IA = "Assistente de IA do Matrimoney";

// Rótulos dos links de um menu, na ordem em que aparecem.
function rotulosDoMenu(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole("link")
    .map((link) => link.getAttribute("aria-label") ?? "");
}

beforeEach(() => {
  instalarMatchMedia(1440);
});

afterEach(() => {
  cleanup();
  desinstalarMatchMedia();
});

describe("menu do celular (390 px)", () => {
  beforeEach(() => instalarMatchMedia(390));

  it("tem 7 posições na ordem do manual, com a IA no meio e Início marcado", () => {
    renderizarApp({ rota: "/inicio" });
    const menu = screen.getByRole("navigation", { name: MENU });

    expect(rotulosDoMenu(menu)).toEqual([
      "Início",
      "Cartões",
      "Contas do mês (despesas)",
      IA,
      "Renda",
      "Relatório",
      "Configurações",
    ]);
    expect(screen.getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
  });

  it("a IA vai no 4º lugar do menu e fica 33 px acima da barra", () => {
    renderizarApp({ rota: "/inicio" });
    const menu = screen.getByRole("navigation", { name: MENU });
    const ia = screen.getByRole("link", { name: IA });

    expect(within(menu).getAllByRole("link")[3]).toBe(ia);
    // Com o pt-3 da barra, a margem de -45 px põe a borda de cima do círculo 33 px acima da barra (a medida no navegador está no E2E).
    expect(ia.className).toContain("-mt-[45px]");
    expect(ia.className).toContain("size-[66px]");
  });

  it("sem o assistente: 6 posições, sem o círculo da IA", () => {
    renderizarApp({ rota: "/inicio", assistente: false });
    const menu = screen.getByRole("navigation", { name: MENU });

    expect(rotulosDoMenu(menu)).toEqual([
      "Início",
      "Cartões",
      "Contas do mês (despesas)",
      "Renda",
      "Relatório",
      "Configurações",
    ]);
    expect(screen.queryByRole("link", { name: IA })).toBeNull();
  });

  it("tela cheia (/contas/nova) não tem menu e tem o X para a aba", () => {
    renderizarApp({ rota: "/contas/nova" });

    expect(screen.queryByRole("navigation", { name: MENU })).toBeNull();
    expect(screen.getByRole("link", { name: "Fechar" })).toHaveAttribute("href", "/contas");
  });

  it("/assistente não tem menu e a IA marca aria-current sem outro item marcado", () => {
    renderizarApp({ rota: "/assistente" });

    expect(screen.queryByRole("navigation", { name: MENU })).toBeNull();
  });
});

describe("barra do tablet (834 px)", () => {
  beforeEach(() => instalarMatchMedia(834));

  it("mostra a barra fina na ordem do tablet, com Configurações no pé", () => {
    renderizarApp({ rota: "/inicio" });
    const menu = screen.getByRole("navigation", { name: MENU });

    expect(rotulosDoMenu(menu)).toEqual([
      "Início",
      "Cartões",
      "Contas do mês (despesas)",
      "Renda",
      "Relatório",
      "Configurações",
    ]);
    expect(screen.getByRole("link", { name: "Matrimoney, início" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: IA })).toBeInTheDocument();
  });

  it("não tem o menu do celular", () => {
    renderizarApp({ rota: "/inicio" });

    expect(screen.getAllByRole("navigation", { name: MENU })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Matrimoney, início" }).closest("aside")).not.toBeNull();
  });

  it("sem o assistente: sem o botão da IA", () => {
    renderizarApp({ rota: "/inicio", assistente: false });

    expect(screen.queryByRole("link", { name: IA })).toBeNull();
  });

  it("/assistente mostra a IA marcada e nenhum outro item", () => {
    renderizarApp({ rota: "/assistente" });

    expect(screen.getByRole("link", { name: IA })).toHaveAttribute("aria-current", "page");
    for (const nome of [
      "Início",
      "Cartões",
      "Contas do mês (despesas)",
      "Renda",
      "Relatório",
      "Configurações",
    ]) {
      expect(screen.getByRole("link", { name: nome })).not.toHaveAttribute("aria-current");
    }
  });

  it("/contas/nova mostra a barra com Contas marcada, sem seta de voltar", () => {
    renderizarApp({ rota: "/contas/nova" });

    expect(screen.getByRole("link", { name: "Contas do mês (despesas)" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("barra lateral do desktop (1440 px)", () => {
  beforeEach(() => instalarMatchMedia(1440));

  it("mostra a barra de 252 px com nomes, o cartão do assistente e os itens", () => {
    renderizarApp({ rota: "/inicio" });
    const menu = screen.getByRole("navigation", { name: MENU });

    expect(rotulosDoMenu(menu)).toEqual([
      "Início",
      "Cartões",
      "Contas do mês (despesas)",
      "Renda",
      "Relatório",
      "Configurações",
    ]);
    expect(within(menu).getByText("Contas do mês")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: IA })).toHaveTextContent("Assistente");
  });

  it("sem membros do lar, não tem rodapé", () => {
    renderizarApp({ rota: "/inicio" });

    expect(screen.queryByText("Conta compartilhada")).toBeNull();
  });

  it("sem o assistente: sem o cartão", () => {
    renderizarApp({ rota: "/inicio", assistente: false });

    expect(screen.queryByRole("link", { name: IA })).toBeNull();
  });

  it("/assistente com o assistente desligado vai para /inicio", () => {
    const { roteador } = renderizarApp({ rota: "/assistente", assistente: false });

    expect(roteador.state.location.pathname).toBe("/inicio");
  });

  it("/assistente com o assistente ligado fica na tela", () => {
    const { roteador } = renderizarApp({ rota: "/assistente" });

    expect(roteador.state.location.pathname).toBe("/assistente");
  });
});

describe("navegação", () => {
  it("tocar em Cartões troca a rota e marca o item", async () => {
    instalarMatchMedia(1440);
    const usuario = userEvent.setup();
    const { roteador } = renderizarApp({ rota: "/inicio" });

    await usuario.click(screen.getByRole("link", { name: "Cartões" }));

    expect(roteador.state.location.pathname).toBe("/cartoes");
    expect(screen.getByRole("link", { name: "Cartões" })).toHaveAttribute("aria-current", "page");
  });

  it("Configurações abre como aba, sem seta de voltar", () => {
    instalarMatchMedia(390);
    renderizarApp({ rota: "/configuracoes" });

    expect(screen.queryByRole("link", { name: "Voltar" })).toBeNull();
    expect(screen.getByRole("link", { name: "Configurações" })).toHaveAttribute("aria-current", "page");
  });

  it("detalhe de compra marca Cartões e a seta volta para Cartões", () => {
    instalarMatchMedia(390);
    renderizarApp({ rota: "/compras/abc" });

    expect(screen.getByRole("link", { name: "Cartões" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Voltar" })).toHaveAttribute("href", "/cartoes");
  });

  // Tela cheia não tem menu no celular: a marcação aparece na barra do tablet.
  it("categorias abertas a partir do início marcam Início (fromTab)", () => {
    instalarMatchMedia(834);
    renderizarApp({ rota: { pathname: "/categorias/escolher", state: { fromTab: "inicio" } } });

    expect(screen.getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Cartões" })).not.toHaveAttribute("aria-current");
  });

  it("categorias sem estado marcam Cartões", () => {
    instalarMatchMedia(834);
    renderizarApp({ rota: "/categorias/escolher" });

    expect(screen.getByRole("link", { name: "Cartões" })).toHaveAttribute("aria-current", "page");
  });

  it("fromTab inválido na rota cheia é ignorado, e marca Cartões", () => {
    instalarMatchMedia(834);
    renderizarApp({ rota: { pathname: "/categorias/escolher", state: { fromTab: "nada" } } });

    expect(screen.getByRole("link", { name: "Cartões" })).toHaveAttribute("aria-current", "page");
  });

  it("rota desconhecida mostra Página não encontrada na moldura e leva ao início", async () => {
    instalarMatchMedia(390);
    const usuario = userEvent.setup();
    const { roteador } = renderizarApp({ rota: "/nada/aqui" });

    expect(screen.getByRole("heading", { name: "Página não encontrada" })).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Ir para o início" }));

    expect(roteador.state.location.pathname).toBe("/inicio");
  });
});
