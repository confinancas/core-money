import type { SpendType } from "../../../../shared/spend-types";
import { SPEND_TYPE_DEFS } from "../../../../shared/spend-types";
import type { CategoriaDeTipo } from "../../../api/spend-types";
import { rotuloDaCategoria } from "./view-model";

// Tipo padrão por categoria: uma linha por categoria ativa e subcategoria. Tocar abre a folha de escolha (no pai).
export function CategoryTypeList({
  categorias,
  aoEscolher,
}: {
  categorias: CategoriaDeTipo[];
  aoEscolher: (categoria: CategoriaDeTipo) => void;
}) {
  return (
    <ul className="flex flex-col divide-y divide-divider">
      {categorias.map((categoria) => {
        const rotulo = rotuloDaCategoria(categoria);
        const def = SPEND_TYPE_DEFS.find((tipo) => tipo.id === categoria.effectiveSpendType);
        return (
          <li key={categoria.id}>
            <button
              type="button"
              onClick={() => aoEscolher(categoria)}
              aria-label={`${categoria.name}: ${def?.label ?? ""}. Trocar o tipo`}
              className={`flex w-full min-h-11 items-center justify-between gap-3 py-3 text-left ${categoria.parentId ? "pl-5" : ""}`}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[15px] font-semibold text-ink">{rotulo.titulo}</span>
                <span className="text-[12px] text-ink-2">
                  {rotulo.etiqueta}
                  {rotulo.sem !== null && ` · ${rotulo.sem}`}
                </span>
              </span>
              <span
                className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold text-white"
                style={{ backgroundColor: def?.color ?? "#8794A8" }}
                data-tipo={categoria.effectiveSpendType as SpendType}
              >
                {def?.label ?? categoria.effectiveSpendType}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
