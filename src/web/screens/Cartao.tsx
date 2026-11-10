import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import type { RespostaDeCartao } from "../../shared/api/cards";
import { formatDayMonth, monthNamePt } from "../../shared/format/dates";
import { todayInSaoPaulo } from "../../shared/sao-paulo-date";
import { fetchCard } from "../api/cards";
import { IconeCheck } from "../components/icons";
import { Card } from "../components/ui/card";
import { ErrorState } from "../components/ui/error-state";
import { GreenTop } from "../components/ui/green-top";
import { Money } from "../components/ui/money";
import { SkeletonCard } from "../components/ui/skeleton";
import { FaturasDoCartao } from "./cartoes/FaturasDoCartao";
import { LinhaDeCompra } from "./cartoes/LinhaDeCompra";
import {
  limiteUsadoPct,
  seloDePaga,
  seloDeVencimento,
  textoDaMedia,
  textoDosLancamentos,
} from "./cartoes/view-model";

// Detalhe do cartão (TASK-0402): genérico para qualquer banco. O topo verde leva a fatura aberta, as datas, o limite
// e os balões, tudo dentro do verde, como no protótipo. Depois, a série de faturas com o gráfico e as compras da fatura
// aberta. Celular: uma coluna. Tablet e desktop: faturas à esquerda, gastos à direita.
export function Cartao() {
  const { cardId = "" } = useParams();
  const [dados, setDados] = useState<RespostaDeCartao | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [escolhida, setEscolhida] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    setFalhou(false);
    try {
      setDados(await fetchCard(cardId));
    } catch {
      setFalhou(true);
    }
  }, [cardId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const hoje = todayInSaoPaulo(new Date());
  const titulo = dados ? `${dados.card.bankName} · final ${dados.card.last4}` : "Cartão";

  return (
    <section className="flex min-h-dvh flex-col bg-bg">
      <GreenTop variant="detail" title={titulo} back={{ to: "/cartoes", label: "Voltar" }}>
        {dados !== null && <Topo dados={dados} hoje={hoje} />}
      </GreenTop>

      {dados === null ? (
        <div className="mx-auto w-full max-w-[1120px] px-4 pt-6 tablet:px-6">
          {falhou ? <ErrorState onRetry={() => void carregar()} /> : <SkeletonCard />}
        </div>
      ) : (
        <Corpo dados={dados} hoje={hoje} escolhida={escolhida} aoEscolher={setEscolhida} />
      )}
    </section>
  );
}

// Dentro do verde: a fatura aberta, as datas, a barra do limite, o disponível e o limite, e os balões.
function Topo({ dados, hoje }: { dados: RespostaDeCartao; hoje: string }) {
  const { card, open, badge } = dados;
  const temLimite = card.limitCents !== null && card.availableCents !== null && card.limitCents > 0;
  const usado = temLimite ? limiteUsadoPct(card.limitCents ?? 0, card.availableCents ?? 0) : 0;
  const selo =
    badge === null
      ? null
      : badge.kind === "vence"
        ? seloDeVencimento(badge.dueOn, hoje)
        : seloDePaga(badge.cycleKey);

  return (
    <div className="mt-2 flex flex-col gap-4 text-white">
      {open !== null && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-semibold text-white/82">
              Fatura aberta · ciclo de {monthNamePt(open.cycleKey)}
            </p>
            {selo !== null && (
              <span className="inline-flex items-center gap-1 rounded-full border border-white/28 bg-white/18 px-2.5 py-[3px] text-[12px] font-extrabold">
                {badge?.kind === "paga" && <IconeCheck size={12} />}
                {selo.texto}
              </span>
            )}
          </div>
          <Money cents={open.totalCents} className="text-[34px] font-extrabold" />
          <div className="grid max-w-[360px] grid-cols-3 gap-3">
            <Rotulo rotulo="Fecha" valor={formatDayMonth(open.closesOn)} />
            <Rotulo rotulo="Vence" valor={open.dueOn !== null ? formatDayMonth(open.dueOn) : "—"} />
            <Rotulo
              rotulo="Melhor dia"
              valor={card.bestDayOn !== null ? formatDayMonth(card.bestDayOn) : "—"}
            />
          </div>
        </div>
      )}

      {temLimite && (
        <div className="flex flex-col gap-2">
          <div
            role="progressbar"
            aria-label="Limite usado"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(usado)}
            className="h-2 overflow-hidden rounded-full bg-white/30"
          >
            <div className="h-full rounded-full bg-white" style={{ width: `${usado}%` }} />
          </div>
          <div className="flex items-baseline justify-between gap-3 text-[13px] text-white/92">
            <p>
              Disponível <Money cents={card.availableCents ?? 0} className="font-bold" />
            </p>
            <p>
              Limite <Money cents={card.limitCents ?? 0} className="font-bold" />
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 divide-x divide-white/22 rounded-glass border border-white/22 bg-white/14">
        <div className="px-4 py-3">
          <p className="text-[12px] font-bold text-white/82">Parcelas futuras</p>
          <Money cents={dados.futureInstallmentsCents} className="text-[18px] font-extrabold" />
        </div>
        {dados.avgMonths > 0 && (
          <div className="px-4 py-3">
            <p className="text-[12px] font-bold text-white/82">
              {dados.avgMonths >= 6 ? "Média 6 meses" : textoDaMedia(dados.avgMonths)}
            </p>
            <Money cents={dados.avg6Cents} className="text-[18px] font-extrabold" />
          </div>
        )}
      </div>
    </div>
  );
}

function Rotulo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex flex-col">
      <p className="text-[12px] font-semibold text-white/82">{rotulo}</p>
      <p className="text-[15px] font-extrabold">{valor}</p>
    </div>
  );
}

function Corpo({
  dados,
  hoje,
  escolhida,
  aoEscolher,
}: {
  dados: RespostaDeCartao;
  hoje: string;
  escolhida: number | null;
  aoEscolher: (indice: number) => void;
}) {
  const { open } = dados;
  const selecionada = escolhida ?? indicePadrao(dados.bills);

  return (
    <div className="mx-auto grid w-full max-w-[1120px] items-start gap-5 px-4 pt-6 pb-8 tablet:grid-cols-2 tablet:px-6">
      {dados.bills.length > 0 && (
        <FaturasDoCartao
          faturas={dados.bills}
          selecionada={selecionada}
          aoSelecionar={aoEscolher}
          hoje={hoje}
        />
      )}

      {open !== null && (
        <Card className="flex min-w-0 flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 pb-2">
            <h2 className="text-[16px] font-extrabold text-ink">Gastos da fatura aberta</h2>
            <p className="shrink-0 text-[13px] font-semibold text-ink-2">
              {textoDosLancamentos(dados.openCount, dados.openHiddenCount)}
            </p>
          </div>
          {dados.openItems.map((compra) => (
            <LinhaDeCompra key={compra.id} compra={compra} hoje={hoje} mostrarBanco={false} />
          ))}
        </Card>
      )}
    </div>
  );
}

// A fatura que abre a tela: a aberta; sem aberta, a última fechada ou paga; sem nenhuma, a primeira.
function indicePadrao(faturas: RespostaDeCartao["bills"]): number {
  const aberta = faturas.findIndex((fatura) => fatura.status === "aberta");
  if (aberta >= 0) return aberta;
  for (let indice = faturas.length - 1; indice >= 0; indice--) {
    const fatura = faturas[indice];
    if (fatura && (fatura.status === "fechada" || fatura.status === "paga")) return indice;
  }
  return 0;
}
