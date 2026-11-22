import { Card } from "../../components/ui/card";

// Pagamento de cartão ligado (TASK-0404): no lugar da categoria, um aviso de que a saída não conta como gasto. Num
// Card, para ficar sobre o fundo claro (e não sobre a faixa verde) nas três larguras.
export function PaymentNotice() {
  return (
    <Card>
      <p className="text-[15px] font-extrabold text-ink">Pagamento de cartão · não conta como gasto</p>
    </Card>
  );
}
