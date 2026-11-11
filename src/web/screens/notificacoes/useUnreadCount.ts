import { useCallback, useEffect, useState } from "react";
import type { ContagemDeNaoLidas } from "../../../shared/notifications/api";
import { apiFetch } from "../../lib/api";

// Contador do sino (TASK-0701): lê GET /api/notifications/unread-count ao montar e quando a aba volta ao foco.
// Falha de rede mantém o último número; o sino não mostra erro.
export function useUnreadCount(): { count: number; recarregar: () => void } {
  const [count, setCount] = useState(0);

  const recarregar = useCallback(async () => {
    try {
      const resposta = await apiFetch<ContagemDeNaoLidas>("/api/notifications/unread-count");
      setCount(resposta.count);
    } catch {
      // Mantém o número anterior.
    }
  }, []);

  useEffect(() => {
    void recarregar();
    const aoFocar = () => void recarregar();
    const aoMudarVisibilidade = () => {
      if (document.visibilityState === "visible") void recarregar();
    };
    window.addEventListener("focus", aoFocar);
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => {
      window.removeEventListener("focus", aoFocar);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, [recarregar]);

  return { count, recarregar: () => void recarregar() };
}

// Rótulo do TopIconButton do sino: singular e plural, e só "Notificações" sem nada novo.
export function rotuloDoSino(contagem: number): string {
  if (contagem <= 0) return "Notificações";
  return contagem === 1 ? "Notificações, 1 nova" : `Notificações, ${contagem} novas`;
}
