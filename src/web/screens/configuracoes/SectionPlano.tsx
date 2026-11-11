import { useState } from "react";
import { Card } from "@/components/ui/card";
import { SkeletonCard } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  FREE_LIMITS,
  formataMegabytes,
  formataMilhar,
  RESOURCE_LABELS,
  type UsageResource,
} from "../../../shared/usage";
import { SettingsRow } from "../../components/settings/SettingsRow";
import { UpgradeHelp } from "../../usage/UpgradeHelp";
import { useUso } from "../../usage/useUsage";

const MENSAGEM_DE_ERRO_AO_SALVAR = "Não deu para salvar agora. Tente de novo.";

// Seção Plano da Cloudflare (TASK-0109): o switch "Estou no plano pago" (desliga os avisos), o uso de hoje (abre as
// quatro barras na própria tela) e o passo a passo do upgrade. O switch tem a área de toque de 46 px do componente.
export function SectionPlano() {
  const { uso, definirPlanoPago } = useUso();
  const [mostrandoUso, setMostrandoUso] = useState(false);
  const [ajudaAberta, setAjudaAberta] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (uso === null) return <SkeletonCard />;

  async function mudarPlano(valor: boolean) {
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      await definirPlanoPago(valor);
    } catch {
      setErro(MENSAGEM_DE_ERRO_AO_SALVAR);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <Card className="flex flex-col overflow-hidden p-0 [&>*+*]:border-t [&>*+*]:border-field-border">
        <div className="flex min-h-16 w-full items-center gap-3 px-4 py-3">
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[15px] font-bold text-ink">Estou no plano pago</span>
            <span className="text-[13px] leading-normal text-ink-2">
              Desliga os avisos de uso do plano gratuito. O app não descobre o plano sozinho.
            </span>
          </span>
          <Switch
            checked={uso.paidPlan}
            onCheckedChange={(valor) => void mudarPlano(valor)}
            label="Estou no plano pago"
            disabled={salvando}
          />
        </div>
        {erro && (
          <p role="alert" className="px-4 pb-3 text-[13px] text-danger">
            {erro}
          </p>
        )}
        <SettingsRow
          titulo="Uso de hoje"
          subtitulo="Zera às 21h (horário de Brasília)"
          aoAbrir={() => setMostrandoUso((aberto) => !aberto)}
        />
        {mostrandoUso && (
          <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
            {uso.resources.map((recurso) => (
              <BarraDeUso key={recurso.id} recurso={recurso} />
            ))}
          </div>
        )}
        <SettingsRow titulo="Como fazer o upgrade" aoAbrir={() => setAjudaAberta(true)} />
      </Card>
      <UpgradeHelp aberto={ajudaAberta} onFechar={() => setAjudaAberta(false)} />
    </>
  );
}

// Uma barra do uso: "X de Y" com milhar com ponto (o tamanho em MB). Leituras do banco trazem o selo de estimativa.
function BarraDeUso({ recurso }: { recurso: UsageResource }) {
  const nome = RESOURCE_LABELS[recurso.id];
  const tamanho = recurso.id === "size_bytes";
  const usado = tamanho ? formataMegabytes(recurso.used) : formataMilhar(recurso.used);
  const limite = tamanho ? formataMegabytes(FREE_LIMITS.size_bytes) : formataMilhar(recurso.limit);
  const largura = Math.min(recurso.pct, 100);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[14px]">
        <span className="flex items-center gap-2 font-bold text-ink">
          {nome}
          {recurso.estimated && (
            <span className="rounded-full bg-field px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.5px] text-ink-2">
              estimativa
            </span>
          )}
        </span>
        <span className="text-ink-2">
          {usado} de {limite}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={nome}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={largura}
        className="h-2 overflow-hidden rounded-full bg-field"
      >
        <div
          className={cn(
            "h-full rounded-full",
            recurso.pct >= 90 ? "bg-danger" : recurso.pct >= 70 ? "bg-[#C27400]" : "bg-primary",
          )}
          style={{ width: `${largura}%` }}
        />
      </div>
    </div>
  );
}
