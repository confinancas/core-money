import type { FaturaDaSerie } from "../../../shared/api/cards";
import { formatDayMonth, monthNamePt, monthYearShortPt } from "../../../shared/format/dates";
import { BillsChart } from "../../components/charts/BillsChart";
import { IconeSeta } from "../../components/icons";
import { Card } from "../../components/ui/card";
import { Money } from "../../components/ui/money";
import { StatusPill } from "../../components/ui/status-pill";
import { pilulaDeVariacao, type TomDoSelo, textoDasParcelas } from "./view-model";

// Cartão "Faturas" do detalhe (TASK-0402): setas para a fatura anterior e a próxima, o rótulo, o valor, a pílula de
// variação, o detalhe da fatura e o gráfico de cinco faturas. Tocar numa barra seleciona a fatura.
export function FaturasDoCartao({
  faturas,
  selecionada,
  aoSelecionar,
  hoje,
}: {
  faturas: readonly FaturaDaSerie[];
  selecionada: number;
  aoSelecionar: (indice: number) => void;
  hoje: string;
}) {
  const fatura = faturas[selecionada];
  if (fatura === undefined) return null;
  const ultimo = faturas.length - 1;
  const mesDoCiclo =
    fatura.cycleKey.slice(0, 4) === hoje.slice(0, 4)
      ? monthNamePt(fatura.cycleKey)
      : `${monthNamePt(fatura.cycleKey)}/${fatura.cycleKey.slice(2, 4)}`;
  const sufixo =
    fatura.status === "aberta" ? "· aberta, até hoje" : fatura.status === "futura" ? "· futura" : "· fechada";
  const pilula = pilulaDoStatus(fatura, faturas[selecionada - 1]);
  const detalhe = detalheDaFatura(fatura);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <SetaDaFatura
          direcao="anterior"
          desabilitada={selecionada === 0}
          onClick={() => aoSelecionar(Math.max(0, selecionada - 1))}
        />
        <p className="text-[13px] font-bold text-ink-2">{monthYearShortPt(fatura.cycleKey)}</p>
        <SetaDaFatura
          direcao="proxima"
          desabilitada={selecionada === ultimo}
          onClick={() => aoSelecionar(Math.min(ultimo, selecionada + 1))}
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[14px] font-bold text-ink-2">
          Fatura de {mesDoCiclo} {sufixo}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Money cents={fatura.totalCents} className="text-[28px] font-extrabold" />
          {pilula !== null && <StatusPill tone={pilula.tom}>{pilula.texto}</StatusPill>}
        </div>
        {detalhe !== null && <p className="text-[13px] text-ink-2">{detalhe}</p>}
      </div>

      <BillsChart series={faturas} selecionada={selecionada} onPick={aoSelecionar} />

      <div className="flex flex-wrap gap-4 text-[12px] font-bold text-ink-2">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3 rounded-sm bg-[#B3E2CA]" />
          Fechada
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-3 rounded-sm border-[1.5px] border-dashed border-primary bg-white"
          />
          Aberta ou futura
        </span>
      </div>
    </Card>
  );
}

// Pílula: aberta é "parcial · aberta"; futura é "futura"; a primeira da série é "sem mês anterior"; fechada compara
// com a anterior (▲ em alta, ▼ em queda).
function pilulaDoStatus(
  atual: FaturaDaSerie,
  anterior: FaturaDaSerie | undefined,
): { texto: string; tom: TomDoSelo } | null {
  if (atual.status === "aberta") return { texto: "parcial · aberta", tom: "sucesso" };
  if (atual.status === "futura") return { texto: "futura", tom: "sucesso" };
  if (anterior === undefined) return { texto: "sem mês anterior", tom: "sucesso" };
  return pilulaDeVariacao(atual.totalCents, anterior.totalCents);
}

// O texto da linha de detalhe, pelo status da fatura.
function detalheDaFatura(fatura: FaturaDaSerie): string | null {
  if (fatura.status === "aberta") {
    return `Fecha ${formatDayMonth(fatura.closesOn)}${fatura.dueOn ? ` · vence ${formatDayMonth(fatura.dueOn)}` : ""}`;
  }
  if (fatura.status === "futura") {
    return fatura.futureItems.length > 0 ? `Só parcelas: ${textoDasParcelas(fatura.futureItems)}` : null;
  }
  if (fatura.status === "paga") {
    return fatura.paidOn ? `Paga em ${formatDayMonth(fatura.paidOn)}` : "Paga";
  }
  return fatura.dueOn ? `Vence ${formatDayMonth(fatura.dueOn)}` : null;
}

function SetaDaFatura({
  direcao,
  desabilitada,
  onClick,
}: {
  direcao: "anterior" | "proxima";
  desabilitada: boolean;
  onClick: () => void;
}) {
  const anterior = direcao === "anterior";
  return (
    <button
      type="button"
      aria-label={anterior ? "Fatura anterior" : "Próxima fatura"}
      disabled={desabilitada}
      onClick={onClick}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary transition-opacity disabled:opacity-30"
    >
      <IconeSeta size={20} className={anterior ? "" : "rotate-180"} />
    </button>
  );
}
