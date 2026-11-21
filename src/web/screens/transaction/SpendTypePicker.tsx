import { cn } from "@/lib/utils";
import type { DetalheDaCompra } from "../../../shared/api/transactions";
import { SAVINGS_GROUP_LABEL, SPEND_TYPE_DEFS, type SpendType } from "../../../shared/spend-types";
import { spendTypeCopy } from "../../../shared/transactions/spend-type-copy";
import { Card } from "../../components/ui/card";
import { ChoiceTile } from "../../components/ui/choice-tile";
import { tiposDaCompra } from "./view-model";

// Tipo de gasto (TASK-0403): status à direita, os chips (cinco no cartão, sete na conta) e a ajuda. Toque em outro tipo
// grava na hora (aoEscolher). O chip já escolhido não grava de novo. kind 'pix' (TASK-0404): os textos do Pix e, no
// lugar da grade, o grupo "Gastos · entram no limite" com a caixa tracejada "Dinheiro guardado · só Pix e TED".
export function SpendTypePicker({
  detalhe,
  erro,
  aoEscolher,
  kind = "compra",
}: {
  detalhe: DetalheDaCompra;
  erro: string | null;
  aoEscolher: (tipo: SpendType) => void;
  kind?: "compra" | "pix";
}) {
  const cartao = detalhe.card !== null;
  const tipos = tiposDaCompra(cartao);
  const atual = detalhe.spendType;
  const copia =
    atual !== null && detalhe.spendTypeSource !== null
      ? spendTypeCopy({
          type: atual,
          source: detalhe.spendTypeSource,
          kind,
          categoryName: detalhe.category?.name ?? null,
        })
      : null;
  const doLimite = tipos.filter((tipo) => !SPEND_TYPE_DEFS.find((def) => def.id === tipo.id)?.savings);
  const guardados = tipos.filter((tipo) => SPEND_TYPE_DEFS.find((def) => def.id === tipo.id)?.savings);
  const chip = (tipo: (typeof tipos)[number]) => (
    <ChoiceTile
      key={tipo.id}
      label={tipo.label}
      dotColor={tipo.color}
      selected={tipo.id === atual}
      onSelect={() => aoEscolher(tipo.id)}
    />
  );

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[12px] text-ink-3">Tipo de gasto</p>
        <p className="text-right text-[13px] font-extrabold text-ink">{copia?.status ?? ""}</p>
      </div>
      {kind === "pix" ? (
        <div role="radiogroup" aria-label="Tipo de gasto" className="flex flex-col gap-3">
          <p className="text-[11px] font-bold uppercase tracking-[1px] text-ink-2">
            Gastos · entram no limite
          </p>
          <div className="grid grid-cols-3 gap-2">{doLimite.map(chip)}</div>
          <div className="flex flex-col gap-2 rounded-[14px] border border-dashed border-primary bg-primary-soft/40 p-3">
            <p className="text-[11px] font-bold uppercase tracking-[1px] text-primary-ink">
              {`${SAVINGS_GROUP_LABEL} · só Pix e TED`}
            </p>
            <div className="grid grid-cols-2 gap-2">{guardados.map(chip)}</div>
          </div>
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-label="Tipo de gasto"
          className={cn("grid gap-2", cartao ? "grid-cols-3" : "grid-cols-2")}
        >
          {tipos.map(chip)}
        </div>
      )}
      {copia !== null && <p className="text-[12px] leading-[1.45] text-ink-2">{copia.help}</p>}
      {erro !== null && (
        <p role="alert" className="text-[13px] text-danger">
          {erro}
        </p>
      )}
    </Card>
  );
}
