import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { UsageBand } from "../../shared/usage";
import { deveMostrarAviso, fechamentoQueVale, recursoDeMaiorPct, textoDoRecurso } from "./texto-do-uso";
import { UpgradeHelp } from "./UpgradeHelp";
import { useUso } from "./useUsage";

// A atenção fechada fica guardada no navegador (try/catch: no modo privado o acesso pode falhar).
const CHAVE_DA_ATENCAO_FECHADA = "uso-atencao-fechada";

function lerAtencaoFechada(): UsageBand | null {
  try {
    return localStorage.getItem(CHAVE_DA_ATENCAO_FECHADA) === "atencao" ? "atencao" : null;
  } catch {
    return null;
  }
}

function gravaAtencaoFechada(valor: UsageBand | null): void {
  try {
    if (valor === null) localStorage.removeItem(CHAVE_DA_ATENCAO_FECHADA);
    else localStorage.setItem(CHAVE_DA_ATENCAO_FECHADA, valor);
  } catch {
    // sem armazenamento, a atenção volta a aparecer: é só a conveniência de não repetir o aviso
  }
}

// Faixa de uso do plano gratuito (TASK-0109), no topo da moldura, abaixo do aviso de aparelho novo. Atenção (70%) nas
// cores de Aviso e crítico (90%) nas de Falta dinheiro. Atenção pode ser fechada até a faixa mudar de nível.
export function UsageBanner() {
  const { uso } = useUso();
  const [fechadaNaFaixa, setFechadaNaFaixa] = useState<UsageBand | null>(lerAtencaoFechada);
  const [ajudaAberta, setAjudaAberta] = useState(false);

  // Quando a faixa deixa a atenção (normal ou crítico), o fechamento não vale mais e sai do navegador.
  useEffect(() => {
    if (uso === null) return;
    const vale = fechamentoQueVale(uso.band, fechadaNaFaixa);
    if (vale === null && fechadaNaFaixa !== null) {
      setFechadaNaFaixa(null);
      gravaAtencaoFechada(null);
    }
  }, [uso, fechadaNaFaixa]);

  if (!deveMostrarAviso(uso, fechadaNaFaixa) || uso === null) return null;
  const recurso = recursoDeMaiorPct(uso.resources);
  if (recurso === undefined) return null;
  const critico = uso.band === "critico";

  function fechar() {
    setFechadaNaFaixa("atencao");
    gravaAtencaoFechada("atencao");
  }

  return (
    <section
      aria-label="Aviso de uso do plano gratuito"
      className={cn(
        "mx-auto mt-4 flex w-full max-w-[720px] items-start gap-3 rounded-card px-4 py-3.5 text-[14px] leading-normal",
        critico ? "bg-[#FFF0F1] text-[#E5484D]" : "bg-[#FFF5E4] text-[#C27400]",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p>{textoDoRecurso(recurso)}</p>
        <button
          type="button"
          onClick={() => setAjudaAberta(true)}
          className="inline-flex min-h-11 items-center self-start px-1 text-[13px] font-extrabold uppercase tracking-[1px] underline"
        >
          Plano pago: US$ 5 por mês · Como fazer o upgrade
        </button>
      </div>
      {!critico && (
        <button
          type="button"
          aria-label="Fechar aviso"
          onClick={fechar}
          className="inline-flex size-11 shrink-0 items-center justify-center text-[22px] leading-none"
        >
          ×
        </button>
      )}
      <UpgradeHelp aberto={ajudaAberta} onFechar={() => setAjudaAberta(false)} />
    </section>
  );
}
