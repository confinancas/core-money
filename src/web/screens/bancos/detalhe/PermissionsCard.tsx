import { Card } from "../../../components/ui/card";

// Permissões (TASK-0206): texto fixo do protótipo. O app só lê; a lista não vem do Pluggy.
const LINHAS = [
  { titulo: "Saldos e extrato", detalhe: "Conta corrente e caixinha" },
  { titulo: "Cartões e faturas", detalhe: "Compras, parcelas, fechamento e vencimento" },
  { titulo: "Dados cadastrais", detalhe: "Nome e CPF do titular, para identificar a conta" },
  { titulo: "Pagamentos e transferências", detalhe: "Não autorizado. O Matrimoney nunca move dinheiro." },
];

export function PermissionsCard() {
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-[17px] font-extrabold text-ink">Permissões</h2>
      <p className="text-[14px] leading-normal text-ink">
        Só leitura. O app vê os dados, mas não consegue mover dinheiro nem pagar nada.
      </p>
      <ul className="flex flex-col">
        {LINHAS.map((linha) => (
          <li key={linha.titulo} className="flex flex-col border-t border-field-border py-2.5">
            <span className="text-[14px] font-bold text-ink">{linha.titulo}</span>
            <span className="text-[13px] text-ink-2">{linha.detalhe}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
