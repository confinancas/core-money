import { createContext, type ReactNode, useContext } from "react";

// Funções ligadas pela configuração (configuração e chaves). O padrão é tudo ligado até a TASK-0102 ler a configuração.
export type Features = { assistente: boolean };

export const FEATURES_PADRAO: Features = { assistente: true };

const Contexto = createContext<Features>(FEATURES_PADRAO);

export function FeaturesProvider({
  valores = FEATURES_PADRAO,
  children,
}: {
  valores?: Features;
  children: ReactNode;
}) {
  return <Contexto.Provider value={valores}>{children}</Contexto.Provider>;
}

export function useFeatures(): Features {
  return useContext(Contexto);
}
