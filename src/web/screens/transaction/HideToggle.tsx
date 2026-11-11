import { Card } from "../../components/ui/card";
import { Switch } from "../../components/ui/switch";

// Ocultar (TASK-0403): para compras feitas para outra pessoa. Continua na fatura, sai dos totais, gráficos e insights.
// A chave grava na hora (aoMudar); o erro aparece sob este cartão.
export function HideToggle({
  hidden,
  erro,
  aoMudar,
}: {
  hidden: boolean;
  erro: string | null;
  aoMudar: (oculta: boolean) => void;
}) {
  return (
    <Card className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-extrabold text-ink">Ocultar dos cálculos / gasto de terceiros</h2>
        <p className="mt-1 text-[12px] leading-[1.5] text-ink-2">
          Para compras feitas para outra pessoa, como parcelar algo no seu cartão para alguém. Continua na
          fatura, mas sai dos totais, gráficos e insights.
        </p>
        {erro !== null && (
          <p role="alert" className="mt-2 text-[13px] text-danger">
            {erro}
          </p>
        )}
      </div>
      <Switch checked={hidden} onCheckedChange={aoMudar} label="Ocultar dos cálculos e gasto de terceiros" />
    </Card>
  );
}
