import { Link } from "react-router";
import type { CartaoResumo } from "../../../shared/api/cards";
import { formatDayMonth, monthNamePt } from "../../../shared/format/dates";
import { IconeCartao, IconeCheck } from "../../components/icons";
import { Money } from "../../components/ui/money";
import { StatusPill } from "../../components/ui/status-pill";
import { limiteUsadoPct, seloDePaga, seloDeVencimento } from "./view-model";

// Um cartão na lista (TASK-0402): banco, final e ciclo; selo; a fatura do topo com datas e a barra do limite. Os
// valores passam por Money, então o olho os borra. Toque leva ao detalhe do cartão.
export function CartaoNaLista({ cartao, hoje }: { cartao: CartaoResumo; hoje: string }) {
  const atual = cartao.current;
  const aberta = atual?.state === "aberta";
  const selo =
    cartao.badge === null
      ? null
      : cartao.badge.kind === "vence"
        ? seloDeVencimento(cartao.badge.dueOn, hoje)
        : seloDePaga(cartao.badge.cycleKey);
  const paga = cartao.badge?.kind === "paga";
  const temLimite = cartao.limitCents !== null && cartao.availableCents !== null && cartao.limitCents > 0;
  const usado = temLimite ? limiteUsadoPct(cartao.limitCents ?? 0, cartao.availableCents ?? 0) : 0;

  return (
    <Link
      to={`/cartoes/${encodeURIComponent(cartao.id)}`}
      className="flex min-h-11 flex-col gap-4 rounded-card bg-card px-[22px] py-5 text-ink shadow-card"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-tile text-white"
          style={{ background: cartao.color }}
        >
          <IconeCartao size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-extrabold">{cartao.bankName}</p>
          <p className="text-[13px] text-ink-2">
            final {cartao.last4}
            {atual ? ` · ciclo de ${monthNamePt(atual.cycleKey)}` : ""}
          </p>
        </div>
        {selo !== null && (
          <StatusPill tone={selo.tom}>
            {paga && <IconeCheck size={12} className="mr-1" />}
            {selo.texto}
          </StatusPill>
        )}
      </div>

      {atual && (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-ink-2">{aberta ? "Fatura aberta" : "Fatura fechada"}</p>
            <Money cents={atual.totalCents} className="text-[26px] font-extrabold" />
          </div>
          <div className="shrink-0 text-right text-[13px] text-ink-2">
            <p>
              {aberta ? "Fecha" : "Fechou"} {formatDayMonth(atual.closesOn)}
            </p>
            {atual.dueOn !== null && <p>Vence {formatDayMonth(atual.dueOn)}</p>}
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
            className="h-2 overflow-hidden rounded-full bg-divider"
          >
            <div
              className={aberta ? "h-full rounded-full bg-primary" : "h-full rounded-full bg-[#F7931E]"}
              style={{ width: `${usado}%` }}
            />
          </div>
          <p className="text-[13px] text-ink-2">
            {aberta || cartao.openTotalCents === null ? (
              <>
                <Money cents={cartao.availableCents ?? 0} /> de limite disponível de{" "}
                <Money cents={cartao.limitCents ?? 0} />
              </>
            ) : (
              <>
                Nova fatura aberta: <Money cents={cartao.openTotalCents} /> · limite disponível{" "}
                <Money cents={cartao.availableCents ?? 0} />
              </>
            )}
          </p>
        </div>
      )}
    </Link>
  );
}
