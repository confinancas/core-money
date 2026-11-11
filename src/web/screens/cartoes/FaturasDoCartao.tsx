import type { FaturaDaSerie } from "../../../shared/api/cards";
import { formatDayMonth, monthNamePt, monthYearShortPt } from "../../../shared/format/dates";
import { BillsChart } from "../../components/charts/BillsChart";
import { IconeSeta } from "../../components/icons";
import { Card } from "../../components/ui/card";
import { Money } from "../../components/ui/money";
import { StatusPill } from "../../components/ui/status-pill";
import { pilulaDeVariacao, textoDasParcelas } from "./view-model";

// Cartão "Faturas" do detalhe (TASK-0402): título, setas para a fatura anterior e a próxima, o rótulo, o valor, a
// pílula, o detalhe da fatura e o gráfico de cinco faturas. Tocar numa barra seleciona a fatura. As pílulas sem
// variação são neutras, como no protótipo: parcial e futura só com contorno; sem mês anterior, em cinza claro.
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
      <h2 className="text-[16px] font-extrabold text-ink">Faturas</h2>

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
          {pilula.tipo === "variacao" && <StatusPill tone={pilula.tom}>{pilula.texto}</StatusPill>}
          {pilula.tipo === "contorno" && (
            <span className="inline-flex items-center rounded-full border border-[#98A39D] px-2.5 py-[3px] text-[12px] font-extrabold text-[#18221E]">
              {pilula.texto}
            </span>
          )}
          {pilula.tipo === "clara" && (
            <span className="inline-flex items-center rounded-full bg-[#E1E7E4] px-2.5 py-[3px] text-[12px] font-extrabold text-[#66756E]">
              {pilula.texto}
            </span>
          )}
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

type PilulaDaFatura =
  | { tipo: "variacao"; texto: string; tom: "aviso" | "falta" | "sucesso" }
  | { tipo: "contorno"; texto: string }
  | { tipo: "clara"; texto: string }
  | { tipo: "nenhuma" };

// Pílula: aberta é "parcial · aberta" e futura é "futura" (só com contorno); a primeira da série é "sem mês anterior"
// (cinza claro); fechada compara com a anterior (▲ em alta, ▼ em queda), e sem base não há pílula.
function pilulaDoStatus(atual: FaturaDaSerie, anterior: FaturaDaSerie | undefined): PilulaDaFatura {
  if (atual.status === "aberta") return { tipo: "contorno", texto: "parcial · aberta" };
  if (atual.status === "futura") return { tipo: "contorno", texto: "futura" };
  if (anterior === undefined) return { tipo: "clara", texto: "sem mês anterior" };
  const variacao = pilulaDeVariacao(atual.totalCents, anterior.totalCents);
  return variacao === null ? { tipo: "nenhuma" } : { tipo: "variacao", ...variacao };
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
