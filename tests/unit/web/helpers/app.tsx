import { render } from "@testing-library/react";
import { createMemoryRouter, type InitialEntry, RouterProvider } from "react-router";
import { FeaturesProvider } from "@/app/features";
import { HideValuesProvider } from "@/components/ui/hide-values";
import { criarRotas } from "@/routes";
import { SessionProvider } from "@/session/SessionProvider";
import type { SessionResponse } from "../../../../src/shared/session";

// Sessão de teste: a pessoa do lar e a outra pessoa (nomes [TEST], e-mail de exemplo).
export const SESSAO_DE_TESTE: SessionResponse = {
  member: { id: "[TEST]-membro-a", name: "[TEST] Pessoa A", email: "pessoa.a@example.com", role: "titular" },
  household: { id: "[TEST]-lar", brand: "matrimoney" },
  members: [
    { id: "[TEST]-membro-a", name: "[TEST] Pessoa A", role: "titular" },
    { id: "[TEST]-membro-b", name: "[TEST] Pessoa B", role: "conjuge" },
  ],
  notices: [],
};

// Renderiza o app inteiro (roteador e moldura) numa rota, com a largura e os recursos pedidos.
// A sessão vem pelo SessionProvider com valores: nenhuma chamada à API nos testes.
export function renderizarApp({ rota, assistente = true }: { rota: InitialEntry; assistente?: boolean }) {
  const roteador = createMemoryRouter(criarRotas(), { initialEntries: [rota] });
  const resultado = render(
    <FeaturesProvider valores={{ ia: false, assistente, voz: false }}>
      <HideValuesProvider>
        <SessionProvider valores={SESSAO_DE_TESTE}>
          <RouterProvider router={roteador} />
        </SessionProvider>
      </HideValuesProvider>
    </FeaturesProvider>,
  );
  return { ...resultado, roteador };
}
