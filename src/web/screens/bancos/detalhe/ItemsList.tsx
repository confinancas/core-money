import { Link } from "react-router";
import type { CartaoDoBanco, ContaDoBanco } from "../../../../shared/bank-item-view";
import { IconeCaixa, IconeCartao } from "../../../components/icons";
import { Card } from "../../../components/ui/card";
import { Money } from "../../../components/ui/money";
import { diaEMes } from "./texto";

// "O que vem deste banco" (TASK-0206): cartões com a fatura aberta e contas com o saldo de hoje. Valores com Money.
export function ItemsList({ contas, cartoes }: { contas: ContaDoBanco[]; cartoes: CartaoDoBanco[] }) {
  const vazio = contas.length === 0 && cartoes.length === 0;
  return (
    <div className="flex flex-col gap-2">
      <h2 className="px-1 text-[12px] font-extrabold uppercase tracking-[1.2px] text-ink-2">
        O que vem deste banco
      </h2>
      <Card className="flex flex-col overflow-hidden p-0">
        {vazio && <p className="px-4 pb-4 text-[14px] text-ink-2">Nada veio deste banco ainda.</p>}
        {cartoes.map((cartao) => (
          <Link
            key={cartao.id}
            to={`/cartoes/${encodeURIComponent(cartao.id)}`}
            className="flex min-h-[44px] items-center justify-between gap-3 border-t border-field-border px-4 py-3 hover:bg-primary-soft/40"
          >
            <IconeCartao size={18} className="shrink-0 text-primary" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[15px] font-bold text-ink">Cartão final {cartao.last4}</span>
              <span className="text-[13px] text-ink-2">
                {cartao.openBill !== null
                  ? `Fatura aberta · fecha ${diaEMes(cartao.openBill.closesOn)}`
                  : "Sem fatura aberta"}
              </span>
            </span>
            {cartao.openBill?.amountCents !== null && cartao.openBill?.amountCents !== undefined && (
              <Money cents={cartao.openBill.amountCents} className="shrink-0 text-[15px] font-extrabold" />
            )}
          </Link>
        ))}
        {contas.map((conta) => (
          <div
            key={conta.id}
            className="flex min-h-[44px] items-center justify-between gap-3 border-t border-field-border px-4 py-3"
          >
            <IconeCaixa size={18} className="shrink-0 text-primary" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[15px] font-bold text-ink">{tituloDaConta(conta)}</span>
              <span className="text-[13px] text-ink-2">{subtituloDaConta(conta)}</span>
            </span>
            <Money cents={conta.balanceCents} className="shrink-0 text-[15px] font-extrabold" />
          </div>
        ))}
      </Card>
    </div>
  );
}

// corrente e poupança têm nome fixo na tela; caixinha e outra usam o nome do banco.
function tituloDaConta(conta: ContaDoBanco): string {
  if (conta.kind === "corrente") return "Conta corrente";
  if (conta.kind === "poupanca") return "Poupança";
  return conta.name;
}

function subtituloDaConta(conta: ContaDoBanco): string {
  if (conta.kind === "caixinha") return "Rendimento entra como renda variável";
  if (conta.kind === "outra") return "Investimento";
  return "Saldo de hoje";
}
