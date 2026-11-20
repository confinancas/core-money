import { Card } from "../../components/ui/card";
import { Switch } from "../../components/ui/switch";

// É pagamento de cartão (TASK-0404): tira a saída do gasto, porque as compras já contaram na fatura. Grava na hora; o erro
// aparece sob este cartão. Ligado, a tela esconde categoria, tipo, conta fixa, Lembrar e aceitava cartão.
export function CardPaymentToggle({
  ligada,
  matchLabel,
  erro,
  aoMudar,
}: {
  ligada: boolean;
  matchLabel: string;
  erro: string | null;
  aoMudar: (ligada: boolean) => void;
}) {
  return (
    <Card className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-extrabold text-ink">É pagamento de cartão</h2>
        <p className="mt-1 text-[12px] leading-[1.5] text-ink-2">
          Não conta como gasto: as compras já contaram na fatura. Os próximos para {matchLabel} entram assim
          sozinhos.
        </p>
        {erro !== null && (
          <p role="alert" className="mt-2 text-[13px] text-danger">
            {erro}
          </p>
        )}
      </div>
      <Switch checked={ligada} onCheckedChange={aoMudar} label="É pagamento de cartão" />
    </Card>
  );
}
