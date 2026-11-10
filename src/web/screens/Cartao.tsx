import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import type { RespostaDeCartao } from "../../shared/api/cards";
import { formatDayMonth, monthNamePt } from "../../shared/format/dates";
import { formatMoney } from "../../shared/money";
import { todayInSaoPaulo } from "../../shared/sao-paulo-date";
import { fetchCard } from "../api/cards";
import { Card } from "../components/ui/card";
import { ErrorState } from "../components/ui/error-state";
import { GlassBubble } from "../components/ui/glass-bubble";
import { GreenTop } from "../components/ui/green-top";
import { Money } from "../components/ui/money";
import { SkeletonCard } from "../components/ui/skeleton";
import { StatusPill } from "../components/ui/status-pill";
import { FaturasDoCartao } from "./cartoes/FaturasDoCartao";
import { LinhaDeCompra } from "./cartoes/LinhaDeCompra";
import {
  limiteUsadoPct,
  seloDePaga,
  seloDeVencimento,
  textoDaMedia,
  textoDosLancamentos,
} from "./cartoes/view-model";

// Detalhe do cartão (TASK-0402): genérico para qualquer banco. Topo com a fatura aberta e os balões; a série de
// faturas com o gráfico; e as compras da fatura aberta. Celular: uma coluna. Desktop: faturas à esquerda, compras
// à direita.
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
      <GreenTop
        variant="detail"
        title={titulo}
        back={{ to: "/cartoes", label: "Voltar" }}
        overlap={dados !== null}
      />

      {dados === null ? (
        <div className="mx-auto w-full max-w-[1120px] px-4 pt-6 tablet:px-6">
          {falhou ? <ErrorState onRetry={() => void carregar()} /> : <SkeletonCard />}
        </div>
      ) : (
        <Conteudo dados={dados} hoje={hoje} escolhida={escolhida} aoEscolher={setEscolhida} />
      )}
    </section>
  );
}

function Conteudo({
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
  const { card, open, badge } = dados;
  const temLimite = card.limitCents !== null && card.availableCents !== null && card.limitCents > 0;
  const usado = temLimite ? limiteUsadoPct(card.limitCents ?? 0, card.availableCents ?? 0) : 0;
  const padrao = indicePadrao(dados.bills);
  const selecionada = escolhida ?? padrao;
  const seloTexto =
    badge === null
      ? null
      : badge.kind === "vence"
        ? seloDeVencimento(badge.dueOn, hoje)
        : seloDePaga(badge.cycleKey);

  return (
    <>
      <div className="relative z-10 mx-auto -mt-[80px] flex w-full max-w-[1120px] flex-col gap-4 px-4 text-white tablet:px-6">
        {open !== null && (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-semibold text-white/82">
              Fatura aberta · ciclo de {monthNamePt(open.cycleKey)}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Money cents={open.totalCents} className="text-[34px] font-extrabold" />
              {seloTexto !== null && <StatusPill tone={seloTexto.tom}>{seloTexto.texto}</StatusPill>}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] font-semibold text-white/92">
              <p>Fecha {formatDayMonth(open.closesOn)}</p>
              {open.dueOn !== null && <p>Vence {formatDayMonth(open.dueOn)}</p>}
              {card.bestDayOn !== null && <p>Melhor dia {formatDayMonth(card.bestDayOn)}</p>}
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
            <p className="text-[13px] text-white/92">
              Disponível {formatMoney(card.availableCents ?? 0)} · Limite {formatMoney(card.limitCents ?? 0)}
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <GlassBubble>
            <p className="text-[12px] font-bold text-white/82">Parcelas futuras</p>
            <Money cents={dados.futureInstallmentsCents} className="text-[18px] font-extrabold" />
          </GlassBubble>
          {dados.avgMonths > 0 && (
            <GlassBubble>
              <p className="text-[12px] font-bold text-white/82">
                {dados.avgMonths >= 6 ? "Média 6 meses" : textoDaMedia(dados.avgMonths)}
              </p>
              <Money cents={dados.avg6Cents} className="text-[18px] font-extrabold" />
            </GlassBubble>
          )}
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-[1120px] items-start gap-5 px-4 pt-6 pb-8 tablet:px-6 desktop:grid-cols-2">
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
    </>
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
