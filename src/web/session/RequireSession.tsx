import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import { Navigate } from "react-router";
import { ErrorState } from "@/components/ui/error-state";
import { LimitReached } from "../usage/LimitReached";
import { lerLimiteAtingido, ouvirLimiteAtingido } from "../usage/limite-store";
import { useControleDaSessao } from "./SessionProvider";

// Envolve as rotas da moldura (tab, detail e full). Sem sessão, vai para /entrar; enquanto a sessão chega, espera.
export function RequireSession({ children }: { children: ReactNode }) {
  const { estado, garantir, esquecer } = useControleDaSessao();
  // Com o limite do plano gratuito, a falha da sessão mostra a explicação, e não o erro genérico (TASK-0109, rodada 1).
  const limite = useSyncExternalStore(ouvirLimiteAtingido, lerLimiteAtingido);

  // Lê quando o estado é "desconhecido": o "tentar de novo" e o depois de entrar voltam a esse estado.
  useEffect(() => {
    if (estado === "desconhecido") garantir();
  }, [estado, garantir]);

  if (estado === "saiu") return <Navigate to="/entrar" replace />;

  if (estado === "falha") {
    if (limite) return <LimitReached motivo={limite} />;
    return (
      <div className="mx-auto w-full max-w-[520px] px-4 py-10">
        <ErrorState
          onRetry={() => {
            esquecer();
          }}
        />
      </div>
    );
  }

  if (estado !== "entrou") {
    return (
      <div className="mx-auto w-full max-w-[520px] px-4 py-10">
        <div aria-hidden="true" className="mm-esqueleto h-40 rounded-card" />
      </div>
    );
  }

  return <>{children}</>;
}
