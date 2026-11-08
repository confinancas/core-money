import { type ReactNode, useEffect } from "react";
import { Navigate } from "react-router";
import { ErrorState } from "@/components/ui/error-state";
import { useControleDaSessao } from "./SessionProvider";

// Envolve as rotas da moldura (tab, detail e full). Sem sessão, vai para /entrar; enquanto a sessão chega, espera.
export function RequireSession({ children }: { children: ReactNode }) {
  const { estado, garantir, esquecer } = useControleDaSessao();

  // Lê quando o estado é "desconhecido": o "tentar de novo" e o depois de entrar voltam a esse estado.
  useEffect(() => {
    if (estado === "desconhecido") garantir();
  }, [estado, garantir]);

  if (estado === "saiu") return <Navigate to="/entrar" replace />;

  if (estado === "falha") {
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
