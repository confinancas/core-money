import { Fragment, type ReactNode } from "react";

// Valores dentro de um texto corrido (o corpo de uma notificação): "1.980,00", "+1.500,00", "127,41". Cada um sai como
// Money: parte inteira com algarismos tabulares e centavos a 60%, sem quebra. Os valores são sensíveis (o olho os
// borra), como no Money. Não há "R$" no texto (a spec da TASK-0701 manda o formato do app).
const VALOR = /[+−-]?\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)/g;

export function MoneyText({ texto, className }: { texto: string; className?: string }) {
  const pedacos: ReactNode[] = [];
  let ultimo = 0;
  let chave = 0;

  for (const casa of texto.matchAll(VALOR)) {
    const inicio = casa.index ?? 0;
    const valor = casa[0];
    if (inicio > ultimo) pedacos.push(<Fragment key={chave++}>{texto.slice(ultimo, inicio)}</Fragment>);
    const virgula = valor.lastIndexOf(",");
    pedacos.push(
      <span key={chave++} className="mm-money" data-v="">
        {valor.slice(0, virgula)}
        <span className="mm-cents">{valor.slice(virgula)}</span>
      </span>,
    );
    ultimo = inicio + valor.length;
  }
  if (ultimo < texto.length) pedacos.push(<Fragment key={chave++}>{texto.slice(ultimo)}</Fragment>);

  return <span className={className}>{pedacos}</span>;
}
