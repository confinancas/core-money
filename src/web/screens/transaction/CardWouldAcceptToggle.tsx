import { Card } from "../../components/ui/card";
import { Switch } from "../../components/ui/switch";

// Esse lugar aceitava cartão (TASK-0404): grava na hora, alimenta o relatório de Pix (TASK-1003).
export function CardWouldAcceptToggle({
  ligada,
  erro,
  aoMudar,
}: {
  ligada: boolean;
  erro: string | null;
  aoMudar: (ligada: boolean) => void;
}) {
  return (
    <Card className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-extrabold text-ink">Esse lugar aceitava cartão</h2>
        <p className="mt-1 text-[12px] leading-[1.5] text-ink-2">
          Entra na lista do relatório de Pix que podiam ter sido no cartão e ganhado pontos.
        </p>
        {erro !== null && (
          <p role="alert" className="mt-2 text-[13px] text-danger">
            {erro}
          </p>
        )}
      </div>
      <Switch checked={ligada} onCheckedChange={aoMudar} label="Esse lugar aceitava cartão" />
    </Card>
  );
}
