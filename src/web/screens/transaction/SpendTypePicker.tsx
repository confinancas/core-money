import { cn } from "@/lib/utils";
import type { DetalheDaCompra } from "../../../shared/api/transactions";
import type { SpendType } from "../../../shared/spend-types";
import { spendTypeCopy } from "../../../shared/transactions/spend-type-copy";
import { Card } from "../../components/ui/card";
import { ChoiceTile } from "../../components/ui/choice-tile";
import { tiposDaCompra } from "./view-model";

// Tipo de gasto (TASK-0403): status à direita, os chips (cinco no cartão, sete na conta) e a ajuda. Toque em outro tipo
// grava na hora (aoEscolher). O chip já escolhido não grava de novo.
export function SpendTypePicker({
  detalhe,
  erro,
  aoEscolher,
}: {
  detalhe: DetalheDaCompra;
  erro: string | null;
  aoEscolher: (tipo: SpendType) => void;
}) {
  const cartao = detalhe.card !== null;
  const tipos = tiposDaCompra(cartao);
  const atual = detalhe.spendType;
  const copia =
    atual !== null && detalhe.spendTypeSource !== null
      ? spendTypeCopy({
          type: atual,
          source: detalhe.spendTypeSource,
          kind: "compra",
          categoryName: detalhe.category?.name ?? null,
        })
      : null;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[12px] text-ink-3">Tipo de gasto</p>
        <p className="text-right text-[13px] font-extrabold text-ink">{copia?.status ?? ""}</p>
      </div>
      <div
        role="radiogroup"
        aria-label="Tipo de gasto"
        className={cn("grid gap-2", cartao ? "grid-cols-3" : "grid-cols-2")}
      >
        {tipos.map((tipo) => (
          <ChoiceTile
            key={tipo.id}
            label={tipo.label}
            dotColor={tipo.color}
            selected={tipo.id === atual}
            onSelect={() => aoEscolher(tipo.id)}
          />
        ))}
      </div>
      {copia !== null && <p className="text-[12px] leading-[1.45] text-ink-2">{copia.help}</p>}
      {erro !== null && (
        <p role="alert" className="text-[13px] text-danger">
          {erro}
        </p>
      )}
    </Card>
  );
}
