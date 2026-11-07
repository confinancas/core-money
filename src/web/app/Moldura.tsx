import { useEffect } from "react";
import { Navigate, Outlet, ScrollRestoration } from "react-router";
import { brand } from "../../shared/brand";
import { useFeatures } from "./features";
import { AppFrame } from "./frame/AppFrame";
import { useRotaAtual } from "./rota-atual";

// Layout de todas as rotas: escolhe a moldura pela meta da rota, põe o título no documento e leva ao início
// as rotas que exigem o assistente quando ele está desligado.
export function Moldura() {
  const { meta, aba } = useRotaAtual();
  const { assistente } = useFeatures();

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
