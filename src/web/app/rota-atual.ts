import { useLocation, useMatches } from "react-router";
import { type Aba, type RotaMeta, resolveActiveTab } from "./frame/aba";

function isRotaMeta(valor: unknown): valor is RotaMeta {
  return typeof valor === "object" && valor !== null && "frame" in valor && "title" in valor;
}

// Meta da rota mostrada (o handle da folha) e a aba que o menu deve marcar.
export function useRotaAtual(): { meta: RotaMeta | null; aba: Aba | null } {
  const correspondencias = useMatches();
  const localizacao = useLocation();
  const folha = correspondencias[correspondencias.length - 1];
  const meta = isRotaMeta(folha?.handle) ? folha.handle : null;

  return { meta, aba: meta ? resolveActiveTab(meta, localizacao.state) : null };
}
