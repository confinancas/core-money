import { type ReactNode, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { NewDeviceNotice } from "../../components/NewDeviceNotice";
import { LimitReached } from "../../usage/LimitReached";
import { lerLimiteAtingido, limpaLimiteAtingido, ouvirLimiteAtingido } from "../../usage/limite-store";
import { UsageBanner } from "../../usage/UsageBanner";
import { UsoProvider } from "../../usage/useUsage";
import { useFeatures } from "../features";
import { useBreakpoint } from "../useBreakpoint";
import type { Aba, Frame } from "./aba";
import { BottomNav } from "./BottomNav";
import { useFrameMembers } from "./frame-data";
import { Sidebar } from "./Sidebar";
import { SideRail } from "./SideRail";

// Moldura de cada rota: sem menu (bare), menu inferior no celular e barra lateral no tablet e no desktop.
// Só um menu aparece por vez. A tela cheia (full) não tem menu no celular.
export function AppFrame({ frame, aba, children }: { frame: Frame; aba: Aba | null; children: ReactNode }) {
  const largura = useBreakpoint();
  const { assistente } = useFeatures();
  const membros = useFrameMembers();
  // Limite do plano gratuito atingido (TASK-0109): o conteúdo sai e a tela LimitReached entra no lugar, na moldura.
  const limite = useSyncExternalStore(ouvirLimiteAtingido, lerLimiteAtingido);

  if (frame === "bare") return <>{children}</>;

  const conteudo = limite ? <LimitReached motivo={limite} aoTentarDeNovo={limpaLimiteAtingido} /> : children;

  // Os avisos (TASK-0106 e TASK-0109) ficam no topo do conteúdo, nas três molduras com conteúdo do app.
  const moldura =
    largura === "celular" ? (
      <CelularComMenu comMenu={frame !== "full"} aba={aba} assistente={assistente}>
        <NewDeviceNotice />
        <UsageBanner />
        {conteudo}
      </CelularComMenu>
    ) : (
      <div className="flex min-h-dvh">
        {largura === "tablet" ? (
          <SideRail aba={aba} assistente={assistente} />
        ) : (
          <Sidebar aba={aba} assistente={assistente} membros={membros} />
        )}
        <main className="min-w-0 flex-1">
          <NewDeviceNotice />
          <UsageBanner />
          {conteudo}
        </main>
      </div>
    );

  // O uso é lido uma vez por moldura (e de novo ao voltar à tela): a faixa e a seção Plano da Cloudflare leem daqui.
  return <UsoProvider>{moldura}</UsoProvider>;
}

function CelularComMenu({
  comMenu,
  aba,
  assistente,
  children,
}: {
  comMenu: boolean;
  aba: Aba | null;
  assistente: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <main className={cn("min-h-dvh", comMenu && "pb-32")}>{children}</main>
      {comMenu && <BottomNav aba={aba} assistente={assistente} />}
    </div>
  );
}
