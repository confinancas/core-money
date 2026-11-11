import type { DetalheDaCompra } from "../../../shared/api/transactions";
import { Card } from "../../components/ui/card";
import { formaDaCompra, textoDaFatura, textoDoCiclo } from "./view-model";

// Linhas da compra (TASK-0403): forma, fatura (só no cartão), conta no ciclo e descrição do banco em negrito.
export function DetailRows({ detalhe }: { detalhe: DetalheDaCompra }) {
  const linhas: { rotulo: string; valor: string }[] = [{ rotulo: "Forma", valor: formaDaCompra(detalhe) }];
  if (detalhe.card !== null) linhas.push({ rotulo: "Fatura", valor: textoDaFatura(detalhe.bill) });
  linhas.push({ rotulo: "Conta no ciclo", valor: textoDoCiclo(detalhe.cycle) });

  return (
    <Card className="flex flex-col px-[22px] py-1">
      {linhas.map((linha) => (
        <div
          key={linha.rotulo}
          className="flex min-h-11 items-center justify-between gap-3 border-divider border-b py-2 last:border-b-0"
        >
          <p className="text-[14px] text-ink-3">{linha.rotulo}</p>
          <p className="text-right text-[14px] font-semibold text-ink">{linha.valor}</p>
        </div>
      ))}
      <div className="flex flex-col gap-1 py-3">
        <p className="text-[13px] text-ink-3">Descrição do banco</p>
        <p className="break-words text-[14px] font-extrabold text-ink">{detalhe.originalDescription}</p>
      </div>
    </Card>
  );
}
