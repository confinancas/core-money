import { cn } from "@/lib/utils";
import { type Sinal, splitMoney } from "../../../shared/money";

type Props = {
  cents: number;
  sign?: Sinal;
  // Os valores são sensíveis por padrão: o olho os borra. sensitive={false} tira essa marca.
  sensitive?: boolean;
  struck?: boolean;
  className?: string;
};

// Valor em reais, sem "R$": parte inteira, centavos a 60% e algarismos tabulares.
export function Money({ cents, sign, sensitive = true, struck = false, className }: Props) {
  const partes = splitMoney(cents, sign);
  const prefixo = partes.sign === "−" ? "menos " : partes.sign === "+" ? "mais " : "";

  return (
    // role="img" é o que deixa o aria-label valer: o leitor de tela anuncia "menos 50,97" por extenso.
    <span
      role="img"
      className={cn("mm-money", struck && "text-hidden-ink line-through", className)}
      data-v={sensitive ? "" : undefined}
      aria-label={`${prefixo}${partes.int},${partes.cents}`}
    >
      {partes.sign}
      {partes.int}
      <span className="mm-cents">,{partes.cents}</span>
    </span>
  );
}
