import "./styles/global.css";
import { registerSW } from "virtual:pwa-register";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { FeaturesProvider } from "./app/features";
import { ConfirmProvider } from "./components/ui/confirm-dialog";
import { HideValuesProvider } from "./components/ui/hide-values";
import { criarRotas, type TelasDoApp } from "./routes";
import { SessionProvider } from "./session/SessionProvider";

export type OpcoesDoApp = { telas?: TelasDoApp };

// Monta o app em #root. Os apps chamam com as telas que sobrescrevem as provisórias (pelo path da rota).
// Os provedores, o CSS e o registro do service worker ficam aqui (e não em main.tsx), porque os apps finos chamam só esta função.
export function montarApp({ telas = {} }: OpcoesDoApp = {}): void {
  const raiz = document.getElementById("root");
  if (!raiz) throw new Error("Elemento #root não encontrado no index.html.");

  registerSW({ immediate: true });
  const roteador = createBrowserRouter(criarRotas(telas));

  createRoot(raiz).render(
    <StrictMode>
      <HideValuesProvider>
        <ConfirmProvider>
          <FeaturesProvider>
            <SessionProvider>
              <RouterProvider router={roteador} />
            </SessionProvider>
          </FeaturesProvider>
        </ConfirmProvider>
      </HideValuesProvider>
    </StrictMode>,
  );
}
