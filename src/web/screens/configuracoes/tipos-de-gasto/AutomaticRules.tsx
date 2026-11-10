import type { RegraAutomatica } from "../../../api/spend-types";
import { TEXTO_DO_PADRAO, textoDaRegra } from "./view-model";

// Regras automáticas: corretora e caixinha (definíveis), o salário que fica em dólar (automático, TASK-0902) e o padrão.
export function AutomaticRules({
  regras,
  aoDefinir,
}: {
  regras: RegraAutomatica[];
  aoDefinir: (kind: RegraAutomatica["kind"]) => void;
}) {
  const corretora = regras.find((regra) => regra.kind === "corretora");
  const caixinha = regras.find((regra) => regra.kind === "caixinha");
  const linhas: { kind: RegraAutomatica["kind"]; regra?: RegraAutomatica }[] = [
    { kind: "corretora", regra: corretora },
    { kind: "caixinha", regra: caixinha },
  ];
  return (
    <ul className="flex flex-col divide-y divide-divider">
      {linhas.map(({ kind, regra }) => {
        const texto = textoDaRegra(regra, kind);
        return (
          <li key={kind} className="flex items-center justify-between gap-3 py-4">
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-[15px] font-semibold text-ink">{texto.titulo}</span>
              <span className="text-[12px] leading-[1.4] text-ink-2">{texto.descricao}</span>
            </span>
            <button
              type="button"
              onClick={() => aoDefinir(kind)}
              className="min-h-11 shrink-0 rounded-full border border-primary-soft-2 px-4 text-[13px] font-bold text-primary-ink"
            >
              {texto.acao}
            </button>
          </li>
        );
      })}
      <li className="flex flex-col gap-1 py-4">
        <span className="text-[15px] font-semibold text-ink">Salário que fica em dólar</span>
        <span className="text-[12px] leading-[1.4] text-ink-2">
          Previsto − trazido para o Brasil · vira Investimentos
        </span>
        <span className="mt-1 w-max rounded-full border border-primary-soft-2 px-2 py-px text-[10px] font-bold uppercase tracking-[0.5px] text-primary-ink">
          automático
        </span>
      </li>
      <li className="flex flex-col gap-1 py-4">
        <span className="text-[15px] font-semibold text-ink">Padrão: Prazeres</span>
        <span className="text-[12px] leading-[1.4] text-ink-2">{TEXTO_DO_PADRAO}</span>
      </li>
    </ul>
  );
}
