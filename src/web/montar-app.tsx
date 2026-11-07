import "./styles/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ConfirmProvider } from "./components/ui/confirm-dialog";
import { HideValuesProvider } from "./components/ui/hide-values";
import { Catalogo } from "./dev/Catalog";

// Monta o app em #root. Os apps chamam sem argumento.
// Os provedores e o CSS ficam aqui (e não em main.tsx) porque os apps finos chamam só esta função.
// O catálogo entra só fora da produção: __DEV_ROUTES__ vira false no build de produção.
export function montarApp(): void {
  const raiz = document.getElementById("root");
  if (!raiz) throw new Error("Elemento #root não encontrado no index.html.");

  const tela = __DEV_ROUTES__ && window.location.pathname === "/dev/catalogo" ? <Catalogo /> : <App />;

  createRoot(raiz).render(
    <StrictMode>
      <HideValuesProvider>
        <ConfirmProvider>{tela}</ConfirmProvider>
      </HideValuesProvider>
    </StrictMode>,
  );
}
