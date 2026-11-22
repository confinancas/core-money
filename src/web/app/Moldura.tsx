import { useEffect } from "react";
import { Navigate, Outlet, ScrollRestoration, useLocation } from "react-router";
import { brand } from "../../shared/brand";
import { encerrarVisitaForaDaFila } from "../screens/para-categorizar/visita";
import { useFeatures } from "./features";
import { AppFrame } from "./frame/AppFrame";
import { useRotaAtual } from "./rota-atual";

// Layout de todas as rotas: escolhe a moldura pela meta da rota, põe o título no documento e leva ao início
// as rotas que exigem o assistente quando ele está desligado.
export function Moldura() {
  const { meta, aba } = useRotaAtual();
  const { assistente } = useFeatures();
  const { pathname } = useLocation();

  // A visita da fila Para categorizar acaba quando o caminho deixa de ser o da fila. A moldura não desmonta na
  // navegação, então a ordem dos efeitos da tela da fila não importa (TASK-0304).
  useEffect(() => {
    encerrarVisitaForaDaFila(pathname);
  }, [pathname]);

  useEffect(() => {
    if (meta) document.title = `${meta.title} · ${brand.name}`;
  }, [meta]);

  if (meta?.requer === "assistente" && !assistente) {
    return <Navigate to="/inicio" replace />;
  }

  return (
    <>
      <AppFrame frame={meta?.frame ?? "bare"} aba={aba}>
        <Outlet />
      </AppFrame>
      <ScrollRestoration />
    </>
  );
}
