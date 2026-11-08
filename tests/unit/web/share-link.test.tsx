import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DICA_DO_CONVITE,
  diaEMes,
  TITULO_DO_COMPARTILHAMENTO,
  textoDoCompartilhamento,
} from "@/access/convite-textos";
import { ShareLink } from "@/access/ShareLink";
import { brand } from "../../../src/shared/brand";

// Compartilhar o convite (TASK-0105): o texto, a data em America/Sao_Paulo, os botões de acordo com o aparelho e o QR.
const LINK = "http://matrimoney.test/convite/TOKEN-DE-TESTE-0105-000000000000000000";

function defineNavegador(propriedades: Record<string, unknown>) {
  for (const [nome, valor] of Object.entries(propriedades)) {
    Object.defineProperty(navigator, nome, { value: valor, configurable: true });
  }
}

function apagaNavegador(nomes: string[]) {
  for (const nome of nomes) Reflect.deleteProperty(navigator, nome);
}

afterEach(() => {
  cleanup();
  apagaNavegador(["share", "clipboard"]);
  vi.restoreAllMocks();
});

describe("texto e data do compartilhamento", () => {
  it("o texto diz quem convida e vale até o dia de São Paulo", () => {
    // 02:30 UTC do dia 15 ainda é dia 14 em São Paulo (UTC-3).
    expect(textoDoCompartilhamento("[TEST] Pessoa A", "2026-11-15T02:30:00.000Z")).toBe(
      `[TEST] Pessoa A convidou você para o ${brand.name}. Abra o link para entrar (vale até 14/11):`,
    );
  });

  it("o título é o do convite com o nome da marca", () => {
    expect(TITULO_DO_COMPARTILHAMENTO).toBe(`Convite para o ${brand.name}`);
  });

  it("a data do vencimento usa o dia de São Paulo, não o do UTC", () => {
    expect(diaEMes("2026-11-15T02:59:59.000Z")).toBe("14/11");
    expect(diaEMes("2026-11-15T03:00:00.000Z")).toBe("15/11");
  });
});

describe("ShareLink", () => {
  const texto = "Pessoa A convidou você. Abra o link (vale até 14/11):";

  it("sem navigator.share, não mostra o botão Compartilhar", () => {
    apagaNavegador(["share"]);
    render(<ShareLink link={LINK} shareTitle="Convite" shareText={texto} dica={DICA_DO_CONVITE} />);
    expect(screen.getByRole("button", { name: "Copiar link" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mostrar QR code" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Compartilhar" })).toBeNull();
  });

  it("com navigator.share, mostra Compartilhar e entrega título, texto e link à folha do sistema", async () => {
    const share = vi.fn(async () => undefined);
    defineNavegador({ share });
    render(
      <ShareLink link={LINK} shareTitle="Convite para o app" shareText={texto} dica={DICA_DO_CONVITE} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith({ title: "Convite para o app", text: texto, url: LINK });
  });

  it("cancelar a folha do sistema não mostra erro", async () => {
    defineNavegador({
      share: vi.fn(async () => Promise.reject(new DOMException("cancelado", "AbortError"))),
    });
    render(<ShareLink link={LINK} shareTitle="Convite" shareText={texto} dica={DICA_DO_CONVITE} />);
    fireEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
    await Promise.resolve();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Copiar link põe o link na área de transferência e avisa", async () => {
    const writeText = vi.fn(async () => undefined);
    defineNavegador({ clipboard: { writeText } });
    render(<ShareLink link={LINK} shareTitle="Convite" shareText={texto} dica={DICA_DO_CONVITE} />);

    fireEvent.click(screen.getByRole("button", { name: "Copiar link" }));
    await vi.waitFor(() => expect(screen.getByText("Link copiado.")).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(LINK);
  });

  it("se a cópia falhar, mostra o link num campo para selecionar", async () => {
    defineNavegador({ clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("negado"))) } });
    render(<ShareLink link={LINK} shareTitle="Convite" shareText={texto} dica={DICA_DO_CONVITE} />);

    fireEvent.click(screen.getByRole("button", { name: "Copiar link" }));
    await vi.waitFor(() => expect(screen.getByRole("textbox", { name: "Link do convite" })).toBeTruthy());
    expect((screen.getByRole("textbox", { name: "Link do convite" }) as HTMLInputElement).value).toBe(LINK);
  });

  it("Mostrar QR code desenha o QR do link em SVG, e Ocultar o tira da tela", () => {
    render(<ShareLink link={LINK} shareTitle="Convite" shareText={texto} dica={DICA_DO_CONVITE} />);
    expect(screen.queryByRole("img", { name: "QR code do link do convite" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Mostrar QR code" }));
    const qr = screen.getByRole("img", { name: "QR code do link do convite" });
    expect(qr.tagName.toLowerCase()).toBe("svg");
    expect(qr.querySelector("path")?.getAttribute("d")).toMatch(/^M\d+ \d+h1v1h-1z/);

    fireEvent.click(screen.getByRole("button", { name: "Ocultar QR code" }));
    expect(screen.queryByRole("img", { name: "QR code do link do convite" })).toBeNull();
  });

  it("sempre traz o aviso de canal de confiança", () => {
    render(<ShareLink link={LINK} shareTitle="Convite" shareText={texto} dica={DICA_DO_CONVITE} />);
    expect(screen.getByText(/quem abrir o link primeiro entra como cônjuge/)).toBeTruthy();
  });
});
