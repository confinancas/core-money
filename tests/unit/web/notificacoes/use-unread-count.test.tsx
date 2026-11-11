import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rotuloDoSino, useUnreadCount } from "@/screens/notificacoes/useUnreadCount";

// Contador do sino (TASK-0701): o rótulo no singular e no plural, e a releitura quando a janela volta ao foco.
function Sino() {
  const { count } = useUnreadCount();
  return <p>{`contador ${count}`}</p>;
}

describe("rotuloDoSino", () => {
  it("sem nada novo: só Notificações", () => {
    expect(rotuloDoSino(0)).toBe("Notificações");
  });

  it("uma: singular", () => {
    expect(rotuloDoSino(1)).toBe("Notificações, 1 nova");
  });

  it("mais de uma: plural", () => {
    expect(rotuloDoSino(4)).toBe("Notificações, 4 novas");
    expect(rotuloDoSino(12)).toBe("Notificações, 12 novas");
  });
});

describe("useUnreadCount", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lê o contador ao montar e de novo quando a janela ganha o foco", async () => {
    const fetchSimulado = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ count: 4 }))
      .mockResolvedValueOnce(Response.json({ count: 2 }));
    vi.stubGlobal("fetch", fetchSimulado);

    render(<Sino />);
    expect(await screen.findByText("contador 4")).toBeInTheDocument();
    expect(fetchSimulado).toHaveBeenCalledTimes(1);
    expect(fetchSimulado.mock.calls[0]?.[0]).toBe("/api/notifications/unread-count");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(screen.getByText("contador 2")).toBeInTheDocument());
    expect(fetchSimulado).toHaveBeenCalledTimes(2);
  });

  it("uma falha de rede mantém o último número, sem erro na tela", async () => {
    const fetchSimulado = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ count: 3 }))
      .mockRejectedValueOnce(new TypeError("sem rede"));
    vi.stubGlobal("fetch", fetchSimulado);

    render(<Sino />);
    expect(await screen.findByText("contador 3")).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(fetchSimulado).toHaveBeenCalledTimes(2));
    expect(screen.getByText("contador 3")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("relê quando a aba volta a ficar visível, não relê quando ela fica oculta, e tira os ouvintes ao desmontar", async () => {
    const fetchSimulado = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ count: 4 }))
      .mockResolvedValueOnce(Response.json({ count: 2 }));
    vi.stubGlobal("fetch", fetchSimulado);
    let visibilidade: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibilidade });

    try {
      const { unmount } = render(<Sino />);
      expect(await screen.findByText("contador 4")).toBeInTheDocument();

      visibilidade = "hidden";
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(fetchSimulado).toHaveBeenCalledTimes(1);

      visibilidade = "visible";
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await waitFor(() => expect(screen.getByText("contador 2")).toBeInTheDocument());
      expect(fetchSimulado).toHaveBeenCalledTimes(2);

      unmount();
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(fetchSimulado).toHaveBeenCalledTimes(2);
    } finally {
      Reflect.deleteProperty(document, "visibilityState");
    }
  });
});
