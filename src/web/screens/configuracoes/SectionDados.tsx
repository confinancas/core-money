import { useState } from "react";
import { useNavigate } from "react-router";
import { Card } from "@/components/ui/card";
import { SettingsRow } from "../../components/settings/SettingsRow";
import { useSession } from "../../session/SessionProvider";

// Seção Dados (TASK-0107): Sair e a versão. Sair não apaga nada, então não pede confirmação.
// Sem resposta do servidor, a pessoa fica nesta tela com o aviso: a sessão continua aberta e a linha volta a aceitar o toque.
export function SectionDados() {
  const { signOut } = useSession();
  const navegar = useNavigate();
  const [saindo, setSaindo] = useState(false);
  const [falhou, setFalhou] = useState(false);

  async function sair() {
    if (saindo) return;
    setSaindo(true);
    setFalhou(false);
    try {
      await signOut();
    } catch {
      setFalhou(true);
      setSaindo(false);
      return;
    }
    // O signOut manda para /entrar (RequireSession); o navigate deixa a volta explícita.
    navegar("/entrar", { replace: true });
  }

  return (
    <Card className="flex flex-col overflow-hidden p-0">
      {/* Encaixe: "Backup e restauração" (TASK-0108) e "Atualizar o app" (TASK-0112) entram aqui, acima de Sair. */}
      <SettingsRow titulo="Sair" subtitulo={`Versão ${__APP_VERSION__}`} aoAbrir={() => void sair()} />
      {falhou && (
        <p role="alert" className="px-4 pb-4 text-[13px] text-danger">
          Não deu para sair agora. Tente de novo.
        </p>
      )}
    </Card>
  );
}
