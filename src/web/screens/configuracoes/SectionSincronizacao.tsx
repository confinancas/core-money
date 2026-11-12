import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import type { SyncStatusResponse } from "../../../shared/sync-api";
import { textoDaUltimaAtualizacao } from "../../../shared/sync-text";
import { lerEstadoDaImportacao } from "../../api/sync";
import { SettingsRow } from "../../components/settings/SettingsRow";

// Seção Sincronização (TASK-0107, subtítulo da TASK-0205): o horário é fixo, às 00:00 de São Paulo (decisão de
// 2026-11-03). O subtítulo mostra a última atualização com sucesso; sem resposta ainda, o texto de sempre.
export function SectionSincronizacao() {
  const [estado, setEstado] = useState<SyncStatusResponse | null>(null);

  useEffect(() => {
    let vivo = true;
    lerEstadoDaImportacao()
      .then((resposta) => {
        if (vivo) setEstado(resposta);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);

  const subtitulo =
    estado === null
      ? "Toda noite, automaticamente"
      : textoDaUltimaAtualizacao(estado.lastSync?.at ?? null, new Date());

  return (
    <Card className="flex flex-col overflow-hidden p-0">
      <SettingsRow titulo="Atualização diária" subtitulo={subtitulo} valor="00:00" />
    </Card>
  );
}
