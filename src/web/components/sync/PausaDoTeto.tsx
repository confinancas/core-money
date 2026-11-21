import { useState } from "react";
import { Button } from "@/components/ui/button";
import { fraseDaRetomada } from "../../../shared/retomada-da-importacao";
import { useUso } from "../../usage/useUsage";

// Importação pausada pelo teto diário (TASK-0209), igual na faixa e no passo 4: a frase de quando volta, e, no plano
// gratuito, a explicação, o botão "Seguir agora" e a nota. No plano pago, só a frase (sem o botão).
export const MENSAGEM_DE_ERRO_AO_SEGUIR = "Não deu para seguir. Tente de novo.";

type Props = {
  pausadaAte: string;
  paidPlan: boolean;
  // Chamado depois de gravar o plano: a tela relê o status e mostra o andamento de novo.
  aoSeguir: () => void;
};

export function PausaDoTeto({ pausadaAte, paidPlan, aoSeguir }: Props) {
  const { definirPlanoPago } = useUso();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function seguir() {
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      await definirPlanoPago(true);
    } catch {
      setErro(MENSAGEM_DE_ERRO_AO_SEGUIR);
      setSalvando(false);
      return;
    }
    setSalvando(false);
    aoSeguir();
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] leading-normal text-ink-2" data-testid="pausa-do-historico">
        {fraseDaRetomada(pausadaAte, new Date())}
      </p>
      {!paidPlan && (
        <>
          <p className="text-[13px] leading-normal text-ink-2">
            Para o app caber no plano gratuito da Cloudflare, a importação usa até 60% das gravações do banco
            por dia. O resto fica para o uso de vocês.
          </p>
          <Button variant="secondary" full disabled={salvando} onClick={() => void seguir()}>
            Seguir agora · tenho o plano pago
          </Button>
          <p className="text-[12px] leading-normal text-ink-2">
            Só vale o plano pago do Workers (Workers Paid). O plano Pro do site não conta. No plano gratuito,
            o app pode parar até as 21h.
          </p>
        </>
      )}
      {erro && (
        <p role="alert" className="text-[13px] text-danger">
          {erro}
        </p>
      )}
    </div>
  );
}
