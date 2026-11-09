import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import type { HouseholdDto, HouseholdResponse } from "../../../shared/household";
import { SettingsRow } from "../../components/settings/SettingsRow";
import { apiFetch } from "../../lib/api";
import { segmentosDaBarra } from "./tipos-de-gasto/view-model";

// Seção Distribuição da renda (TASK-0802): uma linha com a barra fina e os percentuais do lar, que leva a TiposGasto.
export function SectionDistribuicaoRenda() {
  const [lar, setLar] = useState<HouseholdDto | null>(null);
  const [falhou, setFalhou] = useState(false);

  const carregar = useCallback(() => {
    setFalhou(false);
    apiFetch<HouseholdResponse>("/api/household").then(
      (resposta) => setLar(resposta.household),
      () => setFalhou(true),
    );
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (lar === null) {
    return falhou ? (
      <ErrorState title="Não deu para carregar a distribuição." onRetry={carregar} />
    ) : (
      <SkeletonCard />
    );
  }

  const p = lar.percentages;
  const subtitulo = `Fixos ${p.fixos} · Conforto ${p.conforto} · Educação ${p.educacao} · Extras ${p.extras} · Metas ${p.metas} · Prazeres ${p.prazeres} · Invest. ${p.investimentos}`;
  const barra = segmentosDaBarra({
    fixos: p.fixos,
    conforto: p.conforto,
    educacao: p.educacao,
    extras: p.extras,
    metas: p.metas,
    prazeres: p.prazeres,
  });

  return (
    <Card className="flex flex-col overflow-hidden p-0">
      <SettingsRow
        titulo="Tipos de gasto"
        subtitulo={subtitulo}
        inicio={
          <span aria-hidden="true" className="flex h-1.5 w-16 shrink-0 gap-px overflow-hidden rounded-[3px]">
            {barra.map((segmento) => (
              <span
                key={segmento.id}
                className="block h-full"
                style={{ backgroundColor: segmento.color, width: `${segmento.largura}%` }}
              />
            ))}
          </span>
        }
        para="/configuracoes/tipos-de-gasto"
      />
    </Card>
  );
}
