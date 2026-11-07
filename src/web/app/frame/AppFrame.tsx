import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
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

  if (frame === "bare") return <>{children}</>;

  if (largura === "celular") {
    const comMenu = frame !== "full";
    return (
      <div className="min-h-dvh">
        <main className={cn("min-h-dvh", comMenu && "pb-32")}>{children}</main>
        {comMenu && <BottomNav aba={aba} assistente={assistente} />}
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh">
      {largura === "tablet" ? (
        <SideRail aba={aba} assistente={assistente} />
      ) : (
        <Sidebar aba={aba} assistente={assistente} membros={membros} />
      )}
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
