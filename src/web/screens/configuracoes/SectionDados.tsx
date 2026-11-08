import { useState } from "react";
import { useNavigate } from "react-router";
import { Card } from "@/components/ui/card";
import { SettingsRow } from "../../components/settings/SettingsRow";
import { useSession } from "../../session/SessionProvider";

// Seção Dados (TASK-0107): Sair e a versão. Sair não apaga nada, então não pede confirmação.
export function SectionDados() {
  const { signOut } = useSession();
  const navegar = useNavigate();
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    if (saindo) return;
    setSaindo(true);
    // O signOut da sessão manda para /entrar (RequireSession); o navigate cobre a volta mesmo sem a API.
    await signOut().catch(() => undefined);
    navegar("/entrar", { replace: true });
  }

  return (
    <Card className="flex flex-col overflow-hidden p-0">
      {/* Encaixe: "Backup e restauração" (TASK-0108) e "Atualizar o app" (TASK-0112) entram aqui, acima de Sair. */}
      <SettingsRow titulo="Sair" subtitulo={`Versão ${__APP_VERSION__}`} aoAbrir={() => void sair()} />
    </Card>
  );
}
