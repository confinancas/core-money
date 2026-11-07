import { cn } from "@/lib/utils";
import { brand } from "../../../shared/brand";

type Membro = { name: string };

// Primeira letra do nome (qualquer alfabeto), em maiúscula. Sem letra, um traço.
function inicial(nome: string): string {
  const letra = /\p{L}/u.exec(nome)?.[0];
  return letra ? letra.toLocaleUpperCase("pt-BR") : "-";
}

// Rodapé do desktop com os membros do lar. Sem membros (null ou lista vazia), não aparece.
export function HouseholdFooter({ members }: { members: Membro[] | null }) {
  if (!members || members.length === 0) return null;

  return (
    <div className="flex items-center gap-3 rounded-[18px] bg-field px-3 py-2">
      <span className="flex shrink-0">
        {members.map((membro, indice) => (
          <span
            key={membro.name}
            aria-hidden="true"
            className={cn(
              "flex size-[34px] items-center justify-center rounded-full border-2 border-white text-[14px] font-extrabold text-white",
              indice === 0 ? "bg-primary" : "bg-st-prazeres",
              indice > 0 && "-ml-2.5",
            )}
          >
            {inicial(membro.name)}
          </span>
        ))}
      </span>
      <span className="flex min-w-0 flex-col gap-px">
        <span className="whitespace-nowrap text-[13px] font-extrabold text-ink">
          {members.map((membro) => membro.name).join(" e ")}
        </span>
        <span className="text-[12px] text-ink-2">{brand.texts.householdLabel}</span>
      </span>
    </div>
  );
}
