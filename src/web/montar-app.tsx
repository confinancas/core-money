import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

// Monta o app em #root. Os apps chamam sem argumento.
export function montarApp(): void {
  const raiz = document.getElementById("root");
  if (!raiz) throw new Error("Elemento #root não encontrado no index.html.");
  createRoot(raiz).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
