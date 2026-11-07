import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { IconeOlho, IconeOlhoRiscado } from "@/components/icons";
import { TopIconButton } from "./top-icon-button";

// Escolha guardada no aparelho. Sem armazenamento (privado, bloqueado), vale só nesta carga e o padrão é mostrar.
const CHAVE = "mm:ocultar-valores";

function lerEscolha(): boolean {
  try {
    return window.localStorage.getItem(CHAVE) === "1";
  } catch {
    return false;
  }
}

function gravarEscolha(oculto: boolean): void {
  try {
    window.localStorage.setItem(CHAVE, oculto ? "1" : "0");
  } catch {
    // Sem armazenamento: a escolha segue valendo até recarregar.
  }
}

type ValoresOcultos = { oculto: boolean; alternar: () => void };

const Contexto = createContext<ValoresOcultos | null>(null);

// Põe a classe mm-oculto no <html>: o CSS borra todo [data-v], inclusive em diálogos em portal.
export function HideValuesProvider({ children }: { children: ReactNode }) {
  const [oculto, setOculto] = useState<boolean>(lerEscolha);

  useEffect(() => {
    document.documentElement.classList.toggle("mm-oculto", oculto);
    gravarEscolha(oculto);
    return () => document.documentElement.classList.remove("mm-oculto");
  }, [oculto]);

  const valor = useMemo<ValoresOcultos>(
    () => ({ oculto, alternar: () => setOculto((atual) => !atual) }),
    [oculto],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useHideValues(): ValoresOcultos {
  const valor = useContext(Contexto);
  if (!valor) throw new Error("useHideValues precisa de HideValuesProvider.");
  return valor;
}

// Botão do olho: com valores ocultos mostra o olho riscado e o rótulo "Mostrar valores".
export function EyeToggle() {
  const { oculto, alternar } = useHideValues();

  return (
    <TopIconButton
      label={oculto ? "Mostrar valores" : "Ocultar valores"}
      icon={oculto ? <IconeOlhoRiscado /> : <IconeOlho />}
      pressed={oculto}
      onClick={alternar}
    />
  );
}
