import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { FeaturesResponse } from "../../shared/setup";
import { apiFetch } from "../lib/api";

// Funções ligadas pela configuração (TASK-0102). O padrão é tudo desligado: é o que vale até a API responder.
export type Features = FeaturesResponse;

export const FEATURES_PADRAO: Features = { ia: false, assistente: false, voz: false };

const Contexto = createContext<Features>(FEATURES_PADRAO);

// Sem "valores", lê GET /api/features ao montar e mantém o último valor se a leitura falhar.
// Com "valores" (testes e telas de desenvolvimento), não lê nada.
export function FeaturesProvider({ valores, children }: { valores?: Features; children: ReactNode }) {
  const [lidas, setLidas] = useState<Features>(FEATURES_PADRAO);

  useEffect(() => {
    if (valores) return;
    let cancelado = false;
    apiFetch<Features>("/api/features").then(
      (funcoes) => {
        if (!cancelado) setLidas(funcoes);
      },
      () => {
        // Mantém o último valor: sem a leitura, as funções seguem escondidas.
      },
    );
    return () => {
      cancelado = true;
    };
  }, [valores]);

  return <Contexto.Provider value={valores ?? lidas}>{children}</Contexto.Provider>;
}

export function useFeatures(): Features {
  return useContext(Contexto);
}
