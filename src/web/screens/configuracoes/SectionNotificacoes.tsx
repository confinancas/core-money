import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { HouseholdResponse } from "../../../shared/household";
import type { PreferenciasDeNotificacao } from "../../../shared/notifications/api";
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_KINDS,
  type NotificationKind,
  subtituloDoTipo,
} from "../../../shared/notifications/kinds";
import { SettingsRow } from "../../components/settings/SettingsRow";
import { apiEnviar, apiFetch } from "../../lib/api";

const MENSAGEM_DE_ERRO_AO_SALVAR = "Não consegui salvar. Tente de novo.";

// Seção Notificações (TASK-0701): uma linha por tipo do catálogo, com o switch. Cada mudança salva na hora (PUT
// parcial, otimista); falha volta o valor e mostra a mensagem. O subtítulo do balanço segue o dia de início do ciclo.
export function SectionNotificacoes() {
  const [prefs, setPrefs] = useState<Record<NotificationKind, boolean> | null>(null);
  const [diaDeInicio, setDiaDeInicio] = useState(11);
  const [falhou, setFalhou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const raiz = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    setFalhou(false);
    try {
      const [preferencias, lar] = await Promise.all([
        apiFetch<PreferenciasDeNotificacao>("/api/notification-prefs"),
        apiFetch<HouseholdResponse>("/api/household"),
      ]);
      setPrefs(preferencias.kinds);
      setDiaDeInicio(lar.household.cycleStartDay);
    } catch {
      setFalhou(true);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // O link "Escolher o que avisar" leva a /configuracoes#notificacoes: a seção rola para o topo quando carrega.
  useEffect(() => {
    if (prefs !== null && window.location.hash === "#notificacoes") {
      raiz.current?.scrollIntoView({ block: "start" });
    }
  }, [prefs]);

  async function alternar(tipo: NotificationKind, ligado: boolean) {
    const anterior = prefs?.[tipo] ?? true;
    setPrefs((atual) => (atual ? { ...atual, [tipo]: ligado } : atual));
    setErro(null);
    try {
      await apiEnviar<PreferenciasDeNotificacao>("/api/notification-prefs", "PUT", {
        kinds: { [tipo]: ligado },
      });
    } catch {
      setPrefs((atual) => (atual ? { ...atual, [tipo]: anterior } : atual));
      setErro(MENSAGEM_DE_ERRO_AO_SALVAR);
    }
  }

  if (prefs === null) {
    return falhou ? (
      <ErrorState title="Não deu para carregar as notificações." onRetry={() => void carregar()} />
    ) : (
      <SkeletonCard />
    );
  }

  return (
    <div id="notificacoes" ref={raiz} className="flex flex-col gap-3">
      <Card className="flex flex-col overflow-hidden p-0 [&>*+*]:border-t [&>*+*]:border-field-border">
        {NOTIFICATION_KINDS.map((tipo) => {
          const item = NOTIFICATION_CATALOG[tipo];
          return (
            <SettingsRow
              key={tipo}
              titulo={item.titulo}
              subtitulo={subtituloDoTipo(tipo, diaDeInicio)}
              valor={
                <Switch
                  checked={prefs[tipo]}
                  onCheckedChange={(ligado) => void alternar(tipo, ligado)}
                  label={item.titulo}
                />
              }
            />
          );
        })}
      </Card>
      {erro !== null && (
        <p role="alert" className="px-1 text-[13px] font-bold text-danger">
          {erro}
        </p>
      )}
    </div>
  );
}
