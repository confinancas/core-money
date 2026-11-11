import { Link } from "react-router";
import { MoneyText } from "@/components/ui/money-text";
import { cn } from "@/lib/utils";
import type { NotificacaoDaLista } from "../../../shared/notifications/api";
import { type IconeDeNotificacao, NOTIFICATION_CATALOG } from "../../../shared/notifications/kinds";
import { quandoRotulo } from "./quando";

// Ícones do protótipo (Notificacoes.dc.html), 19 px, traço de 2,1.
const TRACO = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.1,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Icone({ tipo }: { tipo: IconeDeNotificacao }) {
  if (tipo === "brilho") {
    return (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
      </svg>
    );
  }
  const caminho = {
    alerta: "M12 3l9 16H3zM12 10v4M12 17v.5",
    relogio: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
    banco: "M3 10l9-6 9 6M5 10v8M19 10v8M9 10v8M15 10v8M3 20h18",
    check: "M5 12.5l4.5 4.5L19 7.5",
    entrada: "M17 7L7 17M15 17H7V9",
  }[tipo];
  return (
    <svg width="19" height="19" aria-hidden="true" {...TRACO}>
      <path d={caminho} />
    </svg>
  );
}

type Props = {
  notificacao: NotificacaoDaLista;
  // Não lida: o título fica mais forte e aparece o ponto verde.
  nova: boolean;
  agora: Date;
  // Tocar: marca como lida (otimista) e o Link leva ao destino.
  aoAbrir: (id: string) => void;
};

// Uma notificação da lista: ícone de 40 px com as cores do catálogo, título, hora, corpo com valores e o ponto de não lida.
export function ItemNotificacao({ notificacao, nova, agora, aoAbrir }: Props) {
  const catalogo = NOTIFICATION_CATALOG[notificacao.kind];
  return (
    <Link
      to={notificacao.link}
      onClick={() => aoAbrir(notificacao.id)}
      className="flex min-h-[44px] items-start gap-3 py-3.5 text-ink no-underline transition-colors hover:bg-field"
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-[13px]"
        style={{ background: catalogo.fundo, color: catalogo.cor }}
      >
        <Icone tipo={catalogo.icone} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn("text-[15px] text-ink", nova ? "font-extrabold" : "font-bold")}>
            {notificacao.title}
          </span>
          <span className="shrink-0 whitespace-nowrap text-[11px] font-bold text-[#98A39D]">
            {quandoRotulo(notificacao.createdAt, agora)}
          </span>
        </span>
        <span className="text-[13px] leading-[1.45] text-ink-3">
          <MoneyText texto={notificacao.body} />
        </span>
      </span>
      {nova && (
        <span
          role="img"
          aria-label="Não lida"
          className="mt-1.5 size-[9px] shrink-0 rounded-full bg-[#0E9A63]"
        />
      )}
    </Link>
  );
}
