import { Card } from "@/components/ui/card";
import { SettingsRow } from "../../components/settings/SettingsRow";

// Seção Sincronização (TASK-0107): só leitura. O horário é fixo, às 00:00 de São Paulo (decisão de 2026-11-03).
export function SectionSincronizacao() {
  return (
    <Card className="flex flex-col overflow-hidden p-0">
      {/* Encaixe: o subtítulo vira "Última: …" pela TASK-0205, sem mudar esta linha. */}
      <SettingsRow titulo="Atualização diária" subtitulo="Toda noite, automaticamente" valor="00:00" />
    </Card>
  );
}
