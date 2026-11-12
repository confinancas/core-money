import { MoneyText } from "@/components/ui/money-text";
import type { FixedIncomeDto } from "../../../shared/fixed-incomes";
import { formatFxDate, usdToBrlCents } from "../../../shared/income";
import { formatMoney } from "../../../shared/money";

// A frase da última cotação da renda em dólar (TASK-0902). A taxa e as datas ficam em texto puro; os valores em dólar e
// em real são dinheiro, então entram no MoneyText (o olho os borra), como no resto do app. Sem cotação, não aparece.
export function UltimaCotacaoFrase({ renda }: { renda: FixedIncomeDto }) {
  const cotacao = renda.lastFx;
  if (renda.currency !== "USD" || cotacao === null) return null;
  const emReais = usdToBrlCents(renda.amountCents, cotacao.rateE4);
  return (
    <p className="mt-2 text-[13px] leading-normal font-semibold text-ink">
      Última: {cotacao.rate} em {formatFxDate(cotacao.date)}, então{" "}
      <MoneyText texto={`${formatMoney(renda.amountCents)} dólares ≈ ${formatMoney(emReais)} reais.`} />
    </p>
  );
}
